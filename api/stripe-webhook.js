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
  getConnectWebhookSecret,
  getSubscription,
  creditCustomerBalance,
} from "./_stripe.js";
import { sendLifecycleEmail } from "./_lifecycle.js";

// One free month of Cardigan Pro, in MXN cents. Mirrors the Stripe
// price (`STRIPE_PRICE_ID`). If we ever change the plan price we'll
// want this to come from the price object directly — for now it's
// simpler to keep a single source of truth in env.
const REFERRAL_REWARD_CENTS = 14900;

// Anti-abuse caps on referral rewards. Hit either ceiling and we
// stop crediting the inviter (silently — the invitee still gets the
// product, the inviter just stops accruing freebies).
//   - Lifetime cap: ceiling on total free months one user can earn
//     via referrals. 12 = a whole free year, which is generous.
//   - Burst cap: > N credits within BURST_WINDOW_MS triggers a
//     Sentry alert (we don't block — false positives would be worse
//     than a slow leak — but we get visibility immediately).
const REFERRAL_LIFETIME_CAP = 12;
const REFERRAL_BURST_CAP = 3;
const REFERRAL_BURST_WINDOW_MS = 24 * 60 * 60 * 1000;

// Vercel JSON-parses the body by default; Stripe needs the raw bytes
// for HMAC verification. Same pattern as api/resend-webhook.js +
// api/whatsapp-webhook.js.
export const config = { api: { bodyParser: false } };

function isoOrNull(unix) {
  if (!unix || typeof unix !== "number") return null;
  return new Date(unix * 1000).toISOString();
}

/* Decide whether an incoming Stripe webhook event is older than the
   most recent state already applied to a user_subscriptions row.
   Stripe webhook delivery is at-least-once and not strictly ordered;
   without this guard, a stale older event delivered after a newer one
   silently clobbers correct state. Pure helper — tested in isolation
   so the ordering rule can't drift.

   Returns true when the event should be skipped:
     - eventCreatedIso is older than rowLastEventIso
   Returns false otherwise:
     - first-ever event (rowLastEventIso null)
     - missing eventCreatedIso (replay / test fixture)
     - eventCreatedIso >= rowLastEventIso (apply) */
export function shouldSkipStaleEvent(eventCreatedIso, rowLastEventIso) {
  if (!eventCreatedIso || !rowLastEventIso) return false;
  return eventCreatedIso < rowLastEventIso;
}

/* Whether an `invoice.paid` payload represents a real-money payment
   that should trigger a referral reward to the inviter. Stripe fires
   `invoice.paid` for the auto-generated $0 trial-start invoice too
   (because trial_end is in the future and the period is covered);
   crediting the inviter on that event would mean the reward issues
   the moment the invitee's trial begins, before they've paid anything.
   Gate on `amount_paid > 0` so only the first true paid invoice
   triggers the credit. Pure helper — tested. */
export function invoiceIsRewardEligible(invoice) {
  if (!invoice || typeof invoice !== "object") return false;
  const amountPaid = typeof invoice.amount_paid === "number" ? invoice.amount_paid : 0;
  return amountPaid > 0;
}

/* Roll a subscription object (from a customer.subscription.* event or
   a fresh GET /v1/subscriptions/:id call) into the user_subscriptions
   row. Keyed on stripe_customer_id — we look up the user_id from the
   existing row written at checkout-time.

   Returns { ok: true } on success or { ok: false, error } when the
   matching row can't be found. The caller decides whether to 200 or
   500 — most cases want 200 + log so Stripe doesn't retry forever. */
// Predicate: does this (status, default_payment_method) pair mean the
// user has real Pro access? Mirrors useSubscription.subscribedActive
// so server- and client-side gating agree. Used to detect the
// "just became Pro" transition that fires the pro_welcome email.
function isProState(status, dpm) {
  if (status === "active" || status === "past_due") return true;
  if (status === "trialing" && !!dpm) return true;
  return false;
}

