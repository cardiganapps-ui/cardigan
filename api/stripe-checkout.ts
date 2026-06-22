/* ── POST /api/stripe-checkout ────────────────────────────────────────
   Starts (or restarts) the subscribe-to-Cardigan-Pro flow. The client
   calls this from Settings → Suscripción → "Suscribirme".

   Flow:
     1. Verify the caller's JWT (Bearer token).
     2. Look up an existing user_subscriptions row to reuse the Stripe
        customer if one already exists (a returning user who cancelled
        and is re-subscribing).
     3. If none, mint a new Stripe customer (idempotency-keyed by
        user_id so a double-click can't make two), then UPSERT a
        user_subscriptions row with the new stripe_customer_id.
     4. Create a Stripe Checkout Session pointed at the configured
        recurring price, scoped to that customer.
     5. Return the Checkout URL — the client redirects via
        window.location.

   The actual subscription record is written by api/stripe-webhook.js
   when Stripe sends `checkout.session.completed` /
   `customer.subscription.created`. We never trust client-side data to
   set status; only the webhook is authoritative. */

import { getAuthUser } from "./_r2.js";
import { getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";
import { rateLimit } from "./_ratelimit.js";
import { createCustomer, createCheckoutSession, getPriceId, creditCustomerBalance, resolvePlan } from "./_stripe.js";
import { safeAppOrigin } from "./_origin.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const MXN = "mxn";

// Pull a referral code from the request body, normalize, and clamp to
// a sane length so we don't leak a 10 KB string into a SQL filter.
function parseReferralCode(body: Row) {
  if (!body || typeof body !== "object") return null;
  const raw = body.referral_code;
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  if (!code || code.length > 16 || !/^[A-Z0-9]+$/.test(code)) return null;
  return code;
}

// Influencer codes (separate from peer-to-peer referral codes — these
// are admin-issued partner promos that auto-apply a Stripe Coupon at
// Checkout). Same A-Z 0-9 alphabet but allow up to 20 chars per the
// influencer_codes.code check constraint.
function parseInfluencerCode(body: Row) {
  if (!body || typeof body !== "object") return null;
  const raw = body.influencer_code;
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  if (!code || code.length > 20 || !/^[A-Z0-9]+$/.test(code)) return null;
  return code;
}

function appOrigin(req: Row) {
  // Origin / Referer are attacker-controllable; safeAppOrigin
  // allowlists production + preview + localhost and falls back to the
  // canonical domain otherwise so a forged header can't bounce the
  // user to attacker.com after Stripe redirects them.
  return safeAppOrigin(req);
}

async function handler(req: Row, res: Row) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  // Per-user limiter — checkout creation hits Stripe (paid API) and
  // potentially writes new customer rows. 5 attempts in 60s is plenty
  // for a user retrying after a card decline; way under what an
  // automated abuser would need to be a problem.
  const rl = await rateLimit({
    endpoint: "stripe-checkout",
    bucket: user.id,
    max: 5,
    windowSec: 60,
  });
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfter));
    return res.status(429).json({ error: "Demasiados intentos. Espera un minuto." });
  }

  // Parse + validate referral code (optional). The code is stored on
  // the user_subscriptions row and replicated to Stripe sub metadata
  // so the webhook can find the inviter on invoice.paid.
  let body: Row = {};
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}); }
  catch { /* malformed body, ignore — proceed without referral */ }
  const referralCode = parseReferralCode(body);
  const influencerCode = parseInfluencerCode(body);
  const plan = resolvePlan(body.plan);

  const svc = getServiceClient();

  // 1. Look up existing customer/subscription row.
  const { data: existing, error: lookupError } = await svc
    .from("user_subscriptions")
    .select("stripe_customer_id, stripe_subscription_id, status, comp_granted, referred_by, referral_code, pending_credit_amount_cents, default_payment_method, influencer_code_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (lookupError) {
    return res.status(500).json({ error: "Lookup failed" });
  }

  // Resolve the referral code to an actual inviter user_id. Self-
  // referral (using your own code) is rejected. If the code doesn't
  // match anyone, we ignore it silently rather than 400 — a typo
  // shouldn't block someone from subscribing; they just won't credit
  // a phantom inviter.
  let resolvedReferredBy = null;
  if (referralCode) {
    const { data: inviter } = await svc
      .from("user_subscriptions")
      .select("user_id, referral_code")
      .eq("referral_code", referralCode)
      .maybeSingle();
    if (inviter && inviter.user_id !== user.id) {
      resolvedReferredBy = referralCode;
    }
  }

  // Resolve influencer code to its Stripe Promotion Code id. Inactive
  // codes are filtered out so a disabled code can't be used by
  // someone who saved the link earlier. Unknown / inactive / malformed
  // codes are silently ignored — same philosophy as the referral code:
  // a bad code shouldn't block someone from subscribing.
  let resolvedInfluencer = null;
  if (influencerCode) {
    const { data: ic } = await svc
      .from("influencer_codes")
      .select("id, stripe_promotion_code_id")
      .eq("code", influencerCode)
      .eq("active", true)
      .maybeSingle();
    if (ic) resolvedInfluencer = ic;
  }

  // Comp-granted users have unlimited free access — refuse to start a
  // paid Checkout. The UI hides the "Suscribirme" CTA in this case but
  // we double-check on the server: a stale tab that still shows the
  // button shouldn't be able to put the user on a paid plan.
  if (existing?.comp_granted) {
    return res.status(409).json({
      error: "Account has complimentary access",
      action: "comp_granted",
    });
  }

  // Refuse only when the existing sub is genuinely paid — a `trialing`
  // sub without a `default_payment_method` is an abandoned payment-
  // sheet orphan, and refusing here would soft-lock the user out of
  // retrying. The hosted-Checkout flow always attaches a payment
  // method up front (different from the native PaymentSheet), so this
  // check is mostly defensive.
  const existingHasPaidSub = existing?.stripe_subscription_id
    && (
      ["active", "past_due"].includes(existing.status)
      || (existing.status === "trialing" && !!existing.default_payment_method)
    );
  if (existingHasPaidSub) {
    return res.status(409).json({
      error: "Subscription already active",
      action: "use_portal",
    });
  }

  // 2/3. Reuse or mint customer. Treat placeholder customer ids
  // (`pending_<uuid>` from referral-code lazy-create, `comp_<uuid>`
  // from admin-grant-comp) as "no real customer yet" — we still need
  // to mint one before we can run Checkout. Comp users are gated out
  // above, so only the `pending_*` case reaches here.
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
    } catch (err: Row) {
      return res.status(502).json({ error: err.message || "Stripe customer create failed" });
    }
    customerId = customer.id;

    // Persist the real customer id. We use update-or-insert
    // explicitly: an update is correct when there's a placeholder
    // row (referral lazy-create), an insert is correct when there's
    // no row at all. Both leave the comp_granted / referral_code
    // fields untouched.
    const persistFields: Row = {
      user_id: user.id,
      stripe_customer_id: customerId,
      // Stamp referred_by ONLY when we resolved a valid code; never
      // overwrite an existing referred_by in case the user clicks
      // checkout twice with different codes.
      ...(resolvedReferredBy && !existing?.referred_by
        ? { referred_by: resolvedReferredBy }
        : {}),
      // Stamp influencer attribution on first checkout — never
      // overwrite an existing influencer_code_id.
      ...(resolvedInfluencer && !existing?.influencer_code_id
        ? { influencer_code_id: resolvedInfluencer.id }
        : {}),
      updated_at: new Date().toISOString(),
    };
    if (existing) {
      const { error } = await svc.from("user_subscriptions")
        .update(persistFields).eq("user_id", user.id);
      if (error) return res.status(500).json({ error: "Failed to persist customer record" });
    } else {
      const { error } = await svc.from("user_subscriptions").insert(persistFields);
      if (error) return res.status(500).json({ error: "Failed to persist customer record" });
    }
  } else if (
    (resolvedReferredBy && !existing?.referred_by)
    || (resolvedInfluencer && !existing?.influencer_code_id)
  ) {
    // Customer already exists but the attribution columns aren't
    // stamped yet — set whichever is missing. First-checkout-after-
    // resub case for either signal.
    const updates: Row = { updated_at: new Date().toISOString() };
    if (resolvedReferredBy && !existing?.referred_by) updates.referred_by = resolvedReferredBy;
    if (resolvedInfluencer && !existing?.influencer_code_id) {
      updates.influencer_code_id = resolvedInfluencer.id;
    }
    await svc.from("user_subscriptions").update(updates).eq("user_id", user.id);
  }

  // Drain any accrued pending referral credit into the Stripe
  // customer balance. This covers the "trial user accrued rewards
  // before subscribing" path: their pending_credit_amount_cents is
  // posted to Stripe customer.balance now, and Stripe auto-applies
  // it to the first invoice. Best-effort — a failure here shouldn't
  // block the checkout flow; we'd rather have them on a paid plan
  // and chase the credit reconciliation later.
  const pending = existing?.pending_credit_amount_cents || 0;
  if (pending > 0) {
    try {
      await creditCustomerBalance({
        customerId,
        amountCents: pending,
        currency: MXN,
        description: "Crédito acumulado por invitaciones",
        metadata: { user_id: user.id, kind: "drain_pending" },
        // Stable per-user-per-amount key so a retried checkout call
        // can't double-post the same drain. The amount is captured here
        // because we ALSO clear pending_credit_amount_cents below; a
        // retry on the same pending balance lands in the same idempotency
        // bucket and Stripe returns the original credit unchanged.
        idempotencyKey: `cardigan-credit-drain-${user.id}-${pending}`,
      });
      await svc.from("user_subscriptions")
        .update({ pending_credit_amount_cents: 0, updated_at: new Date().toISOString() })
        .eq("user_id", user.id);
    } catch (err: Row) {
      // Log but don't fail the request.
      console.warn("stripe-checkout: drain pending credit failed:", err.message);
    }
  }

  // 4. Build the Checkout Session.
  const origin = appOrigin(req);
  let priceId;
  try { priceId = getPriceId(plan); }
  catch (err: Row) { return res.status(500).json({ error: err.message }); }

  // Stamp the referred_by code into Stripe subscription metadata so
  // the webhook can find it via the event payload (avoids an extra DB
  // round-trip in the hot reward path).
  const finalReferredBy = resolvedReferredBy
    || (existing?.referred_by && !resolvedReferredBy ? existing.referred_by : null);

  // Auto-apply the influencer discount ONLY when this user is likely
  // a first-time subscriber. Stripe's Promotion Code has
  // first_time_transaction:true; if we auto-apply for a returning
  // subscriber Stripe rejects the whole Checkout Session creation
  // (400) and the user can't subscribe at all. Skipping auto-apply
  // for returning users still leaves attribution stamped on the
  // user_subscriptions row above, AND the manual-entry path
  // (allow_promotion_codes:true, set when promotionCodeId is omitted)
  // lets the user try the code by hand — Stripe will then give a
  // clear "este código solo aplica a clientes nuevos" message.
  const likelyFirstTime = !existing?.stripe_subscription_id;
  const autoApplyPromoId = (resolvedInfluencer && likelyFirstTime)
    ? resolvedInfluencer.stripe_promotion_code_id
    : undefined;

  let session;
  // The discount auto-apply has several failure modes (admin deleted
  // the Stripe Coupon from dashboard, our first_time_transaction
  // heuristic was wrong, race against a toggle, archived promotion
  // code, etc). When any of those fail, we don't want to block the
  // user from subscribing — fall back to a no-discount Checkout
  // Session. Attribution stays stamped on user_subscriptions, and
  // allow_promotion_codes:true on the no-discount path lets the
  // user retry the code manually at Stripe Checkout (where Stripe
  // shows a clearer "este código solo aplica a clientes nuevos"
  // type error if it's still ineligible).
  const buildSession = (promoId: Row) => createCheckoutSession({
    customerId,
    priceId,
    successUrl: `${origin}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origin}/?billing=cancel`,
    metadata: {
      user_id: user.id,
      ...(finalReferredBy ? { referred_by: finalReferredBy } : {}),
      ...(resolvedInfluencer ? { influencer_code_id: resolvedInfluencer.id } : {}),
    },
    promotionCodeId: promoId,
  });

  try {
    session = await buildSession(autoApplyPromoId);
  } catch (err: Row) {
    if (autoApplyPromoId) {
      console.warn("stripe-checkout: auto-apply discount failed, retrying without:", err?.message);
      try {
        session = await buildSession(undefined);
      } catch (err2: Row) {
        return res.status(502).json({ error: err2.message || "Stripe checkout create failed" });
      }
    } else {
      return res.status(502).json({ error: err.message || "Stripe checkout create failed" });
    }
  }

  return res.status(200).json({ url: session.url });
}

export default withSentry(handler, { name: "stripe-checkout" });
