/* ── POST /api/record-consent ──
   Stamps a row in public.user_consents for the authenticated caller.
   LFPDPPP "Acceso" consent capture — called by components/ConsentBanner.jsx
   after the user accepts the current POLICY_VERSION.

   Body: { policy_version: string }
   Auth: standard JWT (NOT admin-only). */

import { getAuthUser } from "./_r2.js";
import { getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { policy_version } = req.body || {};
  if (typeof policy_version !== "string" || policy_version.length === 0 || policy_version.length > 64) {
    return res.status(400).json({ error: "Invalid policy_version" });
  }

  const svc = getServiceClient();
  // Upsert on (user_id, policy_version) so re-accepts are no-ops. The
  // unique index in migration 014 enforces this at the DB layer.
  const { error } = await svc
    .from("user_consents")
    .upsert(
      { user_id: user.id, policy_version, accepted_at: new Date().toISOString() },
      { onConflict: "user_id,policy_version", ignoreDuplicates: false }
    );
  if (error) {
    return res.status(500).json({ error: error.message || "Failed to record consent" });
  }
  return res.status(200).json({ ok: true, policy_version });
}

export default withSentry(handler, { name: "record-consent" });