async function applySubscriptionSnapshot(svc, sub, eventCreatedUnix) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) return { ok: false, error: "no customer id on subscription" };

  // Find the matching row. If it doesn't exist (rare — could happen if
  // someone created a sub directly in the Stripe dashboard for an
  // email that matches a Cardigan user, with no /api/stripe-checkout
  // ever called), skip rather than error. We pull the prior subscription
  // fields (status, dpm, cancel_at, cancel_at_period_end) so the
  // transition detection below can decide which lifecycle emails to fire.
  const { data: row } = await svc
    .from("user_subscriptions")
    .select("user_id, stripe_subscription_id, last_stripe_event_at, status, default_payment_method, cancel_at, cancel_at_period_end")
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

  // Event-ordering guard (read-side fast path). See shouldSkipStaleEvent
  // for the rule. The actual update below also gates on
  // last_stripe_event_at atomically — see below — so a concurrent
  // newer event from a different Vercel instance can't be clobbered
  // even if both pass this read-side check.
  const eventCreatedIso = isoOrNull(eventCreatedUnix);
  if (shouldSkipStaleEvent(eventCreatedIso, row.last_stripe_event_at)) {
    return { ok: true, note: `stale event (${eventCreatedIso} < row.last ${row.last_stripe_event_at})` };
  }

  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id || null;
  // Stripe API 2025-04-30.basil removed `current_period_end` from the
  // Subscription root and surfaces it on the SubscriptionItem instead.
  // Fall back to items[0] so the period boundary lands in the DB
  // regardless of which API version the webhook endpoint is pinned to.
  const periodEndUnix = sub.current_period_end ?? item?.current_period_end ?? null;
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
    current_period_end: isoOrNull(periodEndUnix),
    cancel_at_period_end: !!sub.cancel_at_period_end,
    // Stripe Portal cancellation can set EITHER cancel_at_period_end
    // (boolean) OR cancel_at (timestamp), depending on the portal's
    // cancellation-mode config. We persist both and let the UI OR
    // them when deciding "is this sub winding down?".
    cancel_at: isoOrNull(sub.cancel_at),
    trial_end: isoOrNull(sub.trial_end),
    default_payment_method: defaultPaymentMethod,
    updated_at: new Date().toISOString(),
    ...(eventCreatedIso ? { last_stripe_event_at: eventCreatedIso } : {}),
  };

  // Atomic conditional update — gate on last_stripe_event_at to
  // prevent a concurrent newer event (delivered to a different Vercel
  // instance) from being clobbered by this writer. PostgREST's `or`
  // syntax: write only when the row's last applied timestamp is null
  // OR strictly older than this event. If the row was already
  // advanced by a peer, we no-op silently.
  let upd = svc.from("user_subscriptions").update(update).eq("user_id", row.user_id);
  if (eventCreatedIso) {
    upd = upd.or(`last_stripe_event_at.is.null,last_stripe_event_at.lt.${eventCreatedIso}`);
  }
  const { error } = await upd;
  if (error) return { ok: false, error: error.message };

  // Lifecycle-email transitions — best-effort, never fail the webhook.
  // The dedupe via lifecycle_emails(user_id, kind) means we can call
  // sendLifecycleEmail unconditionally for "is now Pro" and "is now
  // cancelling"; only the first call per user-per-kind actually sends.
  // We DO need transition detection to clear the pro_cancelled dedupe
  // row on reactivation so a future cancellation re-fires.
  try {
    const wasPro = isProState(row.status, row.default_payment_method);
    const isPro = isProState(sub.status, defaultPaymentMethod);
    const wasCancelling = !!row.cancel_at || !!row.cancel_at_period_end;
    const isCancelling = !!sub.cancel_at || !!sub.cancel_at_period_end;

    const wantWelcome = isPro && !wasPro;
    const wantCancellationEmail = isCancelling && !wasCancelling;
    const wantClearCancellationDedupe = !isCancelling && wasCancelling;
    if (wantWelcome || wantCancellationEmail || wantClearCancellationDedupe) {
      // Only do the auth lookup when there's an actual transition to
      // act on — otherwise every renewal webhook for an existing Pro
      // user would hit the auth admin API for nothing.
      const { data: u } = await svc.auth.admin.getUserById(row.user_id);
      const email = u?.user?.email;
      if (email) {
        const fullName = u.user.user_metadata?.full_name || email.split("@")[0];
        const firstName = String(fullName).split(" ")[0];

        // pro_welcome — fires the first time the user becomes Pro.
        // Subsequent renewals are deduped by lifecycle_emails. Re-firing
        // a year later after they cancelled and resubscribed is also
        // deduped (see CLAUDE.md billing notes).
        if (isPro && !wasPro) {
          await sendLifecycleEmail(svc, {
            userId: row.user_id, email, firstName,
            kind: "pro_welcome",
          });
        }

        // pro_cancelled — fires when scheduled cancellation appears.
        if (isCancelling && !wasCancelling) {
          // Format the end-date in es-MX so the email shows e.g.
          // "30 de mayo de 2026". Falls back to a generic phrase
          // when no date is available.
          const endIso = update.cancel_at || update.current_period_end;
          let endDateStr = null;
          if (endIso) {
            try {
              endDateStr = new Date(endIso).toLocaleDateString("es-MX", {
                day: "numeric", month: "long", year: "numeric",
              });
            } catch { /* ignore — fallback handles it */ }
          }
          await sendLifecycleEmail(svc, {
            userId: row.user_id, email, firstName,
            kind: "pro_cancelled",
            endDateStr,
          });
        }

        // Reactivation — clear the pro_cancelled dedupe row so a
        // future cancellation can re-fire the email.
        if (!isCancelling && wasCancelling) {
          await svc.from("lifecycle_emails")
            .delete()
            .eq("user_id", row.user_id)
            .eq("kind", "pro_cancelled");
        }
      }
    }
  } catch (err) {
    console.warn("stripe-webhook: lifecycle email fire failed:", err?.message);
  }

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
  // Skip $0 trial-start invoices — see invoiceIsRewardEligible.
  if (!invoiceIsRewardEligible(invoice)) {
    return { ok: true, note: "zero-amount invoice; skipping reward" };
  }

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

  // Lifetime cap — past this we stop crediting. Done as a count read
  // off the ledger rather than the denormalized counter so it's
  // resistant to drift. The check is read-then-act (no row lock), but
  // the (inviter, invitee) unique on referral_credits below provides
  // the atomic guarantee: even if two webhooks race past this check,
  // only one ledger insert succeeds.
  const { count: priorCount } = await svc
    .from("referral_credits")
    .select("id", { count: "exact", head: true })
    .eq("inviter_user_id", inviter.user_id);
  if ((priorCount || 0) >= REFERRAL_LIFETIME_CAP) {
    try {
      Sentry.captureMessage("stripe-webhook: referral lifetime cap hit", {
        level: "info",
        extra: { inviterUserId: inviter.user_id, invitee: invitee.user_id, count: priorCount },
      });
    } catch { /* Sentry best-effort */ }
    // Still stamp the invitee so we don't re-evaluate on every renewal.
    const nowIso0 = new Date().toISOString();
    await svc.from("user_subscriptions")
      .update({ referral_reward_credited_at: nowIso0, updated_at: nowIso0 })
      .eq("user_id", invitee.user_id)
      .is("referral_reward_credited_at", null);
    return { ok: true, note: `inviter ${inviter.user_id} hit lifetime cap` };
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

  // Append to the per-conversion ledger (powers the Quién has invitado
  // leaderboard). Unique on (inviter, invitee) so a re-fire is a no-op
  // even if every higher-level guard slips.
  const { error: ledgerError } = await svc
    .from("referral_credits")
    .insert({
      inviter_user_id: inviter.user_id,
      invitee_user_id: invitee.user_id,
      amount_cents: REFERRAL_REWARD_CENTS,
      invoice_id: invoice.id || null,
    });
  if (ledgerError && ledgerError.code !== "23505") {
    // Genuine error — don't bail the whole reward, but log it.
    console.warn("stripe-webhook: referral_credits insert failed:", ledgerError.message);
  }

  // Burst-detection: if this inviter has earned > BURST_CAP credits
  // in the last BURST_WINDOW_MS, alert Sentry. We don't block (a
  // popular therapist legitimately referring 4+ colleagues in a day
  // is plausible), but we want eyes on the pattern.
  const since = new Date(Date.now() - REFERRAL_BURST_WINDOW_MS).toISOString();
  const { count: recentCount } = await svc
    .from("referral_credits")
    .select("id", { count: "exact", head: true })
    .eq("inviter_user_id", inviter.user_id)
    .gte("credited_at", since);
  if ((recentCount || 0) > REFERRAL_BURST_CAP) {
    try {
      Sentry.captureMessage("stripe-webhook: referral burst", {
        level: "warning",
        extra: {
          inviterUserId: inviter.user_id,
          recentCount,
          windowHours: REFERRAL_BURST_WINDOW_MS / 3_600_000,
        },
      });
    } catch { /* Sentry best-effort */ }
  }

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

// Mexican short-month names for short-date strings on the payments
// row. `payments.date` is a "D-MMM" string (Spanish). We keep this
// inline rather than reaching into src/utils/dates.js because the
// api/ surface must not import from src/.
const SHORT_MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
function todayShortDateES() {
  const d = new Date();
  return `${d.getDate()}-${SHORT_MONTHS_ES[d.getMonth()]}`;
}

/* Reconcile a successful Stripe PaymentIntent against the canonical
   `payments` ledger. Idempotent on three levels:
     1. Webhook event-id dedupe via stripe_webhook_events (handler-
        level, applies to every event).
     2. patient_payment_intents.status / payment_id read — if we
        already advanced this row to 'succeeded', skip.
     3. Optimistic match on stripe_payment_intent_id — the unique
        constraint on patient_payment_intents.stripe_payment_intent_id
        means the lookup is keyed.

   Writes:
     - payments row (method=Tarjeta — patient paid with card).
     - patient.paid bumped by amount.
     - patient_payment_intents row stamped to 'succeeded' + payment_id. */
async function reconcilePatientPaymentSuccess(svc, pi) {
  const piId = pi.id;
  if (!piId) return { ok: false, error: "no PI id" };

  const { data: row, error: lookupErr } = await svc
    .from("patient_payment_intents")
    .select("id, patient_id, therapist_user_id, paid_by_user_id, amount_cents, status, payment_id")
    .eq("stripe_payment_intent_id", piId)
    .maybeSingle();
  if (lookupErr) return { ok: false, error: lookupErr.message };
  if (!row) {
    // No matching row — could be a stray PI on a connected account
    // that didn't go through Cardigan's Checkout flow (the therapist
    // could in theory create payments directly in their Stripe
    // dashboard). 200 + log so Stripe doesn't retry forever.
    return { ok: true, note: `no patient_payment_intents row for ${piId}` };
  }
  if (row.status === "succeeded" && row.payment_id) {
    return { ok: true, note: "already reconciled" };
  }

  // Resolve the patient row so we can stamp the payments ledger
  // with the right `patient` + `initials`. Failure to find means
  // the patient row was deleted between checkout and webhook —
  // rare but the webhook should still mark the PI status so the
  // therapist's UI doesn't show a phantom pending payment.
  const { data: patient } = await svc
    .from("patients")
    .select("id, name, initials, color_idx, paid")
    .eq("id", row.patient_id)
    .maybeSingle();

  // Convert Stripe cents → whole MXN pesos. payments.amount is an
  // integer in pesos, NOT cents (see schema.sql). We round-half-up
  // to match the patient's expectation; sub-peso amounts shouldn't
  // happen in v1 (we cap at 20 MXN minimum).
  const amountPesos = Math.round(row.amount_cents / 100);

  let paymentId = row.payment_id || null;

  if (patient && !paymentId) {
    // Insert the canonical payments row. method=Tarjeta — Stripe
    // Checkout v1 only supports cards. The note threads the Stripe
    // PI id so a therapist debugging a discrepancy can reconcile
    // against Stripe directly.
    const { data: pmt, error: insertErr } = await svc
      .from("payments")
      .insert({
        user_id: row.therapist_user_id,
        patient_id: patient.id,
        patient: patient.name,
        initials: patient.initials,
        amount: amountPesos,
        date: todayShortDateES(),
        method: "Tarjeta",
        note: `Pago en línea (Stripe ${piId})`,
        color_idx: patient.color_idx || 0,
      })
      .select("id")
      .maybeSingle();
    if (insertErr) return { ok: false, error: `payment insert: ${insertErr.message}` };
    paymentId = pmt?.id || null;

    // Bump the denormalized patient.paid counter. Source-of-truth
    // is the predicate in utils/patients.js::recalcPatientCounters,
    // but we apply the delta inline here to keep the therapist's UI
    // consistent on the next refetch. A scheduled audit run reconciles
    // any drift.
    if (paymentId) {
      const { error: bumpErr } = await svc
        .from("patients")
        .update({ paid: (patient.paid || 0) + amountPesos })
        .eq("id", patient.id);
      if (bumpErr) {
        // Don't fail the webhook for this — the audit script catches
        // drift, and the next manual recalc fixes it. But surface to
        // Sentry so we know if it's a recurring problem.
        console.warn("stripe-webhook: patient.paid bump failed:", bumpErr.message);
      }
    }
  }

  // Advance the PI row.
  const { error: stampErr } = await svc
    .from("patient_payment_intents")
    .update({
      status: "succeeded",
      succeeded_at: new Date().toISOString(),
      payment_id: paymentId,
    })
    .eq("id", row.id);
  if (stampErr) return { ok: false, error: `pi stamp: ${stampErr.message}` };

  return { ok: true };
}

async function reconcilePatientPaymentFailed(svc, pi, terminalStatus) {
  const piId = pi.id;
  if (!piId) return { ok: false, error: "no PI id" };
  const { error } = await svc
    .from("patient_payment_intents")
    .update({ status: terminalStatus })
    .eq("stripe_payment_intent_id", piId)
    // Don't clobber an already-succeeded row if events arrive out
    // of order (Stripe's at-least-once delivery is not strictly
    // ordered, and a late `payment_failed` after a `succeeded`
    // would otherwise mark a real payment as failed).
    .neq("status", "succeeded");
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function applyConnectAccountUpdate(svc, account, eventCreatedUnix) {
  const accountId = account.id;
  if (!accountId) return { ok: false, error: "no account id" };
  const eventCreatedIso = isoOrNull(eventCreatedUnix);
  // Pre-check for ownership so we can log unknown accounts. A
  // Stripe webhook misconfiguration (or test/live key bleed) could
  // deliver events for accounts that don't belong to our platform;
  // silently no-oping made these invisible.
  const { data: row } = await svc
    .from("therapist_connect_accounts")
    .select("user_id, last_event_at")
    .eq("stripe_account_id", accountId)
    .maybeSingle();
  if (!row) {
    try {
      Sentry.captureMessage("stripe-webhook: account.updated for unknown account", {
        level: "warning",
        extra: { accountId },
      });
    } catch { /* Sentry best-effort */ }
    return { ok: true, note: `unknown account ${accountId}` };
  }
  // Stale-event guard. Mirrors shouldSkipStaleEvent for subscriptions.
  if (row.last_event_at && eventCreatedIso && eventCreatedIso < row.last_event_at) {
    return { ok: true, note: `stale account.updated (${eventCreatedIso} < ${row.last_event_at})` };
  }
  const update = {
    charges_enabled: !!account.charges_enabled,
    payouts_enabled: !!account.payouts_enabled,
    details_submitted: !!account.details_submitted,
    updated_at: new Date().toISOString(),
    ...(eventCreatedIso ? { last_event_at: eventCreatedIso } : {}),
  };
  // Conditional UPDATE: only write when the row's last_event_at is
  // null OR strictly older than this event. Prevents a concurrent
  // newer webhook (delivered to a different Vercel instance) from
  // being clobbered.
  let upd = svc.from("therapist_connect_accounts")
    .update(update)
    .eq("stripe_account_id", accountId);
  if (eventCreatedIso) {
    upd = upd.or(`last_event_at.is.null,last_event_at.lt.${eventCreatedIso}`);
  }
  const { error } = await upd;
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function handleEvent(svc, event) {
  // Unix-second timestamp from Stripe's signed payload — used by the
  // ordering guard inside applySubscriptionSnapshot. Always present
  // on real events; tests / replays may omit it.
  const eventCreatedUnix = typeof event.created === "number" ? event.created : null;
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
      // Back-stamp influencer_code_id when a Cardigan-issued
      // promotion code was applied. Closes the attribution gap for
      // the manual-entry path (user typed MARIANA20 at Stripe
      // Checkout instead of using the /c/MARIANA20 link). Auto-
      // apply path already stamps server-side at /api/stripe-checkout
      // creation time; this catches the manual entry. Only stamps
      // when influencer_code_id is currently null (first-touch wins).
      try {
        const userId = session?.metadata?.user_id;
        const promoIds = (session?.discounts || [])
          .map((d) => typeof d?.promotion_code === "string" ? d.promotion_code : d?.promotion_code?.id)
          .filter(Boolean);
        if (userId && promoIds.length > 0) {
          const { data: code } = await svc
            .from("influencer_codes")
            .select("id")
            .in("stripe_promotion_code_id", promoIds)
            .maybeSingle();
          if (code?.id) {
            await svc.from("user_subscriptions")
              .update({ influencer_code_id: code.id, updated_at: new Date().toISOString() })
              .eq("user_id", userId)
              .is("influencer_code_id", null);
          }
        }
      } catch (err) {
        // Best-effort attribution — never fail the webhook for this.
        console.warn("influencer back-stamp failed:", err?.message);
      }
      let sub;
      try {
        sub = await getSubscription(typeof subId === "string" ? subId : subId.id);
      } catch (err) {
        return { ok: false, error: `getSubscription failed: ${err.message}` };
      }
      return applySubscriptionSnapshot(svc, sub, eventCreatedUnix);
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.trial_will_end": {
      return applySubscriptionSnapshot(svc, event.data.object, eventCreatedUnix);
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
        // Single owner-row lookup feeds both the invoice-ledger write
        // and the payment_failed dedupe-row clear below. Two
        // back-to-back .maybeSingle()'s on the same key would have
        // run sequentially — wasted round-trip on the hot path.
        let ownerUserId = null;
        try {
          const { data: ownerRow } = await svc
            .from("user_subscriptions")
            .select("user_id")
            .eq("stripe_customer_id", customerId)
            .maybeSingle();
          ownerUserId = ownerRow?.user_id || null;
        } catch (err) {
          console.warn("stripe-webhook: ownerRow lookup failed:", err.message);
        }

        // Append to the per-user invoice ledger so Settings can render
        // a billing history without bouncing through Stripe's portal.
        // Best-effort: a duplicate id (re-delivered event) is silently
        // ignored via primary-key conflict.
        if (ownerUserId && invoice.id) {
          try {
            const paidUnix = invoice.status_transitions?.paid_at
              || invoice.created
              || Math.floor(Date.now() / 1000);
            await svc.from("stripe_invoices").upsert({
              id: invoice.id,
              user_id: ownerUserId,
              stripe_customer_id: customerId,
              stripe_subscription_id: typeof invoice.subscription === "string"
                ? invoice.subscription : (invoice.subscription?.id || null),
              amount_cents: invoice.amount_paid ?? invoice.amount_due ?? 0,
              currency: (invoice.currency || "mxn").toLowerCase(),
              paid_at: new Date(paidUnix * 1000).toISOString(),
              hosted_invoice_url: invoice.hosted_invoice_url || null,
              pdf_url: invoice.invoice_pdf || null,
            }, { onConflict: "id" });
          } catch (err) {
            console.warn("stripe-webhook: invoice ledger write failed:", err.message);
          }
        }

        // Clear any prior payment_failed dedupe row for this user —
        // this paid invoice means the failure cycle is resolved, and
        // a future failed renewal should re-trigger the recovery
        // email. Best-effort.
        if (ownerUserId) {
          try {
            await svc.from("lifecycle_emails")
              .delete()
              .eq("user_id", ownerUserId)
              .eq("kind", "payment_failed");
          } catch (err) {
            console.warn("stripe-webhook: payment_failed dedupe clear skipped:", err.message);
          }
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
      } else if (event.type === "invoice.payment_failed") {
        // Failed-renewal recovery email. Idempotent via
        // lifecycle_emails(user_id, "payment_failed") — the user gets
        // exactly one heads-up per failure cycle, and Stripe's
        // automatic retry schedule covers the rest. If renewal
        // succeeds later, the next payment_failed is a fresh cycle
        // that we'd want to alert on again — so we clean up the
        // dedupe row on invoice.paid above. (Light touch: opt-out
        // is "contesta este correo" via the email body.)
        try {
          const { data: ownerRow } = await svc
            .from("user_subscriptions")
            .select("user_id")
            .eq("stripe_customer_id", customerId)
            .maybeSingle();
          if (ownerRow?.user_id) {
            const { data: u } = await svc.auth.admin.getUserById(ownerRow.user_id);
            const email = u?.user?.email;
            if (email) {
              const firstName = (u.user.user_metadata?.full_name || email.split("@")[0]).split(" ")[0];
              await sendLifecycleEmail(svc, {
                userId: ownerRow.user_id,
                email,
                firstName,
                kind: "payment_failed",
                invoiceUrl: invoice.hosted_invoice_url || null,
              });
            }
          }
        } catch (err) {
          console.warn("stripe-webhook: payment_failed email skipped:", err.message);
        }
      }

      return { ok: true };
    }

    /* ── Stripe Connect (Stage 3 patient portal) ─────────────────
       Direct charges to a connected account fire payment_intent.*
       events on BOTH the platform and the connected account; we
       subscribe both endpoints to catch all deliveries. The handler
       is keyed on stripe_payment_intent_id (unique), so duplicate
       deliveries from platform + connect are safely deduped via the
       reconcile path's "already succeeded" guard. */

    case "payment_intent.succeeded": {
      const pi = event.data.object;
      // Cardigan's PI metadata sets `cardigan_kind: 'patient_payment'`
      // — this lets us ignore PIs from any other Stripe activity that
      // happens to flow through the platform key (test mode quirks,
      // dashboard-created charges, etc).
      const kind = pi?.metadata?.cardigan_kind;
      if (kind !== "patient_payment") {
        return { ok: true, note: `non-patient PI succeeded: ${pi.id}` };
      }
      return reconcilePatientPaymentSuccess(svc, pi);
    }

    case "payment_intent.payment_failed":
    case "payment_intent.canceled": {
      const pi = event.data.object;
      const kind = pi?.metadata?.cardigan_kind;
      if (kind !== "patient_payment") {
        return { ok: true, note: `non-patient PI failed: ${pi.id}` };
      }
      const terminal = event.type === "payment_intent.canceled" ? "canceled" : "failed";
      return reconcilePatientPaymentFailed(svc, pi, terminal);
    }

    case "account.updated": {
      // Connect onboarding state change. The handler logs (Sentry
      // warning) when the account isn't in our DB and gates the
      // write on the event timestamp so a stale delivery can't
      // clobber a newer state.
      return applyConnectAccountUpdate(svc, event.data.object, eventCreatedUnix);
    }

    default:
      return { ok: true, note: `unhandled type: ${event.type}` };
  }
}

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Two webhook endpoints share this URL — one platform-mode, one
  // Connect-mode. They sign with different secrets. We verify against
  // the platform secret first (most events come from there), then fall
  // back to the Connect secret if configured. The Connect secret is
  // optional so older deploys / test-only environments still work
  // with just the platform endpoint configured.
  let platformSecret;
  try { platformSecret = getWebhookSecret(); }
  catch (err) {
    console.error("stripe-webhook:", err.message);
    return res.status(500).json({ error: "Webhook secret not configured" });
  }
  const connectSecret = getConnectWebhookSecret();

  const sigHeader = req.headers["stripe-signature"];
  if (!sigHeader) {
    return res.status(400).json({ error: "Missing Stripe-Signature header" });
  }

  const rawBody = await readRawBody(req);
  const headerStr = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
  // Iterate over the (one or two) configured secrets and accept if
  // any verifies. Cleaner than nested ||'s and easy to extend if a
  // third endpoint ever shares this URL.
  const secrets = [platformSecret, connectSecret].filter(Boolean);
  const ok = secrets.some((secret) =>
    verifyStripeSignature({ rawBody, header: headerStr, secret })
  );
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
    // Roll back the dedupe row so Stripe's retry actually re-processes
    // this event. Without the rollback, the next retry hits the unique
    // constraint at line ~487 and short-circuits to a duplicate-200 —
    // which means a transient handler crash silently and permanently
    // skips the event. Best-effort delete: if it fails, the worst case
    // is we 500 AND can't retry, which is the pre-fix behaviour.
    try {
      await svc.from("stripe_webhook_events")
        .delete()
        .eq("event_id", event.id);
    } catch (rollbackErr) {
      console.error("stripe-webhook rollback failed:", rollbackErr?.message);
    }
    // Surface 500 so Stripe retries — a thrown error is not the same
    // as a "skipped because no matching row" branch above.
    return res.status(500).json({ error: "Handler crashed" });
  }

  return res.status(200).json({ received: true });
}

export default withSentry(handler, { name: "stripe-webhook" });
