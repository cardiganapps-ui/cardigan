/* ── POST /api/patient-document-confirm ───────────────────────────
   Patient calls this after a successful PUT to the presigned URL
   from /api/patient-upload-url. We insert the documents row so the
   therapist's app sees the file in their existing Documentos tab,
   AND the patient sees it in their "Mis archivos" card.

   Why two endpoints (upload-url + confirm) instead of one big POST
   body that includes the file? The presigned PUT pattern lets the
   browser stream large files directly to R2, bypassing Vercel's
   4.5 MB body limit. The confirm step records the metadata.

   Race + integrity: we use the patient-side INSERT RLS policy so
   the row's `uploaded_by_user_id` and `patient_id` constraints
   match the policy's `with check`. A forged patient_id or
   uploaded_by_user_id fails the policy and the insert errors out
   with a 42501 — we map that to 403.

   Body: { patient_id, file_path, name, file_type, file_size }
   Response:
     200 { document }
     400 — bad input
     401 — not signed in
     403 — RLS rejected (patient_id forge or path mismatch) */

import { createClient } from "@supabase/supabase-js";
import { getAuthUser } from "./_admin.js";
import { withSentry } from "./_sentry.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const MAX_FILENAME_LEN = 200;
// 25 MB — more than enough for insurance docs / IDs / lab PDFs.
// Below R2's per-object ceiling. Uploads hit this naturally via
// the presigned URL's content-length-range header in a future
// hardening pass; for now we trust the client's reported size and
// reject obviously-bad rows.
const MAX_FILE_SIZE = 25 * 1024 * 1024;

async function handler(req: Row, res: Row) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { patient_id, file_path, name, file_type, file_size } = req.body || {};
  if (typeof patient_id !== "string" || !patient_id) {
    return res.status(400).json({ error: "Invalid patient_id" });
  }
  if (typeof file_path !== "string" || !file_path) {
    return res.status(400).json({ error: "Invalid file_path" });
  }
  if (typeof name !== "string" || !name || name.length > MAX_FILENAME_LEN) {
    return res.status(400).json({ error: "Invalid name" });
  }
  if (typeof file_type !== "string" || !file_type) {
    return res.status(400).json({ error: "Invalid file_type" });
  }
  const sizeNum = Number(file_size);
  if (!Number.isFinite(sizeNum) || sizeNum <= 0 || sizeNum > MAX_FILE_SIZE) {
    return res.status(400).json({ error: "Invalid file_size" });
  }

  // Resolve the therapist's user_id so we can stamp documents.user_id
  // correctly. The therapist owns the row (matches their existing
  // RLS policy) — the patient is the uploader, not the owner. We
  // pull it via the user-JWT'd client; RLS gates the read so a
  // forged patient_id 403's cleanly.
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

  // Belt-and-suspenders: the file_path MUST start with the
  // therapist's id. The presigned URL endpoint already constructs
  // it that way, but a malicious caller might POST a different
  // path here. Reject anything that doesn't match.
  if (!file_path.startsWith(`${patient.user_id}/${patient.id}/`)) {
    return res.status(400).json({ error: "Path does not belong to this patient" });
  }

  // Insert via the user-JWT'd client so the patient INSERT RLS
  // policy gates the write. The policy's WITH CHECK requires:
  //   - uploaded_by_user_id = auth.uid()  (the patient)
  //   - patient_id is on a row patient_user_id = auth.uid()
  // and active/potential. Any forge fails the check.
  const { data: inserted, error: insErr } = await userClient
    .from("documents")
    .insert({
      user_id: patient.user_id,           // therapist owns the row
      patient_id: patient.id,
      uploaded_by_user_id: user.id,        // patient is the uploader
      name,
      file_path,
      file_type,
      file_size: sizeNum,
    })
    .select()
    .single();
  if (insErr) {
    // 42501 = insufficient_privilege (RLS rejected). Map to 403
    // so the client surfaces an honest error.
    if (insErr.code === "42501") return res.status(403).json({ error: "Forbidden" });
    return res.status(500).json({ error: insErr.message });
  }

  return res.status(200).json({ document: inserted });
}

export default withSentry(handler, { name: "patient-document-confirm" });
