/* ── POST /api/patient-document-delete ────────────────────────────
   Patient deletes one of their own uploads. Two-step:
     1. Resolve the documents row via the user-JWT'd client (RLS
        gates SELECT to patient's own uploads).
     2. Delete the R2 object + delete the documents row. Both
        through service-role to avoid double-RLS-checking.

   Two modes:
     • normal       — body: { document_id } — deletes the row + R2 obj.
     • orphan sweep — body: { file_path, orphan: true } — deletes
                      ONLY the R2 object. Used by the upload hook
                      when the confirm step fails after a successful
                      R2 PUT (no DB row exists). Path is validated
                      to start with `${user_id}/${patient_id}/` for
                      a patient row the caller actually owns, so a
                      malicious caller can't sweep someone else's
                      R2 files.

   Body: { document_id } OR { file_path, orphan: true }
   Response:
     200 { ok: true }
     400 — bad input
     401 — not signed in
     403 — not their upload / forged path */

import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { getR2, BUCKET } from "./_r2.js";
import { getAuthUser, getServiceClient } from "./_admin.js";
import { rateLimit } from "./_ratelimit.js";
import { withSentry } from "./_sentry.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

async function handler(req: Row, res: Row) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  // Per-patient limiter — deletes a document row + R2 object. 30 in
  // 60s covers a cleanup batch while capping abuse by a token holder.
  const rl = await rateLimit({
    endpoint: "patient-document-delete",
    bucket: user.id,
    max: 30,
    windowSec: 60,
  });
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfter));
    return res.status(429).json({ error: "Demasiados intentos. Espera un minuto." });
  }

  const body = req.body || {};

  // ── Orphan-sweep path ──────────────────────────────────────────
  // Used only by usePatientDocuments after a confirm-step failure;
  // no DB row exists yet. We validate that the path is one the
  // patient is allowed to write to (under one of THEIR therapists'
  // prefixes for an ACTIVE/POTENTIAL patient row), then delete the
  // R2 object. No row delete because there's no row.
  if (body.orphan === true) {
    const filePath = body.file_path;
    if (typeof filePath !== "string" || !filePath) {
      return res.status(400).json({ error: "Invalid file_path" });
    }
    // Path shape: ${therapist_user_id}/${patient_id}/patient-...
    const parts = filePath.split("/");
    // The 3rd segment MUST be a patient-uploaded key ("patient-…"). The
    // caller owning the (therapist/patient) prefix is necessary but not
    // sufficient: without this, a patient could pass any key under their
    // prefix (including therapist-uploaded documents, or a traversal
    // segment) and delete it. Restrict the sweep to patient-authored
    // orphans only. (bug-hunt: orphan-sweep path shape)
    if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2].startsWith("patient-")) {
      return res.status(400).json({ error: "Malformed path" });
    }
    if (parts.includes("..") || parts.includes(".")) {
      return res.status(400).json({ error: "Malformed path" });
    }
    const [therapistId, patientId] = parts;
    // Verify the caller actually owns a patient row at this prefix.
    // RLS gates SELECT to (patient_user_id = auth.uid()) AND active
    // /potential, so a forged path with someone else's IDs returns
    // no row and we 403.
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
      .eq("id", patientId)
      .eq("user_id", therapistId)
      .maybeSingle();
    if (pErr) return res.status(500).json({ error: pErr.message });
    if (!patient) return res.status(403).json({ error: "Forbidden" });
    try {
      const r2 = await getR2();
      await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: filePath }));
    } catch (err: Row) {
      console.warn("[patient-document-delete] R2 orphan sweep failed:", err?.message);
      // Best-effort: even if R2 delete fails the lifecycle rule will
      // eventually catch it. 200 so the client doesn't retry.
    }
    return res.status(200).json({ ok: true, swept: true });
  }

  // ── Normal delete path ─────────────────────────────────────────
  const { document_id } = body;
  if (typeof document_id !== "string" || !document_id) {
    return res.status(400).json({ error: "Invalid document_id" });
  }

  // Verify ownership via the user-JWT'd client. RLS scopes SELECT
  // to docs where uploaded_by_user_id = auth.uid() AND patient_id
  // IN linked-active. A forged document_id 403's cleanly.
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
  } catch (err: Row) {
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
