/* ── POST /api/stripe-create-subscription ─────────────────────────────
   Native checkout entrypoint. Creates a subscription server-side in
   `default_incomplete` payment mode and returns the client_secret the
   browser needs to confirm the first invoice via Stripe Elements.

   Why a separate endpoint from /api/stripe-checkout:
     - The hosted-Checkout flow returns a Session URL the browser
       redirects to. The native Elements flow needs an in-page
       client_secret + a SetupIntent or PaymentIntent type so the
       client can call stripe.confirmPayment / confirmSetup inline.
     - Keeping both endpoints means we can keep the hosted flow
       reachable as a fallback (e.g. if Stripe.js fails to load) and
       avoid coupling the two response shapes.

   Trial honoring:
     The user's natural Cardigan trial is 30 days from auth.users
     created_at. If they have remaining trial days when they subscribe,
     we set the Stripe sub's `trial_end` to `created_at + 30 days` so
     they're not charged early. If their trial has already lapsed
     (accessState === "expired"), we charge immediately.

   When trial_end is in the future:
     - First invoice is $0
     - latest_invoice has no PaymentIntent
     - Stripe creates a `pending_setup_intent` instead — a SetupIntent
       so the customer's card can be attached for the eventual first
       charge. Client uses confirmSetup() with that client_secret.

   When trial_end is in the past or omitted:
     - First invoice is $299 MXN
     - latest_invoice.payment_intent has a client_secret
     - Client uses confirmPayment() with that client_secret. */

