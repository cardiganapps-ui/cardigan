/* Admin-only: fully delete a user account + all of their data.
   This is IRREVERSIBLE. Implementation lives in _admin.js's
   deleteUserCascade helper, which is shared with delete-my-account.js
   so both flows can't drift.

   Body: { userId: uuid }
   Auth: caller must be the admin (email === ADMIN_EMAIL) */

import { getR2, BUCKET } from "./_r2.js";
import { requireAdmin, getServiceClient, isValidUserId, deleteUserCascade } from "./_admin.js";
import { withSentry } from "./_sentry.js";

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { userId } = req.body || {};
  if (!isValidUserId(userId)) return res.status(400).json({ error: "Invalid userId" });
  if (userId === admin.id) return res.status(400).json({ error: "Cannot delete yourself" });

  const svc = getServiceClient();

  // Look up the target email for the tombstone row before we wipe auth.
  let targetEmail = null;
  try {
    const { data } = await svc.auth.admin.getUserById(userId);
    targetEmail = data?.user?.email || null;
  } catch { /* tombstone email is optional */ }

  const result = await deleteUserCascade({
    svc,
    r2Client: await getR2(),
    bucket: BUCKET,
    userId,
    tombstone: { email: targetEmail, reason: "admin" },
  });

  if (!result.ok) {
    return res.status(500).json({ error: `Failed to delete ${result.failedTable}: ${result.error}` });
  }
  return res.status(200).json({ ok: true });
}

export default withSentry(handler, { name: "admin-delete-user" });
