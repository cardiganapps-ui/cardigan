/* ── POST /api/patient-document-delete ────────────────────────────
   Patient deletes one of their own uploads. Two-step:
     1. Resolve the documents row via the user-JWT'd client (RLS
        gates SELECT to patient's own uploads).
     2. Delete the R2 object + delete the documents row. Both
        through service-role to avoid double-RLS-checking.

   Body: { document_id }
   Response:
     200 { ok: true }
     400 — bad input
     401 — not signed in
     403 — not their upload */

import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { getR2, BUCKET } from "./_r2.js";
import { getAuthUser, getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { document_id } = req.body || {};
  if (typeof document_id !== "string" || !document_id) {
    return res.status(400).json({ error: "Invalid document_id" });
  }

  // Verify ownership via the user-JWT'd client. RLS scopes SELECT
  // to docs where uploaded_by_user_id = auth.uid() AND patient_id
  // IN linked-active. A forged document_id 403's cleanly.
  const userClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: req.headers.authorization } },
    }
  );
  const { data: doc, error: dErr } = await userClient
    .from("documents")
    .select("id, file_path")
    .eq("id", document_id)
    .maybeSingle();
  if (dErr) return res.status(500).json({ error: dErr.message });
  if (!doc) return res.status(403).json({ error: "Forbidden" });

  // Delete the R2 object first. If this fails we still proceed to
  // delete the row (the alternative leaves a row pointing at
  // nothing, worse than an orphan R2 file the bucket lifecycle can
  // sweep). Mirrors how the therapist's deletePatient handles R2
  // cleanup.
  try {
    const r2 = await getR2();
    await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: doc.file_path }));
  } catch (err) {
    console.warn("[patient-document-delete] R2 delete failed:", err?.message);
  }

  // Service-role for the row delete since the patient DELETE RLS
  // policy needs the same WHERE-clause gates we already verified
  // via SELECT — going through service-role keeps the read+delete
  // atomic-ish without a second RLS round-trip.
  const svc = getServiceClient();
  const { error: rowErr } = await svc
    .from("documents")
    .delete()
    .eq("id", document_id)
    .eq("uploaded_by_user_id", user.id); // belt-and-suspenders
  if (rowErr) return res.status(500).json({ error: rowErr.message });

  return res.status(200).json({ ok: true });
}

export default withSentry(handler, { name: "patient-document-delete" });
