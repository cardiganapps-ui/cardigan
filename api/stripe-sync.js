/* ── POST /api/stripe-sync ────────────────────────────────────────────
   Force-reconcile the caller's user_subscriptions row with the truth
   in Stripe. Used as a safety net when webhook delivery lags or is
   missed entirely (e.g. user cancels via Billing Portal and refreshes
   the app before Stripe-side delivery propagates).

   Read-only against the user's own data — RLS-equivalent via a
   user_id filter on the lookup. Writes only to the row keyed on the
   authed user's user_id, never anyone else's. The handler is
   idempotent: rerunning it just overwrites with the same snapshot.

   This is the read-side companion to api/stripe-webhook.js. The
   field-mapping logic must stay aligned — when one changes shape,
   the other does too. (Same `current_period_end ?? items[0].current_period_end`
   fallback for API-version compatibility.) */

import { getAuthUser } from "./_r2.js";
import { getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";
import { rateLimit } from "./_ratelimit.js";
import { listCustomerSubscriptions } from "./_stripe.js";

function isoOrNull(unix) {
  if (!unix || typeof unix !== "number") return null;
  return new Date(unix * 1000).toISOString();
}

// Pick the subscription that best represents "current state" for the
// customer. Stripe can return multiple rows (e.g. an old canceled sub
// alongside a fresh one). Prefer the most recently created.
function pickCurrent(subs) {
  if (!Array.isArray(subs) || subs.length === 0) return null;
  return subs.slice().sort((a, b) => (b.created || 0) - (a.created || 0))[0];
}

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  // Cheap rate limit — avoids a hot-loop of the user clicking refresh
  // hammering Stripe's API. The webhook is still the primary source;
  // this endpoint is a fallback.
  const rl = await rateLimit({
    endpoint: "stripe-sync",
    bucket: user.id,
    max: 6,
    windowSec: 60,
  });
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfter));
    return res.status(429).json({ error: "Demasiadas solicitudes" });
  }

  const svc = getServiceClient();
  const { data: row, error: lookupError } = await svc
    .from("user_subscriptions")
    .select("stripe_customer_id, comp_granted")
    .eq("user_id", user.id)
    .maybeSingle();
  if (lookupError) return res.status(500).json({ error: "Lookup failed" });
  if (!row?.stripe_customer_id) return res.status(404).json({ error: "No subscription record" });
  // Comp users have no Stripe customer; nothing to sync.
  if (!/^cus_/.test(row.stripe_customer_id)) {
    return res.status(200).json({ synced: false, reason: "no_stripe_customer" });
  }

  let list;
  try {
    list = await listCustomerSubscriptions(row.stripe_customer_id);
  } catch (err) {
    return res.status(502).json({ error: err.message || "Stripe list failed" });
  }

  const sub = pickCurrent(list?.data || []);
  if (!sub) {
    // Customer exists but has no subscription — clear DB so the UI
    // drops to expired/trial as appropriate.
    await svc.from("user_subscriptions")
      .update({
        stripe_subscription_id: null,
        stripe_price_id: null,
        status: null,
        current_period_end: null,
        cancel_at_period_end: false,
        trial_end: null,
        default_payment_method: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);
    return res.status(200).json({ synced: true, status: null });
  }

  const item = sub.items?.data?.[0];
  const periodEndUnix = sub.current_period_end ?? item?.current_period_end ?? null;
  const dpm = sub.default_payment_method;
  const defaultPaymentMethod = typeof dpm === "string" ? dpm : (dpm?.id || null);

  const update = {
    stripe_subscription_id: sub.id,
    stripe_price_id: item?.price?.id || null,
    status: sub.status,
    current_period_end: isoOrNull(periodEndUnix),
    cancel_at_period_end: !!sub.cancel_at_period_end,
    trial_end: isoOrNull(sub.trial_end),
    default_payment_method: defaultPaymentMethod,
    updated_at: new Date().toISOString(),
  };

  const { error: updError } = await svc
    .from("user_subscriptions")
    .update(update)
    .eq("user_id", user.id);
  if (updError) return res.status(500).json({ error: updError.message });

  return res.status(200).json({
    synced: true,
    status: sub.status,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    current_period_end: update.current_period_end,
  });
}

export default withSentry(handler, { name: "stripe-sync" });
