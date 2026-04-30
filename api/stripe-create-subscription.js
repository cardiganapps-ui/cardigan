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
import { createCustomer, getPriceId, creditCustomerBalance } from "./_stripe.js";

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const TRIAL_DAYS = 30;
const MXN = "mxn";

function getSecretKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  return key.trim();
}

function encodeBody(obj) {
  // Mirror of api/_stripe.js — duplicated locally to avoid widening
  // that helper's surface for one extra fetch path. Stripe expects
  // `application/x-www-form-urlencoded` with bracketed keys for nested
  // objects and arrays.
  const params = new URLSearchParams();
  const append = (key, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => append(`${key}[${i}]`, v));
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) append(`${key}[${k}]`, v);
    } else {
      params.append(key, String(value));
    }
  };
  for (const [k, v] of Object.entries(obj)) append(k, v);
  return params.toString();
}

async function stripeFetch(path, body) {
  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${getSecretKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? encodeBody(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Stripe ${path} failed (${res.status})`);
    err.statusCode = res.status;
    throw err;
  }
  return json;
}

function parseReferralCode(body) {
  if (!body || typeof body !== "object") return null;
  const raw = body.referral_code;
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  if (!code || code.length > 16 || !/^[A-Z0-9]+$/.test(code)) return null;
  return code;
}

function trialEndUnixFromUser(user) {
  if (!user?.created_at) return null;
  const created = new Date(user.created_at);
  if (Number.isNaN(created.getTime())) return null;
  const trialEnd = new Date(created.getTime() + TRIAL_DAYS * 86_400_000);
  // If the trial already lapsed, return null so we don't pass an
  // in-the-past trial_end (Stripe rejects that).
  const nowSec = Math.floor(Date.now() / 1000);
  const trialEndSec = Math.floor(trialEnd.getTime() / 1000);
  if (trialEndSec <= nowSec + 60) return null; // <60s = "no real trial left"
  return trialEndSec;
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

  const svc = getServiceClient();

  const { data: existing, error: lookupError } = await svc
    .from("user_subscriptions")
    .select("stripe_customer_id, stripe_subscription_id, status, comp_granted, referred_by, pending_credit_amount_cents")
    .eq("user_id", user.id)
    .maybeSingle();
  if (lookupError) return res.status(500).json({ error: "Lookup failed" });

  if (existing?.comp_granted) {
    return res.status(409).json({ error: "Account has complimentary access", action: "comp_granted" });
  }
  if (existing?.stripe_subscription_id
    && ["active", "trialing", "past_due"].includes(existing.status)) {
    return res.status(409).json({ error: "Subscription already active", action: "use_portal" });
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

  // Build the subscription. payment_behavior=default_incomplete tells
  // Stripe to create the sub but NOT actually charge until we confirm
  // the PaymentIntent / SetupIntent client-side. save_default_payment_method
  // attaches the collected card to the customer for future renewals.
  const subBody = {
    customer: customerId,
    "items[0][price]": getPriceId(),
    "items[0][quantity]": 1,
    payment_behavior: "default_incomplete",
    "payment_settings[save_default_payment_method]": "on_subscription",
    // Expand both potential client_secret carriers in one round-trip.
    "expand[0]": "latest_invoice.payment_intent",
    "expand[1]": "pending_setup_intent",
    "metadata[user_id]": user.id,
  };
  if (trialEndSec) subBody.trial_end = trialEndSec;
  if (finalReferredBy) subBody["metadata[referred_by]"] = finalReferredBy;

  let subscription;
  try {
    subscription = await stripeFetch("/subscriptions", subBody);
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
