/* Admin-only: block or unblock a user account.
   Blocking sets auth.users.banned_until to a far-future date, which
   prevents sign-in but preserves all their data. Unblocking clears it.

   Body: { userId: uuid, block: boolean }
   Auth: caller must be the admin (email === ADMIN_EMAIL) */

import { requireAdmin, getServiceClient, isValidUserId } from "./_admin.js";
import { withSentry } from "./_sentry.js";

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const admin = await requireAdmin(req, res);
  if (!admin) return; // response already written

  const { userId, block } = req.body || {};
  if (!isValidUserId(userId)) return res.status(400).json({ error: "Invalid userId" });
  if (typeof block !== "boolean") return res.status(400).json({ error: "Invalid block flag" });
  // Hard guard: the admin should not be able to block themselves through
  // this endpoint (would lock the app out). The UI prevents it too.
  if (userId === admin.id) return res.status(400).json({ error: "Cannot block yourself" });

  let svc;
  try {
    svc = getServiceClient();
  } catch (err) {
    // Missing SUPABASE_SERVICE_ROLE_KEY in env is a common deploy issue;
    // surface it explicitly so the admin knows where to look.
    return res.status(500).json({ error: err?.message || "Service client unavailable" });
  }

  // Update auth.users.banned_until through the admin_set_user_blocked
  // RPC. See migration 005 — the RPC runs as security definer and is
  // grant-restricted to service_role, which is what the service client
  // uses.
  const { error } = await svc.rpc("admin_set_user_blocked", {
    target_user_id: userId,
    blocked: block,
  });
  if (error) {
    return res.status(500).json({ error: error.message || "Update failed" });
  }
  return res.status(200).json({
    ok: true,
    blocked: block,
    until: block ? "2999-01-01T00:00:00Z" : null,
  });
}

export default withSentry(handler, { name: "admin-block-user" });
