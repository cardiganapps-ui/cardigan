/* Admin-only: change a user's profession.
   Used by AdminPanel "Cambiar profesión" — the only sanctioned path
   for changing profession after sign-up (regular users have it locked).

   Body: { userId: uuid, profession: string }
   Auth: caller must be the admin (email === ADMIN_EMAIL) */

import { requireAdmin, getServiceClient, isValidUserId } from "./_admin.js";
import { withSentry } from "./_sentry.js";

const ALLOWED = new Set([
  "psychologist",
  "nutritionist",
  "tutor",
  "music_teacher",
  "trainer",
]);

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { userId, profession } = req.body || {};
  if (!isValidUserId(userId)) return res.status(400).json({ error: "Invalid userId" });
  if (!ALLOWED.has(profession)) return res.status(400).json({ error: "Invalid profession" });

  let svc;
  try {
    svc = getServiceClient();
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Service client unavailable" });
  }

  // Upsert: target user might lack a row (shouldn't happen post-021,
  // but a future user signed up before backfill could). on_conflict
  // overwrites the existing profession + bumps updated_at.
  const { error } = await svc
    .from("user_profiles")
    .upsert(
      { user_id: userId, profession, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  if (error) {
    return res.status(500).json({ error: error.message || "Update failed" });
  }
  return res.status(200).json({ ok: true, profession });
}

export default withSentry(handler, { name: "admin-update-profession" });
