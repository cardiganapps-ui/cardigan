/* ── Stripe helper (fetch-based, no SDK) ──────────────────────────────
   Cardigan uses Stripe for the SaaS-side subscription (therapist pays
   Cardigan $299 MXN/month for "Cardigan Pro"). We deliberately keep
   this layer thin and SDK-free for two reasons:

     1. The Stripe Node SDK is ~2 MB cold-start weight. We use about
        four endpoints — Customers, Checkout Sessions, Billing Portal
        Sessions, and webhook signature verification — all of which
        are short HTTP calls or HMAC operations.
     2. The repo already verifies HMAC webhooks by hand (see
        api/resend-webhook.js + api/whatsapp-webhook.js), so reaching
        for the SDK just for `stripe.webhooks.constructEvent` would be
        a dependency for one function call.

   This file is a server-only helper. It must NEVER be imported from
   `src/` — that would bundle the Stripe secret key into the browser.

   ── Test vs. live ──────────────────────────────────────────────────
   We pick the secret key from `STRIPE_SECRET_KEY`. The webhook secret
   comes from `STRIPE_WEBHOOK_SECRET`. Both are set in Vercel project
   env (Production = live, Preview/Development = test). One more env —
   `STRIPE_PRICE_ID` — names the recurring price the Checkout flow
   should attach. All three change atomically when you flip a project
   from test to live; never mix and match. */

import crypto from "node:crypto";
import { Buffer } from "node:buffer";

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const TRIAL_DAYS = 30;

function getSecret() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  return key.trim();
}

// Pick the right Stripe Price for a given plan. Annual lives in
// STRIPE_PRICE_ID_ANNUAL ($2,990 MXN/yr ≈ 17% off); monthly remains the
// default at STRIPE_PRICE_ID. Both env vars flip atomically between
// test and live mode (Preview/Development = test, Production = live).
export function getPriceId(plan = "monthly") {
  const envKey = plan === "annual" ? "STRIPE_PRICE_ID_ANNUAL" : "STRIPE_PRICE_ID";
  const id = process.env[envKey];
  if (!id) throw new Error(`${envKey} not configured`);
  return id.trim();
}

// Whitelist for the `plan` request param. Anything else collapses to
// monthly so a tampered client can't push us at an arbitrary price id.
export function resolvePlan(input) {
  const v = typeof input === "string" ? input.trim().toLowerCase() : "";
  return v === "annual" ? "annual" : "monthly";
}

// Cardigan-side trial: 30 days from auth.users.created_at. Returns the
// unix-second timestamp suitable for Stripe's `trial_end`, or null if
// the trial has already lapsed (Stripe rejects past `trial_end`).
// Centralized here so both checkout endpoints share one definition.
export function trialEndUnixFromUser(user, days = TRIAL_DAYS) {
  if (!user?.created_at) return null;
  const created = new Date(user.created_at);
  if (Number.isNaN(created.getTime())) return null;
  const trialEnd = new Date(created.getTime() + days * 86_400_000);
  const nowSec = Math.floor(Date.now() / 1000);
  const trialEndSec = Math.floor(trialEnd.getTime() / 1000);
  if (trialEndSec <= nowSec + 60) return null;
  return trialEndSec;
}

export function getWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not configured");
  return secret.trim();
}

/* Stripe expects application/x-www-form-urlencoded with bracketed keys
   for nested objects. URLSearchParams handles flat key/value pairs;
   for nested ones we stringify keys ourselves so e.g.
     { line_items: [{ price: "p_…", quantity: 1 }] }
   becomes
     line_items[0][price]=p_…&line_items[0][quantity]=1 */