import { getAuthUser } from "./_r2.js";
import { getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";
import {
  createCustomer,
  createSubscription,
  cancelSubscription,
  getPriceId,
  creditCustomerBalance,
  resolvePlan,
  trialEndUnixFromUser,
} from "./_stripe.js";

const MXN = "mxn";

function parseReferralCode(body) {
  if (!body || typeof body !== "object") return null;
  const raw = body.referral_code;
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  if (!code || code.length > 16 || !/^[A-Z0-9]+$/.test(code)) return null;
  return code;
}

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  let body = {};
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}); }
  catch { /* malformed body — proceed with empty */ }
  const referralCode = parseReferralCode(body);
  const plan = resolvePlan(body.plan);

  const svc = getServiceClient();

  const { data: existing, error: lookupError } = await svc
    .from("user_subscriptions")
    .select("stripe_customer_id, stripe_subscription_id, status, comp_granted, referred_by, pending_credit_amount_cents, default_payment_method")
    .eq("user_id", user.id)
    .maybeSingle();
  if (lookupError) return res.status(500).json({ error: "Lookup failed" });

  if (existing?.comp_granted) {
    return res.status(409).json({ error: "Account has complimentary access", action: "comp_granted" });
  }
  // "Genuinely paid" = card on file. A `trialing` sub with no
  // default_payment_method is an abandoned payment-sheet orphan;
  // refusing here would soft-lock the user out of retrying. Instead
  // we let the flow continue and cancel the orphan further down so
  // Stripe doesn't fire failed-invoice noise when its trial expires.
  const existingHasPaidSub = existing?.stripe_subscription_id
    && (
      ["active", "past_due"].includes(existing.status)
      || (existing.status === "trialing" && !!existing.default_payment_method)
    );
  if (existingHasPaidSub) {
    return res.status(409).json({ error: "Subscription already active", action: "use_portal" });
  }
  // Orphan from an abandoned earlier attempt — cancel at Stripe so
  // the user can retry cleanly. Best-effort: a Stripe-side failure
  // here shouldn't block a retry; the worst case is one stale sub
  // sitting around until its trial ages out.
  if (existing?.stripe_subscription_id && !existingHasPaidSub) {
    try {
      await cancelSubscription(existing.stripe_subscription_id);
    } catch (err) {
      console.warn("stripe-create-subscription: cancel orphan failed:", err.message);
    }
    await svc.from("user_subscriptions")
      .update({
        stripe_subscription_id: null,
        status: null,
        current_period_end: null,
        trial_end: null,
        default_payment_method: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);
  }

  // Resolve referral. Self-referral and unknown codes are silently
  // ignored — same policy as /api/stripe-checkout.
  let resolvedReferredBy = null;
  if (referralCode) {
    const { data: inviter } = await svc
      .from("user_subscriptions")
      .select("user_id, referral_code")
      .eq("referral_code", referralCode)
      .maybeSingle();
    if (inviter && inviter.user_id !== user.id) resolvedReferredBy = referralCode;
  }

  // Mint or reuse Stripe customer. Placeholder ids (`pending_<uuid>`,
  // `comp_<uuid>`) mean we have a row but no real Stripe customer yet
  // — we need to create one before subscribing.
  const existingCustId = existing?.stripe_customer_id;
  const isPlaceholder = existingCustId && /^(pending|comp)_/.test(existingCustId);
  let customerId = isPlaceholder ? null : existingCustId;
  if (!customerId) {
    let customer;
    try {
      customer = await createCustomer({
        email: user.email,
        name: user.user_metadata?.full_name || undefined,
        metadata: { user_id: user.id },
      });
    } catch (err) {
      return res.status(502).json({ error: err.message || "Stripe customer create failed" });
    }
    customerId = customer.id;
    const persist = {
      user_id: user.id,
      stripe_customer_id: customerId,
      ...(resolvedReferredBy && !existing?.referred_by ? { referred_by: resolvedReferredBy } : {}),
      updated_at: new Date().toISOString(),
    };
    if (existing) {
      await svc.from("user_subscriptions").update(persist).eq("user_id", user.id);
    } else {
      await svc.from("user_subscriptions").insert(persist);
    }
  } else if (resolvedReferredBy && !existing?.referred_by) {
    await svc.from("user_subscriptions")
      .update({ referred_by: resolvedReferredBy, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);
  }

  // Drain pending referral credit into the customer's balance before
  // the subscription is created — Stripe auto-applies the balance to
  // the very first invoice. Best-effort.
  const pending = existing?.pending_credit_amount_cents || 0;
  if (pending > 0) {
    try {
      await creditCustomerBalance({
        customerId,
        amountCents: pending,
        currency: MXN,
        description: "Crédito acumulado por invitaciones",
        metadata: { user_id: user.id, kind: "drain_pending" },
        idempotencyKey: `cardigan-credit-drain-${user.id}-${pending}`,
      });
      await svc.from("user_subscriptions")
        .update({ pending_credit_amount_cents: 0, updated_at: new Date().toISOString() })
        .eq("user_id", user.id);
    } catch (err) {
      console.warn("stripe-create-subscription: drain pending failed:", err.message);
    }
  }

  const trialEndSec = trialEndUnixFromUser(user);
  const finalReferredBy = resolvedReferredBy
    || (existing?.referred_by && !resolvedReferredBy ? existing.referred_by : null);

  let priceId;
  try { priceId = getPriceId(plan); }
  catch (err) { return res.status(500).json({ error: err.message }); }

  let subscription;
  try {
    subscription = await createSubscription({
      customerId,
      priceId,
      trialEnd: trialEndSec || undefined,
      userId: user.id,
      metadata: {
        user_id: user.id,
        ...(finalReferredBy ? { referred_by: finalReferredBy } : {}),
      },
    });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Stripe subscription create failed" });
  }

  // Pull the right client_secret + type. With trial_end in the future,
  // Stripe doesn't generate a PaymentIntent (the first invoice is $0),
  // and we need the SetupIntent to attach a payment method instead.
  const setupIntent = subscription.pending_setup_intent;
  const paymentIntent = subscription.latest_invoice?.payment_intent;
  let clientSecret = null;
  let intentType = null;
  if (setupIntent?.client_secret) {
    clientSecret = setupIntent.client_secret;
    intentType = "setup";
  } else if (paymentIntent?.client_secret) {
    clientSecret = paymentIntent.client_secret;
    intentType = "payment";
  }

  if (!clientSecret) {
    // Subscription exists but neither intent surfaced a client_secret.
    // This shouldn't happen with default_incomplete; surface as 502 so
    // the user retries rather than seeing a stuck Elements form.
    return res.status(502).json({ error: "Stripe response missing client secret" });
  }

  return res.status(200).json({
    subscription_id: subscription.id,
    client_secret: clientSecret,
    intent_type: intentType,
    trial_end: trialEndSec || null,
  });
}

export default withSentry(handler, { name: "stripe-create-subscription" });
