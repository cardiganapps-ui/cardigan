/* ── POST /api/grant-trial-extension ──────────────────────────────────
   Grants the user N free trial days for completing an activation
   milestone. Idempotency-keyed by `reason` so a refresh + re-tap
   can't stack the bonus.

   Currently the only reason wired is `activation_complete` (5 days),
   awarded by the client when ActivationChecklist's all-four-done
   transition fires. The endpoint is intentionally lightweight: it
   trusts the client's claim that the activation completed (the user
   either has the rows in their account or they don't — verifying
   server-side would mean four extra round-trips for a first-month
   sweetener). Worst case a savvy user grants themselves +5 days.

   Returns { ok, granted: bool, totalDays }. The hook reads the
   updated user_subscriptions.trial_extension_days on next refresh. */

import { getAuthUser } from "./_r2.js";
import { getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";

const ALLOWED_REASONS = {
  // 5 days for completing all 4 ActivationChecklist steps.
  activation_complete: { days: 5 },
};

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  let body = {};
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}); }
  catch { /* malformed body — proceed with empty */ }

  const reason = typeof body.reason === "string" ? body.reason : null;
  const config = reason ? ALLOWED_REASONS[reason] : null;
  if (!config) {
    return res.status(400).json({ error: "Unknown or missing reason" });
  }

  const svc = getServiceClient();

  // Insert the audit row first. Unique on (user_id, reason) means a
  // duplicate request becomes a unique-violation that we treat as a
  // no-op. The increment on user_subscriptions only happens when the
  // insert actually succeeds.
  const { error: auditError } = await svc
    .from("trial_extensions")
    .insert({ user_id: user.id, days: config.days, reason });
  if (auditError) {
    if (auditError.code === "23505") {
      // Already granted — no-op. Return the current totals so the
      // client UI stays consistent.
      const { data: row } = await svc
        .from("user_subscriptions")
        .select("trial_extension_days")
        .eq("user_id", user.id)
        .maybeSingle();
      return res.status(200).json({
        ok: true, granted: false, totalDays: row?.trial_extension_days || 0,
      });
    }
    return res.status(500).json({ error: auditError.message });
  }

  // Bump the denormalized column. We need the existing user_subscriptions
  // row — for trial users who haven't started checkout yet there isn't
  // one, so we upsert. The unique on user_id makes this race-safe.
  const { data: existing } = await svc
    .from("user_subscriptions")
    .select("user_id, trial_extension_days, stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const newTotal = (existing?.trial_extension_days || 0) + config.days;
  if (existing) {
    await svc.from("user_subscriptions")
      .update({ trial_extension_days: newTotal, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);
  } else {
    // No row yet → create a placeholder. The Stripe customer will be
    // minted on first /api/stripe-checkout call; until then this row
    // exists purely to carry the trial_extension_days counter.
    await svc.from("user_subscriptions").insert({
      user_id: user.id,
      stripe_customer_id: `pending_${user.id}`,
      trial_extension_days: newTotal,
    });
  }

  return res.status(200).json({ ok: true, granted: true, totalDays: newTotal });
}

export default withSentry(handler, { name: "grant-trial-extension" });
