/* ── POST /api/patient-document-url ───────────────────────────────
   Patient-side companion to /api/document-url. Returns a presigned
   GET URL for an R2 object the patient uploaded. The therapist
   endpoint validates the path starts with the caller's user_id;
   patients can't satisfy that (the path is under the therapist's
   id). Instead, this endpoint:

     1. Auth-gates the JWT.
     2. Verifies the patient owns a documents row whose file_path
        matches AND uploaded_by_user_id = auth.uid() (mirrors the
        patient SELECT RLS policy).
     3. Returns the same presigned-GET URL the therapist endpoint
        would, with safe Content-Type + Content-Disposition
        overrides so a malicious uploaded HTML/SVG can't render
        as a phishing page.

   Body: { document_id }      // simpler than passing path; we look up
   Response:
     200 { url }
     400 — bad input
     401 — not signed in
     403 — RLS rejected / not the uploader / not on a linked patient */

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient } from "@supabase/supabase-js";
import { getR2, BUCKET } from "./_r2.js";
import { getAuthUser } from "./_admin.js";
import { withSentry } from "./_sentry.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const PREVIEWABLE = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
  "application/pdf",
]);

function safeFilename(name: Row) {
  return String(name || "archivo").replace(/[\r\n";\\]/g, "_").slice(0, 200);
}

async function handler(req: Row, res: Row) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { document_id } = req.body || {};
  if (typeof document_id !== "string" || !document_id) {
    return res.status(400).json({ error: "Invalid document_id" });
  }

  // Look up via the user-JWT'd client so the SELECT RLS gates by
  // uploaded_by_user_id = auth.uid() AND patient_id IN (linked
  // patients). A forged document_id from someone else's uploads
  // returns no row → 403.
  const userClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: req.headers.authorization } },
    }
  );
  const { data: doc, error: dErr } = await userClient
    .from("documents")
    .select("id, file_path, file_type, name")
    .eq("id", document_id)
    .maybeSingle();
  if (dErr) return res.status(500).json({ error: dErr.message });
  if (!doc) return res.status(403).json({ error: "Forbidden" });

  try {
    const r2 = await getR2();
    const isPreviewable = PREVIEWABLE.has(doc.file_type);
    const filename = safeFilename(doc.name);
    const url = await getSignedUrl(r2, new GetObjectCommand({
      Bucket: BUCKET,
      Key: doc.file_path,
      // Override the served Content-Type so R2 can never re-serve
      // a malicious type stored at upload time. Force download for
      // non-previewable types so the user's browser can't render
      // unexpected formats.
      ResponseContentType: doc.file_type,
      ResponseContentDisposition: isPreviewable
        ? `inline; filename="${filename}"`
        : `attachment; filename="${filename}"`,
    }), { expiresIn: 300 });
    return res.status(200).json({ url });
  } catch (err: Row) {
    console.error("[patient-document-url] failed:", err?.message);
    return res.status(500).json({ error: "URL generation failed" });
  }
}

export default withSentry(handler, { name: "patient-document-url" });
