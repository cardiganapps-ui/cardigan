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
// Pin the API version so behavior is stable across Stripe's automatic
// account-version upgrades. This account was auto-upgraded to a
// version that renamed the `coupon` parameter on /promotion_codes,
// breaking the influencer-codes feature; pinning to 2024-04-10
// (which supports `coupon` as documented) restores deterministic
// behavior across every endpoint we hit. Bumping this is a deliberate
// migration step — verify all helpers + the webhook handler against
// the new version's changelog before changing.
const STRIPE_API_VERSION = "2024-04-10";
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

async function stripeFetch(path, { method = "POST", body, idempotencyKey, stripeAccount } = {}) {
  const headers = {
    "Authorization": `Bearer ${getSecret()}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "Stripe-Version": STRIPE_API_VERSION,
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  // Connect: sending `Stripe-Account: acct_...` makes the call act ON
  // BEHALF of that connected account (direct charges pattern). The
  // platform key still authenticates; the header just scopes the
  // operation. Used for /payment_intents, /checkout/sessions, etc.
  // when the merchant of record is the therapist, not Cardigan.
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
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

export function createCheckoutSession({ customerId, priceId, successUrl, cancelUrl, metadata, promotionCodeId }) {
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
  };
  // Stripe doesn't allow `discounts` and `allow_promotion_codes`
  // simultaneously — when we auto-apply a promo code, the manual
  // entry field is hidden. That's fine: an influencer-link visitor
  // already has the right discount applied; they'd never need to
  // type a different one. When no influencer code is present, keep
  // the manual entry field on for users with peer-shared codes.
  if (promotionCodeId) {
    body["discounts[0][promotion_code]"] = promotionCodeId;
  } else {
    body.allow_promotion_codes = "true";
  }
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

/* ── Coupons + Promotion Codes ──
   Used by the influencer-code feature. Each admin-created code is a
   pair: a Coupon (defines the discount math) + a Promotion Code (the
   customer-facing redemption token). The Promotion Code maps back to
   the Coupon, so when a user enters "MARIANA20" at Checkout, Stripe
   resolves to the right Coupon and applies the percent_off.

   We always create them as percent-off in v1; amount-off can be
   added by widening this signature when needed. Restrictions are
   set so codes only apply to first-time customers (an influencer
   shouldn't be able to give discounts to existing paying users). */

export function createCoupon({ percentOff, duration, durationInMonths, name, metadata }) {
  // `currency` is required ONLY for amount_off coupons — Stripe
  // rejects it on percent_off coupons with parameter_unknown on
  // stricter API versions. v1 is percent-off only, so we omit it
  // entirely. If we ever add amount_off support, branch the body
  // shape here based on which one is set.
  const body = {
    percent_off: String(percentOff),
    duration,
  };
  // Stripe Coupon `name` is capped at 40 chars. Truncate defensively
  // so a long influencer name doesn't take down the create flow.
  if (name) body.name = String(name).slice(0, 40);
  if (duration === "repeating") {
    body.duration_in_months = String(durationInMonths);
  }
  for (const [k, v] of Object.entries(metadata || {})) {
    if (v == null) continue;
    body[`metadata[${k}]`] = String(v);
  }
  return stripeFetch("/coupons", { body });
}

export function createPromotionCode({ couponId, code, firstTimeOnly = true, metadata }) {
  const body = {
    coupon: couponId,
    code,
  };
  if (firstTimeOnly) {
    body["restrictions[first_time_transaction]"] = "true";
  }
  for (const [k, v] of Object.entries(metadata || {})) {
    if (v == null) continue;
    body[`metadata[${k}]`] = String(v);
  }
  return stripeFetch("/promotion_codes", { body });
}

/* Toggle a Promotion Code's active flag. Stripe doesn't allow
   deleting promo codes (they live forever for audit), so the only
   way to "disable" one is to flip active=false. Manual entry of the
   code at Checkout will fail with a "promotion code not active"
   error after this; auto-apply via discounts[promotion_code] also
   fails. */
export function updatePromotionCode(id, { active }) {
  return stripeFetch(`/promotion_codes/${id}`, {
    body: { active: String(!!active) },
  });
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

/* ── Stripe Connect (Express) ──────────────────────────────────────
   Used by Stage 3 of the patient portal. The therapist becomes a
   Connect Express account on Cardigan's platform; patients pay via
   direct charges (Stripe-Account header) so the funds settle
   directly into the therapist's account. Cardigan never holds the
   money — no application_fee_amount in v1, so the therapist keeps
   every peso minus Stripe's processing fee.

   Expressly NOT here: `transfer_data.destination` (destination charges)
   and any application-fee logic. We can layer those on later if the
   business model changes; today it's the simplest possible path. */

// Create a fresh Express-controlled Connect account. Country is locked
// to MX (we're Mexico-only). Capabilities = card_payments + transfers
// is the minimum for accepting card payments + receiving payouts.
// Idempotency-keyed by user_id so a double-tap on "Empezar" can't
// mint two accounts for the same therapist.
export function createConnectAccount({ email, userId, fullName }) {
  const body = {
    type: "express",
    country: "MX",
    email,
    "capabilities[card_payments][requested]": "true",
    "capabilities[transfers][requested]": "true",
    "business_type": "individual",
    "settings[payouts][schedule][interval]": "manual",
    "metadata[user_id]": userId || "",
  };
  if (fullName) body["business_profile[name]"] = String(fullName).slice(0, 64);
  return stripeFetch("/accounts", {
    body,
    idempotencyKey: userId ? `cardigan-connect-${userId}` : undefined,
  });
}

// Account Link = the URL Stripe hosts that walks the therapist
// through onboarding (identity, bank, etc). Single-use, expires in 5
// minutes. We pass return + refresh URLs so Stripe sends the user
// back to Cardigan when they're done OR if the link expires.
export function createAccountLink({ accountId, returnUrl, refreshUrl, type = "account_onboarding" }) {
  return stripeFetch("/account_links", {
    body: {
      account: accountId,
      return_url: returnUrl,
      refresh_url: refreshUrl,
      type,
    },
  });
}

// One-time login link to the Express dashboard so the therapist can
// see their balance, payouts, transactions, etc. Stripe handles the
// full UI; we just hand them the front door.
export function createLoginLink(accountId) {
  return stripeFetch(`/accounts/${accountId}/login_links`);
}

// Read the current state of a Connect account. We use the `retrieve`
// shape (no body, GET) so the webhook + status endpoint can refresh
// charges_enabled / payouts_enabled / details_submitted on demand.
export function getConnectAccount(accountId) {
  return stripeFetch(`/accounts/${accountId}`, { method: "GET" });
}

/* Create a Checkout Session ON BEHALF OF a connected account (direct
   charges). The patient pays the therapist directly; Cardigan only
   facilitates. Returns { id, url } — the URL is what we redirect the
   patient to.

   `mode: "payment"` (one-shot, not a subscription).
   `payment_method_types: ['card']` — cards only in v1; OXXO can be
   added later by widening this list and toggling on the Connect
   account's payment-methods.
   `customer_email` pre-fills Stripe Checkout's email field so the
   patient doesn't retype it. */
export function createPatientCheckoutSession({
  accountId,
  amountCents,
  currency = "mxn",
  customerEmail,
  successUrl,
  cancelUrl,
  metadata,
  idempotencyKey,
}) {
  const body = {
    mode: "payment",
    "payment_method_types[0]": "card",
    "line_items[0][price_data][currency]": currency,
    "line_items[0][price_data][unit_amount]": String(amountCents),
    "line_items[0][price_data][product_data][name]": "Pago a profesionista",
    "line_items[0][quantity]": "1",
    success_url: successUrl,
    cancel_url: cancelUrl,
    locale: "es",
  };
  if (customerEmail) body.customer_email = customerEmail;
  for (const [k, v] of Object.entries(metadata || {})) {
    if (v == null) continue;
    body[`metadata[${k}]`] = String(v);
    body[`payment_intent_data[metadata][${k}]`] = String(v);
  }
  return stripeFetch("/checkout/sessions", {
    body,
    stripeAccount: accountId,
    idempotencyKey,
  });
}

export async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
