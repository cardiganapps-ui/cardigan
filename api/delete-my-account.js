/* ── POST /api/delete-my-account ──
   LFPDPPP ARCO "Cancelación". Irreversible full-account delete
   triggered by the user themselves — not admin. Requires a typed
   confirmation ("ELIMINAR") in the body to guard against accidental
   clicks from muscle memory. Cascades through R2 documents, every app
   table, and finally auth.users via the shared deleteUserCascade
   helper that admin-delete-user.js also uses.

   Body: { confirmation: "ELIMINAR" }
   Auth: standard JWT (user is deleting their own account). */

import { r2, BUCKET, getAuthUser } from "./_r2.js";
import { getServiceClient, deleteUserCascade } from "./_admin.js";
import { withSentry } from "./_sentry.js";

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { confirmation } = req.body || {};
  if (confirmation !== "ELIMINAR") {
    return res.status(400).json({ error: "Invalid confirmation", code: "bad_confirmation" });
  }

  const svc = getServiceClient();

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

export default withSentry(handler, { name: "delete-my-account" });
