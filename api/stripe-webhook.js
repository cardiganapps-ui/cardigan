/* ── POST /api/stripe-webhook ─────────────────────────────────────────
   Stripe-driven source of truth for user_subscriptions. The client is
   never trusted to set status; only this handler writes to that table.

   Security:
     - HMAC-SHA256 verification against STRIPE_WEBHOOK_SECRET via the
       `Stripe-Signature` header. Mirrors the manual approach used in
       api/resend-webhook.js — we don't pull in the Stripe SDK just for
       constructEvent.
     - 5-minute timestamp tolerance prevents replay of a captured event.

   Idempotency:
     - Stripe re-delivers on any non-2xx, plus duplicates are normal at
       the "at-least-once" guarantee. We INSERT into stripe_webhook_events
       on receipt and skip processing if the event_id was already seen.
     - The handler is also internally idempotent: every UPSERT is keyed
       on stripe_customer_id, every status field is overwritten with the
       latest snapshot from the event.

   Events we care about:
     - checkout.session.completed         — first signal that a sub was
                                             created. We fetch the full
                                             subscription object to
                                             populate every field.
     - customer.subscription.created      — Stripe's authoritative state
     - customer.subscription.updated        for created/updated/deleted.
     - customer.subscription.deleted        Same code path; the latest
                                             snapshot wins.
     - invoice.paid                       — refresh hosted_invoice_url.
     - invoice.payment_failed             — same; status is set to
                                             past_due via the matching
                                             subscription.updated event.
     - customer.subscription.trial_will_end — informational; we record
                                             but don't take action yet.

   When extending: every new event type either updates user_subscriptions
   or short-circuits with a logged "unhandled" line. Don't 500 on
   unknown types — Stripe will retry indefinitely if we do, and the
   dashboard will fill with red. Just 200 + log. */

