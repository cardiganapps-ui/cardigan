/* Admin-only: block or unblock a user account.
   Blocking sets auth.users.banned_until to a far-future date, which
   prevents sign-in but preserves all their data. Unblocking clears it.

   Body: { userId: uuid, block: boolean }
   Auth: caller must be the admin (email === ADMIN_EMAIL) */

import { requireAdmin, getServiceClient, isValidUserId } from "./_admin.js";

const BLOCK_UNTIL = "2999-01-01T00:00:00Z";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const admin = await requireAdmin(req, res);
  if (!admin) return; // response already written

  const { userId, block } = req.body || {};
  if (!isValidUserId(userId)) return res.status(400).json({ error: "Invalid userId" });
  if (typeof block !== "boolean") return res.status(400).json({ error: "Invalid block flag" });
  // Hard guard: the admin should not be able to block themselves through
  // this endpoint (would lock the app out). The UI prevents it too.
  if (userId === admin.id) return res.status(400).json({ error: "Cannot block yourself" });

  try {
    const svc = getServiceClient();
    const { error } = await svc.auth.admin.updateUserById(userId, {
      ban_duration: block ? "87600h" : "none", // 87600h ≈ 10 years; "none" clears it
    });
    if (error) {
      return res.status(500).json({ error: error.message || "Update failed" });
    }
    return res.status(200).json({ ok: true, blocked: block, until: block ? BLOCK_UNTIL : null });
  } catch (err) {
    return res.status(500).json({ error: "Block/unblock failed" });
  }
}
