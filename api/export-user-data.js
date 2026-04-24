/* ── GET /api/export-user-data ──
   LFPDPPP "Acceso" — returns a JSON snapshot of everything the
   authenticated user has in Cardigan. Meant for the Settings →
   "Descargar mis datos" button; the client writes the response body
   to a file locally.

   Rate-limited to one successful export per user per hour via the
   export_audit table (migration 014). The export is cheap to generate
   but contains the full patient roster, so we don't want it triggerable
   by a stolen token in a tight loop.

   Document blobs are NOT included — only their metadata with a 1-hour
   presigned URL per file. */

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2, BUCKET, getAuthUser } from "./_r2.js";
import { getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";

const RATE_WINDOW_MS = 60 * 60 * 1000;

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const svc = getServiceClient();

  // Rate-limit check.
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

  // Document download links — 1-hour presigns. If the link list fails
  // mid-loop we continue with what we have; the user can re-export.
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

  // Audit row — best-effort; the user still gets their data if this fails.
  await svc
    .from("export_audit")
    .insert({ user_id: user.id, bytes: body.length })
    .then(() => {}, () => {});

  const date = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="cardigan-export-${date}.json"`);
  res.status(200).send(body);
}

export default withSentry(handler, { name: "export-user-data" });
