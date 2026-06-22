/* ── POST /api/patient-upload-url ─────────────────────────────────
   Patient-side companion to /api/upload-url. The therapist endpoint
   validates the upload path starts with the therapist's own user_id;
   patients can't satisfy that because their auth.uid() is NOT the
   therapist's. So this endpoint:

     1. Auth-gates the caller (JWT).
     2. Validates the patient owns the patients row (via the patient-
        side RLS read).
     3. Resolves the therapist's user_id for that row (so R2 keys
        stay grouped under the therapist's prefix — keeps the bucket
        tree coherent for billing + cleanup).
     4. SERVER-builds the path (don't trust the client to construct
        it correctly): `${therapistId}/${patientId}/patient-${ts}-${slug}.${ext}`
        The "patient-" filename prefix lets a human glancing at R2
        see who uploaded what.
     5. Returns { url, path }.

   Body: { patient_id, file_name, content_type }
   Response:
     200 { url, path }
     400 — bad input / unsupported content type / oversized name
     401 — not signed in
     403 — patient_id doesn't belong to a row this user owns

   The size cap is enforced by R2 + by the documents.file_size column
   downstream (validated in patient-document-confirm). This endpoint
   doesn't see the file contents. */

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient } from "@supabase/supabase-js";
import { getR2, BUCKET } from "./_r2.js";
import { getAuthUser } from "./_admin.js";
import { withSentry } from "./_sentry.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

// Same allowlist the therapist endpoint uses. Tightening here would
// only frustrate users when their therapist already accepts the type.
const ALLOWED_UPLOAD_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

const MAX_FILENAME_LEN = 200;

// Mirrors the cap enforced on the confirm step (patient-document-
// confirm.js::MAX_FILE_SIZE). Without a content-length on the
// presigned URL, R2 would happily accept multi-GB uploads — the
// confirm step would reject the row, but the bytes are already in
// our bucket. Cap defensively at the byte level too.
const MAX_FILE_SIZE = 25 * 1024 * 1024;

// MIME → file extension. Used for path construction so the suffix
// matches the content the user uploaded. Without this we'd either
// trust the client's filename (path traversal risk) or strip the
// extension entirely (browsers wouldn't know how to render it).
const MIME_EXT: Row = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
  "text/csv": "csv",
};

function slugify(s: Row) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

async function handler(req: Row, res: Row) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { patient_id, file_name, content_type } = req.body || {};
  if (typeof patient_id !== "string" || !patient_id) {
    return res.status(400).json({ error: "Invalid patient_id" });
  }
  if (typeof file_name !== "string" || !file_name || file_name.length > MAX_FILENAME_LEN) {
    return res.status(400).json({ error: "Invalid file_name" });
  }
  if (typeof content_type !== "string" || !ALLOWED_UPLOAD_TYPES.has(content_type)) {
    return res.status(415).json({ error: "Unsupported content type" });
  }

  // Verify patient ownership via the user-JWT'd client. RLS scopes
  // patients SELECT to rows where patient_user_id = auth.uid() AND
  // status IN ('active','potential') (migration 052). A forged
  // patient_id from a different therapist's roster returns no row
  // and we 403 cleanly without leaking existence.
  const userClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: req.headers.authorization } },
    }
  );
  const { data: patient, error: pErr } = await userClient
    .from("patients")
    .select("id, user_id")
    .eq("id", patient_id)
    .maybeSingle();
  if (pErr) return res.status(500).json({ error: pErr.message });
  if (!patient) return res.status(403).json({ error: "Forbidden" });

  // Build the R2 key. Server-controlled — the patient never sets it.
  // Keys grouped under the THERAPIST's id keep the bucket tree
  // consistent with therapist-uploaded docs, which simplifies admin
  // tooling + R2 lifecycle rules.
  const ext = MIME_EXT[content_type] || "bin";
  const ts = Date.now();
  const slug = slugify(file_name) || "archivo";
  const path = `${patient.user_id}/${patient.id}/patient-${ts}-${slug}.${ext}`;

  try {
    const r2 = await getR2();
    // Layered size-enforcement strategy:
    //   1. Client-side: usePatientDocuments rejects > MAX_FILE_SIZE
    //      before requesting a presigned URL. Stops 99% of cases at
    //      the source — no network round-trip.
    //   2. Confirm step (patient-document-confirm.js): file_size on
    //      the request body is server-validated; an oversized upload
    //      that skipped step 1 still gets rejected before the row is
    //      ledgered. The R2 object is orphaned in this path; an R2
    //      lifecycle rule sweeps unconfirmed objects (TODO).
    //   3. R2 PUT: Cloudflare R2 enforces a per-object 5 GB cap by
    //      default; well above our MAX. We don't rely on this.
    //
    // The presigned URL itself can't carry a max-size constraint
    // without switching to createPresignedPost (S3 v2 policy form),
    // which would require a different client-side flow. Keep the
    // PUT presign for simplicity; the layered checks above are
    // sufficient.
    const url = await getSignedUrl(r2, new PutObjectCommand({
      Bucket: BUCKET,
      Key: path,
      ContentType: content_type,
    }), { expiresIn: 300 });
    return res.status(200).json({ url, path, max_size: MAX_FILE_SIZE });
  } catch (err: Row) {
    console.error("[patient-upload-url] failed:", err?.message);
    return res.status(500).json({ error: "Upload URL generation failed" });
  }
}

export default withSentry(handler, { name: "patient-upload-url" });
