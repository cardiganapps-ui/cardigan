/* ── GET /api/push-diagnose ──
   Admin-only. Single call that returns everything you'd want to know
   before opening a pgAdmin tab or digging in Vercel logs:

     - Presence + length + first-8-char prefix of every VAPID env var
       (so we can confirm client/server public-key parity).
     - Whether VITE_VAPID_PUBLIC_KEY and VAPID_PUBLIC_KEY match.
     - push_subscriptions count + breakdown by push-provider host.
     - Cron job config + last 20 run results (via diag_cron_job_state
       SECURITY DEFINER fn; see migration 011). */

import { requireAdmin } from "./_admin.js";
import { getServiceClient, readVapidConfig } from "./_push.js";
import { withSentry } from "./_sentry.js";

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const vapidPub = process.env.VAPID_PUBLIC_KEY || "";
  const vitePub = process.env.VITE_VAPID_PUBLIC_KEY || "";
  const { pub: effectivePub, subject: effectiveSubject, missing: vapidMissing } = readVapidConfig();
  const env = {
    // Canonical names
    VAPID_PUBLIC_KEY: describeKey(vapidPub),
    VAPID_PRIVATE_KEY: { present: !!process.env.VAPID_PRIVATE_KEY, length: (process.env.VAPID_PRIVATE_KEY || "").length },
    VAPID_SUBJECT: { present: !!process.env.VAPID_SUBJECT, value: process.env.VAPID_SUBJECT || null },
    // Legacy / client-prefixed names. Kept in the report so the admin
    // can see during migration whether both are set and match.
    VITE_VAPID_PUBLIC_KEY: {
      ...describeKey(vitePub),
      matchesCanonical: vitePub && vapidPub ? vitePub === vapidPub : null,
    },
    VAPID_EMAIL: { present: !!process.env.VAPID_EMAIL, value: process.env.VAPID_EMAIL || null },
    // Effective (what sendPush actually uses)
    effective: {
      publicKeyPrefix: effectivePub ? effectivePub.slice(0, 8) : null,
      subject: effectiveSubject || null,
      missing: vapidMissing,
    },
    CRON_SECRET: { present: !!process.env.CRON_SECRET, length: (process.env.CRON_SECRET || "").length },
    SUPABASE_URL: { present: !!process.env.SUPABASE_URL },
    SUPABASE_SERVICE_ROLE_KEY: { present: !!process.env.SUPABASE_SERVICE_ROLE_KEY },
    SUPABASE_ANON_KEY: { present: !!process.env.SUPABASE_ANON_KEY },
  };

  const supabase = getServiceClient();

  const { data: allSubs, error: subsErr } = await supabase
    .from("push_subscriptions")
    .select("endpoint, created_at, resub_token");

  const byHost = {};
  let withToken = 0;
  for (const row of allSubs || []) {
    try { const h = new URL(row.endpoint).host; byHost[h] = (byHost[h] || 0) + 1; }
    catch { byHost["(invalid)"] = (byHost["(invalid)"] || 0) + 1; }
    if (row.resub_token) withToken++;
  }

  const { data: cronData, error: cronErr } = await supabase.rpc("diag_cron_job_state");

  res.status(200).json({
    ts: new Date().toISOString(),
    env,
    subscriptions: {
      total: allSubs?.length ?? 0,
      withResubToken: withToken,
      byHost,
      error: subsErr?.message || null,
    },
    cron: cronData || null,
    cronError: cronErr?.message || null,
  });
}

function describeKey(v) {
  return {
    present: !!v,
    length: v.length,
    prefix: v ? v.slice(0, 8) : null,
  };
}

export default withSentry(handler, { name: "push-diagnose" });
