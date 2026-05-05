/* ── POST /api/admin-audit ─────────────────────────────────────────────
   Client-initiated audit-log writes. Used for events that originate
   in the browser (today: "view_as" — when an admin starts
   impersonating a user) and don't otherwise hit a server endpoint
   that could write the row itself.

   Server-side admin actions (block, delete, comp, etc) write their
   audit row inline via api/_admin.js::logAuditEvent — they do NOT
   round-trip through this endpoint.

   Body: { action: string, targetUserId?: uuid, payload?: object }
   Auth: standard admin (requireAdmin).

   Whitelist of actions intentionally narrow — this endpoint is the
   only place where a client can write to admin_audit_log, so we
   don't want it accepting arbitrary action strings that could
   pollute the log. */

import { requireAdmin, getServiceClient, isValidUserId, logAuditEvent } from "./_admin.js";
import { withSentry } from "./_sentry.js";

const CLIENT_ALLOWED_ACTIONS = new Set([
  "view_as",
]);

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}); }
  catch { return res.status(400).json({ error: "Invalid JSON" }); }

  const action = String(body?.action || "");
  if (!CLIENT_ALLOWED_ACTIONS.has(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }
  const targetUserId = body?.targetUserId || null;
  if (targetUserId && !isValidUserId(targetUserId)) {
    return res.status(400).json({ error: "Invalid targetUserId" });
  }
  // Payload is admin-supplied JSON. Cap size so a malicious / buggy
  // client can't fill the audit log with megabyte payloads.
  let payload = body?.payload ?? null;
  if (payload && JSON.stringify(payload).length > 4096) {
    return res.status(413).json({ error: "Payload too large" });
  }

  const svc = getServiceClient();
  await logAuditEvent(svc, {
    actorId: admin.id,
    targetUserId,
    action,
    payload,
    req,
  });
  return res.status(200).json({ ok: true });
}

export default withSentry(handler, { name: "admin-audit" });