function encodeBody(obj) {
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

async function stripeFetch(path, { method = "POST", body, idempotencyKey } = {}) {
  const headers = {
    "Authorization": `Bearer ${getSecret()}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    method,
    headers,
    body: body ? encodeBody(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `Stripe ${path} failed (${res.status})`;
    const err = new Error(msg);
    err.statusCode = res.status;
    err.stripeCode = json?.error?.code;
    throw err;
  }
  return json;
}

export function createCustomer({ email, name, metadata }) {
  // Idempotency-keyed by user_id (supplied via metadata.user_id) so a
  // double-click on "Suscribirme" can't mint two Stripe customers for
  // the same Cardigan user.
  const userId = metadata?.user_id;
  return stripeFetch("/customers", {
    body: {
      email,
      name,
      metadata: metadata || {},
    },
    idempotencyKey: userId ? `cardigan-customer-${userId}` : undefined,
  });
}

export function createCheckoutSession({ customerId, priceId, successUrl, cancelUrl, metadata }) {
  // Mirror every metadata key onto BOTH the Checkout Session and the
  // Subscription so downstream webhooks (subscription.* and
  // invoice.paid → which carries `subscription`) can see them. Using
  // bracketed keys directly here is fine — encodeBody passes through
  // anything we already serialized.
  const body = {
    mode: "subscription",
    customer: customerId,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": 1,
    success_url: successUrl,
    cancel_url: cancelUrl,
    locale: "es",
    allow_promotion_codes: "true",
  };
  for (const [k, v] of Object.entries(metadata || {})) {
    if (v == null) continue;
    body[`metadata[${k}]`] = String(v);
    body[`subscription_data[metadata][${k}]`] = String(v);
  }
  return stripeFetch("/checkout/sessions", { body });
}

export function createBillingPortalSession({ customerId, returnUrl }) {
  return stripeFetch("/billing_portal/sessions", {
    body: {
      customer: customerId,
      return_url: returnUrl,
    },
  });
}

export function getSubscription(subscriptionId) {
  return stripeFetch(`/subscriptions/${subscriptionId}`, { method: "GET" });
}

/* List subscriptions for a customer. Used by the force-sync flow to
   reconcile DB state with Stripe's truth when a webhook delivery is
   delayed or missed (e.g. user cancels in portal then immediately
   refreshes — webhook hasn't arrived yet, DB still says "active"). */
export function listCustomerSubscriptions(customerId) {
  return stripeFetch(
    `/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=10`,
    { method: "GET" }
  );
}

export function cancelSubscription(subscriptionId) {
  return stripeFetch(`/subscriptions/${subscriptionId}`, { method: "DELETE" });
}

/* Create a Stripe subscription server-side in default_incomplete payment
   mode. The browser confirms the first invoice via Stripe Elements using
   the returned client_secret. Idempotency-keyed by user_id + minute-
   bucket so a double-click on Confirm can't create two subs against the
   same customer. */
export function createSubscription({ customerId, priceId, trialEnd, metadata, userId }) {
  const body = {
    customer: customerId,
    "items[0][price]": priceId,
    "items[0][quantity]": 1,
    payment_behavior: "default_incomplete",
    "payment_settings[save_default_payment_method]": "on_subscription",
    "expand[0]": "latest_invoice.payment_intent",
    "expand[1]": "pending_setup_intent",
  };
  if (trialEnd) body.trial_end = trialEnd;
  for (const [k, v] of Object.entries(metadata || {})) {
    if (v == null) continue;
    body[`metadata[${k}]`] = String(v);
  }
  // Bucket the idempotency key to one minute. A genuine retry after a
  // network blip lands in the same bucket → Stripe returns the same sub.
  // A user who wanted a second sub a minute later (rare; not really a
  // path we support) gets a fresh one.
  const idempotencyKey = userId
    ? `cardigan-sub-${userId}-${Math.floor(Date.now() / 60000)}`
    : undefined;
  return stripeFetch("/subscriptions", { body, idempotencyKey });
}

/* Apply a Stripe customer-balance credit. `amountCents` should be
   positive — we negate internally because Stripe uses NEGATIVE values
   for credits and POSITIVE for debits. The credit is auto-applied to
   the customer's next invoice. Used by the referral reward flow when
   an invitee converts to a paid sub.

   Idempotency key is required-by-convention: the webhook passes the
   originating Stripe event id (`cardigan-credit-<event_id>`), so a
   re-delivered invoice.paid can't double-post the credit. Non-webhook
   callers (drain pending at checkout) pass a one-shot UUID since the
   call is naturally guarded by a `pending_credit_amount_cents > 0`
   precondition cleared after a successful post. */
export function creditCustomerBalance({ customerId, amountCents, currency = "mxn", description, metadata, idempotencyKey }) {
  const key = idempotencyKey || `cardigan-credit-${crypto.randomUUID()}`;
  return stripeFetch(`/customers/${customerId}/balance_transactions`, {
    body: {
      amount: -Math.abs(amountCents),
      currency,
      description: description || "Cardigan referral reward",
      metadata: metadata || {},
    },
    idempotencyKey: key,
  });
}

/* ── Webhook signature verification ─────────────────────────────────
   Stripe's `Stripe-Signature` header is of the shape:
     t=1492774577,v1=5257a869e7…,v1=…
   where `t` is the unix-second timestamp the event was signed at and
   each `v1` is an HMAC-SHA256 of `${t}.${rawBody}` keyed with the
   endpoint secret (whsec_…). Multiple v1 entries can appear during a
   secret rotation; any matching signature passes.

   Reject events older than `tolerance` seconds — the default of 5
   minutes matches the SDK and prevents replay of an old captured
   event. */
const DEFAULT_TOLERANCE_SEC = 5 * 60;

export function verifyStripeSignature({ rawBody, header, secret, tolerance = DEFAULT_TOLERANCE_SEC }) {
  if (!header || typeof header !== "string") return false;
  const parts = header.split(",").map((p) => p.trim());
  let timestamp = null;
  const signatures = [];
  for (const part of parts) {
    const [k, v] = part.split("=");
    if (k === "t") timestamp = v;
    else if (k === "v1") signatures.push(v);
  }
  if (!timestamp || signatures.length === 0) return false;

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > tolerance) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  return signatures.some((sig) => {
    try {
      const sigBuf = Buffer.from(sig, "hex");
      return sigBuf.length === expectedBuf.length
        && crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  });
}

export async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
