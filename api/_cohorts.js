/* ── Pure helpers for lifecycle cohort eligibility ────────────────
   Extracted from send-session-reminders.js so the date-window math
   and subscription-state predicate are unit-testable without
   mocking the Supabase client. The cron handler (which knows about
   pagination, dedupe, and rate limits) imports these and stays in
   send-session-reminders.js. */

/** Compute the [lower, upper) ISO window for a cohort that fires
 *  exactly `daysSince` days after the anchor event, with a
 *  `windowDays` grace tail.
 *
 *    lower = now − (daysSince + windowDays) days
 *    upper = now −  daysSince              days
 *
 *  A timestamp T qualifies when `T >= lower && T < upper`. Default
 *  `now` makes the function pure & easy to test. */
export function cohortWindow(daysSince, windowDays, now = Date.now()) {
  const upper = new Date(now - daysSince * 86_400_000).toISOString();
  const lower = new Date(now - (daysSince + windowDays) * 86_400_000).toISOString();
  return { lower, upper };
}

/** True iff `timestamp` falls in [lower, upper). Strings compare
 *  lexicographically when in matching ISO formats — no parsing
 *  needed. NaN-safe: missing timestamps are excluded. */
export function isInCohortWindow(timestamp, lower, upper) {
  if (!timestamp) return false;
  return timestamp >= lower && timestamp < upper;
}

/** Build a Map<user_id, first_paid_at_iso> from a list of invoice
 *  rows ordered ASC by paid_at. The first invoice we see for each
 *  user is — by construction — their earliest. */
export function firstPaidByUser(invoices) {
  const out = new Map();
  for (const inv of invoices || []) {
    if (!inv.user_id || !inv.paid_at) continue;
    if (!out.has(inv.user_id)) out.set(inv.user_id, inv.paid_at);
  }
  return out;
}

/** Mirror of useSubscription.js::isPro on the cron side. Returns
 *  true when the user has any form of paying-or-equivalent access:
 *    - admin-granted comp
 *    - active or past_due Stripe sub
 *    - trialing sub with a real default_payment_method (not the
 *      Pro-without-card orphan state)
 *  Used to gate trial-stage cohorts off of users who've already
 *  converted. */
export function hasActiveSubscription(sub) {
  if (!sub) return false;
  if (sub.comp_granted) return true;
  if (sub.status === "active") return true;
  if (sub.status === "past_due") return true;
  if (sub.status === "trialing" && !!sub.default_payment_method) return true;
  return false;
}
