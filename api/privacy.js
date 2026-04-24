/* ── /api/privacy — LFPDPPP ARCO dispatch ──
   One endpoint for three user-triggered flows, consolidated to stay
   under the Vercel Hobby 12-function limit:

     POST ?action=consent      body: { policy_version }
     GET  ?action=export       → returns a JSON attachment
     POST ?action=delete       body: { confirmation: "ELIMINAR" }

   All three require a valid user JWT — none are admin-only. */

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2, BUCKET, getAuthUser } from "./_r2.js";
import { getServiceClient, deleteUserCascade } from "./_admin.js";
import { withSentry } from "./_sentry.js";

const RATE_WINDOW_MS = 60 * 60 * 1000;

async function consent(req, res, { user, svc }) {
  const { policy_version } = req.body || {};
  if (typeof policy_version !== "string" || policy_version.length === 0 || policy_version.length > 64) {
    return res.status(400).json({ error: "Invalid policy_version" });
  }
  const { error } = await svc
    .from("user_consents")
    .upsert(
      { user_id: user.id, policy_version, accepted_at: new Date().toISOString() },
      { onConflict: "user_id,policy_version", ignoreDuplicates: false }
    );
  if (error) return res.status(500).json({ error: error.message || "Failed to record consent" });
  return res.status(200).json({ ok: true, policy_version });
}

async function exportData(req, res, { user, svc }) {
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { data: recent, error: rateErr } = await svc
    .from("export_audit")
    .select("exported_at")
    .eq("user_id", user.id)
    .gte("exported_at", since)
    .limit(1);
  if (rateErr) return res.status(500).json({ error: "Rate-limit check failed" });
  if (recent && recent.length > 0) {
    return res.status(429).json({
      error: "Too many exports",
      hint: "Solo puedes descargar tus datos una vez por hora.",
    });
  }

  const [patients, sessions, payments, notes, documents, consents] = await Promise.all([
    svc.from("patients").select("*").eq("user_id", user.id),
    svc.from("sessions").select("*").eq("user_id", user.id),
    svc.from("payments").select("*").eq("user_id", user.id),
    svc.from("notes").select("*").eq("user_id", user.id),
    svc.from("documents").select("*").eq("user_id", user.id),
    svc.from("user_consents").select("*").eq("user_id", user.id),
  ]);

  const docLinks = {};
  for (const d of documents.data || []) {
    if (typeof d.file_path === "string" && d.file_path.startsWith(`${user.id}/`)) {
      try {
        docLinks[d.id] = await getSignedUrl(
          r2,
          new GetObjectCommand({ Bucket: BUCKET, Key: d.file_path }),
          { expiresIn: 3600 }
        );
      } catch { /* best-effort */ }
    }
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    policy_note: "Document links expire 1 hour after export. Re-request if needed.",
    user: { id: user.id, email: user.email || null },
    patients: patients.data || [],
    sessions: sessions.data || [],
    payments: payments.data || [],
    notes: notes.data || [],
    documents: (documents.data || []).map((d) => ({ ...d, _downloadUrl: docLinks[d.id] || null })),
    consents: consents.data || [],
  };
  const body = JSON.stringify(payload, null, 2);

  await svc
    .from("export_audit")
    .insert({ user_id: user.id, bytes: body.length })
    .then(() => {}, () => {});

  const date = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="cardigan-export-${date}.json"`);
  return res.status(200).send(body);
}

async function deleteAccount(req, res, { user, svc }) {
  const { confirmation } = req.body || {};
  if (confirmation !== "ELIMINAR") {
    return res.status(400).json({ error: "Invalid confirmation", code: "bad_confirmation" });
  }
  const result = await deleteUserCascade({
    svc,
    r2Client: r2,
    bucket: BUCKET,
    userId: user.id,
    tombstone: { email: user.email || null, reason: "self" },
  });
  if (!result.ok) {
    return res.status(500).json({ error: `Failed to delete ${result.failedTable}: ${result.error}` });
  }
  return res.status(200).json({ ok: true });
}

async function handler(req, res) {
  const action = req.query?.action || "";
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const svc = getServiceClient();
  const ctx = { user, svc };

  if (req.method === "POST" && action === "consent") return consent(req, res, ctx);
  if (req.method === "GET"  && action === "export")  return exportData(req, res, ctx);
  if (req.method === "POST" && action === "delete")  return deleteAccount(req, res, ctx);
  return res.status(404).json({ error: "Unknown action" });
}

export default withSentry(handler, { name: "privacy" });