import * as Sentry from "@sentry/node";
import { getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";
import {
  verifyStripeSignature,
  readRawBody,
  getWebhookSecret,
  getSubscription,
  creditCustomerBalance,
} from "./_stripe.js";

// One free month of Cardigan Pro, in MXN cents. Mirrors the Stripe
// price (`STRIPE_PRICE_ID`). If we ever change the plan price we'll
// want this to come from the price object directly — for now it's
// simpler to keep a single source of truth in env.
const REFERRAL_REWARD_CENTS = 29900;

// Vercel JSON-parses the body by default; Stripe needs the raw bytes
// for HMAC verification. Same pattern as api/resend-webhook.js +
// api/whatsapp-webhook.js.
export const config = { api: { bodyParser: false } };

function isoOrNull(unix) {
  if (!unix || typeof unix !== "number") return null;
  return new Date(unix * 1000).toISOString();
}

/* Roll a subscription object (from a customer.subscription.* event or
   a fresh GET /v1/subscriptions/:id call) into the user_subscriptions
   row. Keyed on stripe_customer_id — we look up the user_id from the
   existing row written at checkout-time.

   Returns { ok: true } on success or { ok: false, error } when the
   matching row can't be found. The caller decides whether to 200 or
   500 — most cases want 200 + log so Stripe doesn't retry forever. */
async function applySubscriptionSnapshot(svc, sub) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) return { ok: false, error: "no customer id on subscription" };

  // Find the matching row. If it doesn't exist (rare — could happen if
  // someone created a sub directly in the Stripe dashboard for an
  // email that matches a Cardigan user, with no /api/stripe-checkout
  // ever called), skip rather than error.
  const { data: row } = await svc
    .from("user_subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (!row) {
    // Orphan: a Stripe customer with no Cardigan-side row. Could be
    // someone whose account was deleted (FK cascade), or a sub created
    // directly in the Stripe dashboard. Surface to Sentry so we notice
    // — silent return + 200 was hiding real reconciliation problems.
    try {
      Sentry.captureMessage("stripe-webhook: orphan customer", {
        level: "warning",
        extra: { customerId, subscriptionId: sub.id },
      });
    } catch { /* Sentry is best-effort */ }
    return { ok: false, error: `no user_subscriptions row for customer ${customerId}` };
  }

  const priceId = sub.items?.data?.[0]?.price?.id || null;
  // Stripe expands `default_payment_method` to a string id on most
  // events, but to a full object on a few of them — handle both.
  // NULL means the subscription has no card attached yet (an orphan
  // from an abandoned payment sheet); the isPro gate uses this to
  // distinguish real trialing customers from incomplete ones.
  const dpm = sub.default_payment_method;
  const defaultPaymentMethod = typeof dpm === "string"
    ? dpm
    : (dpm?.id || null);
  const update = {
    stripe_subscription_id: sub.id,
    stripe_price_id: priceId,
    status: sub.status,
    current_period_end: isoOrNull(sub.current_period_end),
    cancel_at_period_end: !!sub.cancel_at_period_end,
    trial_end: isoOrNull(sub.trial_end),
    default_payment_method: defaultPaymentMethod,
    updated_at: new Date().toISOString(),
  };

  const { error } = await svc
    .from("user_subscriptions")
    .update(update)
    .eq("user_id", row.user_id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* Issue a referral reward (one free month) to the inviter when an
   invitee's FIRST paid invoice clears. Idempotent via the invitee's
   `referral_reward_credited_at` column — only the inaugural paid
   invoice triggers the credit; renewals do not.

   Inviter resolution: we look up the invitee row by their Stripe
   customer id, read `referred_by`, and find the inviter row by
   matching `referral_code`. If the inviter has a real Stripe
   customer (id starting with `cus_`), we post a customer-balance
   credit immediately. Otherwise we accumulate `pending_credit_amount_cents`
   on the inviter's row, to be drained on their eventual /api/stripe-
   checkout.

   Either way we increment `referral_rewards_count` on the inviter
   (it's the user-facing tally) and stamp `referral_reward_credited_at`
   on the invitee (the dedupe guard). */
async function maybeCreditReferralReward(svc, invoice, customerId) {
  // Look up the invitee row.
  const { data: invitee } = await svc
    .from("user_subscriptions")
    .select("user_id, referred_by, referral_reward_credited_at")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (!invitee) return { ok: true, note: "no invitee row" };
  if (invitee.referral_reward_credited_at) {
    return { ok: true, note: "already credited" };
  }
  if (!invitee.referred_by) return { ok: true, note: "no referrer" };

  // Find the inviter by their referral_code.
  const { data: inviter } = await svc
    .from("user_subscriptions")
    .select("user_id, stripe_customer_id, referral_rewards_count, pending_credit_amount_cents")
    .eq("referral_code", invitee.referred_by)
    .maybeSingle();
  if (!inviter) return { ok: true, note: `inviter code ${invitee.referred_by} not found` };
  if (inviter.user_id === invitee.user_id) {
    // Self-referral — possible if the invitee somehow forged it past
    // the checkout-side check. Skip silently.
    return { ok: true, note: "self-referral; skipped" };
  }

  const inviterHasRealCustomer = typeof inviter.stripe_customer_id === "string"
    && inviter.stripe_customer_id.startsWith("cus_");

  // Stamp dedupe guard FIRST so a Stripe-side failure during the
  // credit call doesn't repeat-fire on the next webhook retry. The
  // tally and credit posting follow; if those fail we'll see it in
  // the logs and can reconcile manually.
  const nowIso = new Date().toISOString();
  const { error: stampError } = await svc
    .from("user_subscriptions")
    .update({ referral_reward_credited_at: nowIso, updated_at: nowIso })
    .eq("user_id", invitee.user_id)
    .is("referral_reward_credited_at", null);
  if (stampError) throw new Error(`stamp invitee: ${stampError.message}`);

  if (inviterHasRealCustomer) {
    await creditCustomerBalance({
      customerId: inviter.stripe_customer_id,
      amountCents: REFERRAL_REWARD_CENTS,
      currency: "mxn",
      description: "Recompensa por invitación a Cardigan Pro",
      metadata: {
        kind: "referral_reward",
        invitee_user_id: invitee.user_id,
        invoice_id: invoice.id || "",
      },
      // Tie the credit to the invitee's user_id (ONE reward per
      // referrer-invitee pair, regardless of how many times Stripe
      // re-delivers invoice.paid). We already gate above on
      // referral_reward_credited_at — this is a defense-in-depth.
      idempotencyKey: `cardigan-credit-ref-${invitee.user_id}`,
    });
    await svc.from("user_subscriptions")
      .update({
        referral_rewards_count: (inviter.referral_rewards_count || 0) + 1,
        updated_at: nowIso,
      })
      .eq("user_id", inviter.user_id);
  } else {
    // Trial-stage inviter, no Stripe customer yet — accrue pending.
    await svc.from("user_subscriptions")
      .update({
        referral_rewards_count: (inviter.referral_rewards_count || 0) + 1,
        pending_credit_amount_cents: (inviter.pending_credit_amount_cents || 0) + REFERRAL_REWARD_CENTS,
        updated_at: nowIso,
      })
      .eq("user_id", inviter.user_id);
  }
  return { ok: true };
}

async function handleEvent(svc, event) {
  switch (event.type) {
    case "checkout.session.completed": {
      // The session object includes a `subscription` id but not the
      // full subscription. Fetch it so we can write a complete row in
      // one shot — otherwise we'd have a brief window where the user's
      // sub is "completed checkout" but we don't know the period_end.
      const session = event.data.object;
      const subId = session.subscription;
      if (!subId) {
        return { ok: true, note: "checkout.session.completed without subscription (one-time?)" };
      }
      let sub;
      try {
        sub = await getSubscription(typeof subId === "string" ? subId : subId.id);
      } catch (err) {
        return { ok: false, error: `getSubscription failed: ${err.message}` };
      }
      return applySubscriptionSnapshot(svc, sub);
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.trial_will_end": {
      return applySubscriptionSnapshot(svc, event.data.object);
    }

    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const customerId = typeof invoice.customer === "string"
        ? invoice.customer : invoice.customer?.id;
      if (!customerId) return { ok: true, note: "invoice without customer" };
      const update = {
        latest_invoice_id: invoice.id || null,
        hosted_invoice_url: invoice.hosted_invoice_url || null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await svc
        .from("user_subscriptions")
        .update(update)
        .eq("stripe_customer_id", customerId);
      if (error) return { ok: false, error: error.message };

      if (event.type === "invoice.paid") {
        // Append to the per-user invoice ledger so Settings can render
        // a billing history without bouncing through Stripe's portal.
        // Best-effort: a duplicate id (re-delivered event) is silently
        // ignored via primary-key conflict.
        try {
          const { data: ownerRow } = await svc
            .from("user_subscriptions")
            .select("user_id")
            .eq("stripe_customer_id", customerId)
            .maybeSingle();
          if (ownerRow?.user_id && invoice.id) {
            const paidUnix = invoice.status_transitions?.paid_at
              || invoice.created
              || Math.floor(Date.now() / 1000);
            await svc.from("stripe_invoices").upsert({
              id: invoice.id,
              user_id: ownerRow.user_id,
              stripe_customer_id: customerId,
              stripe_subscription_id: typeof invoice.subscription === "string"
                ? invoice.subscription : (invoice.subscription?.id || null),
              amount_cents: invoice.amount_paid ?? invoice.amount_due ?? 0,
              currency: (invoice.currency || "mxn").toLowerCase(),
              paid_at: new Date(paidUnix * 1000).toISOString(),
              hosted_invoice_url: invoice.hosted_invoice_url || null,
              pdf_url: invoice.invoice_pdf || null,
            }, { onConflict: "id" });
          }
        } catch (err) {
          console.warn("stripe-webhook: invoice ledger write failed:", err.message);
        }

        // Referral reward — only fires on the FIRST paid invoice for
        // an invitee subscription (idempotency via
        // referral_reward_credited_at). On payment_failed we do nothing.
        try {
          await maybeCreditReferralReward(svc, invoice, customerId);
        } catch (err) {
          // A reward-flow hiccup must not fail the webhook ack — the
          // primary state was already persisted above. Log and move on.
          console.warn("stripe-webhook: referral credit failed:", err.message);
        }
      }

      return { ok: true };
    }

    default:
      return { ok: true, note: `unhandled type: ${event.type}` };
  }
}

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let secret;
  try { secret = getWebhookSecret(); }
  catch (err) {
    console.error("stripe-webhook:", err.message);
    return res.status(500).json({ error: "Webhook secret not configured" });
  }

  const sigHeader = req.headers["stripe-signature"];
  if (!sigHeader) {
    return res.status(400).json({ error: "Missing Stripe-Signature header" });
  }

  const rawBody = await readRawBody(req);
  const ok = verifyStripeSignature({
    rawBody,
    header: Array.isArray(sigHeader) ? sigHeader[0] : sigHeader,
    secret,
  });
  if (!ok) {
    console.warn("stripe-webhook: signature verification failed");
    return res.status(401).json({ error: "Invalid signature" });
  }

  let event;
  try { event = JSON.parse(rawBody); }
  catch { return res.status(400).json({ error: "Invalid JSON" }); }

  // Idempotency: insert (event_id, type, payload) — duplicate primary
  // key means we've seen this event before, so 200 without re-processing.
  const svc = getServiceClient();
  const { error: dedupeError } = await svc
    .from("stripe_webhook_events")
    .insert({
      event_id: event.id,
      type: event.type,
      payload: event,
    });
  if (dedupeError) {
    // 23505 = unique violation = duplicate event. Anything else is a
    // real DB problem — log and 500 so Stripe retries.
    if (dedupeError.code === "23505") {
      return res.status(200).json({ received: true, duplicate: true });
    }
    console.error("stripe-webhook dedupe insert failed:", dedupeError.message);
    return res.status(500).json({ error: "Dedupe insert failed" });
  }

  try {
    const result = await handleEvent(svc, event);
    if (!result.ok) {
      // Log but still 200: a "no matching row" / Stripe-fetch hiccup
      // shouldn't make Stripe retry forever. The event payload is in
      // stripe_webhook_events for forensic replay.
      console.warn("stripe-webhook handle:", event.type, result.error);
    } else if (result.note) {
      console.log("stripe-webhook:", event.type, result.note);
    }
  } catch (err) {
    console.error("stripe-webhook handler crash:", err);
    // Surface 500 so Stripe retries — a thrown error is not the same
    // as a "skipped because no matching row" branch above.
    return res.status(500).json({ error: "Handler crashed" });
  }

  return res.status(200).json({ received: true });
}

export default withSentry(handler, { name: "stripe-webhook" });
