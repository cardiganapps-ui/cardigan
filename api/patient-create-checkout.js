/* ── POST /api/patient-create-checkout ────────────────────────────
   Patient initiates an in-app payment to their therapist. We create
   a Stripe Checkout Session ON BEHALF of the therapist's Connect
   account (direct charges) so the funds settle directly into the
   therapist's balance — Cardigan never holds the money. No
   application_fee_amount in v1; the therapist keeps every peso minus
   Stripe's processing fee.

   Body: { patient_id, amount_cents }
   Response:
     200 { url, payment_intent_id }
     400 — bad input / amount over balance / amount below minimum
     401 — not signed in
     403 — patient_id forge (RLS doesn't return the row)
     409 — therapist hasn't enabled online payments yet
     500 — Stripe / DB error

   The Checkout Session URL is what the patient is redirected to.
   Stripe handles the entire card form + 3DS + receipt. On success
   they bounce back to /pago/exito; on cancel /pago/cancelar. The
   webhook (payment_intent.succeeded) is the source of truth — it
   inserts the canonical `payments` row + bumps patient.paid. */

import { createClient } from "@supabase/supabase-js";
import { getAuthUser, getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";
import { createPatientCheckoutSession } from "./_stripe.js";
import { safeAppOrigin } from "./_origin.js";

// Stripe minimum charge for MXN cards is 10 MXN (Stripe docs).
// We pad to 20 MXN so a tap-fingered $1 entry doesn't get a confusing
// rejection from Stripe.
const MIN_AMOUNT_CENTS = 2000;
// Defensive ceiling — no single online payment exceeds 50,000 MXN.
// A 7-figure typo gets a friendly 400 instead of a Stripe rejection.
const MAX_AMOUNT_CENTS = 50_000_00;

function getReturnUrls(req, patientId) {
  // Origin is allowlisted in safeAppOrigin — anything off-domain
  // collapses to the canonical https://cardigan.mx so a forged
  // header can't bounce the patient to attacker.com after Checkout.
  const base = safeAppOrigin(req);
  return {
    successUrl: `${base}/?pago=exito&p=${encodeURIComponent(patientId)}`,
    cancelUrl: `${base}/?pago=cancelado&p=${encodeURIComponent(patientId)}`,
  };
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { patient_id, amount_cents } = req.body || {};
  if (typeof patient_id !== "string" || !patient_id) {
    return res.status(400).json({ error: "Invalid patient_id" });
  }
  const amount = Number(amount_cents);
  if (!Number.isFinite(amount) || amount < MIN_AMOUNT_CENTS || amount > MAX_AMOUNT_CENTS) {
    return res.status(400).json({ error: "Invalid amount", code: "out_of_range" });
  }
  if (!Number.isInteger(amount)) {
    return res.status(400).json({ error: "Amount must be a whole number of cents" });
  }

  // Verify the patient row belongs to the caller via RLS. The patient-
  // side SELECT policy gates on patient_user_id = auth.uid() AND
  // status IN active/potential, so a forged patient_id from a row
  // that the patient hasn't claimed returns nothing and we 403.
  const userClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: req.headers.authorization } },
    }
  );
  const { data: patient, error: pErr } = await userClient
    .from("patients")
    .select("id, user_id, name")
    .eq("id", patient_id)
    .maybeSingle();
  if (pErr) return res.status(500).json({ error: pErr.message });
  if (!patient) return res.status(403).json({ error: "Forbidden" });

  // Verify the therapist has an active Connect account — service-role
  // read because the patient doesn't have RLS visibility into another
  // user's therapist_connect_accounts row.
  const svc = getServiceClient();
  const { data: tca, error: tcaErr } = await svc
    .from("therapist_connect_accounts")
    .select("stripe_account_id, charges_enabled")
    .eq("user_id", patient.user_id)
    .maybeSingle();
  if (tcaErr) return res.status(500).json({ error: tcaErr.message });
  if (!tca || !tca.charges_enabled) {
    return res.status(409).json({
      error: "Therapist hasn't enabled online payments",
      code: "not_enabled",
    });
  }

  // Mint the Checkout Session on the connected account (direct charge).
  // We tag every Stripe-side metadata field so the webhook can route
  // the eventual payment_intent.succeeded back to the right rows
  // without an extra DB lookup.
  const { successUrl, cancelUrl } = getReturnUrls(req, patient.id);
  let session;
  try {
    session = await createPatientCheckoutSession({
      accountId: tca.stripe_account_id,
      amountCents: amount,
      currency: "mxn",
      customerEmail: user.email,
      successUrl,
      cancelUrl,
      metadata: {
        cardigan_kind: "patient_payment",
        patient_id: patient.id,
        therapist_user_id: patient.user_id,
        paid_by_user_id: user.id,
      },
      // Idempotency-key to one-minute buckets keyed on (patient, amount).
      // A double-tap on "Pagar" within the same minute reuses the same
      // Checkout Session; a deliberate retry one minute later starts
      // fresh. Mirrors the SaaS subscription pattern.
      idempotencyKey: `cardigan-pay-${patient.id}-${amount}-${Math.floor(Date.now() / 60000)}`,
    });
  } catch (err) {
    console.error("[patient-create-checkout] Stripe failed:", err?.message);
    return res.status(500).json({ error: "Could not start checkout" });
  }

  // Persist the PI ID so the webhook can find this row when
  // payment_intent.succeeded arrives. The session.payment_intent
  // is the PI id (string). Status starts as 'pending'; the webhook
  // advances it to 'succeeded' / 'failed'.
  const piId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id;
  if (!piId) {
    // Shouldn't happen — Checkout returns a PI immediately for
    // mode=payment. Surface as 500 so the patient retries.
    return res.status(500).json({ error: "Stripe returned no payment intent" });
  }

  // Insert the ledger row. 23505 = unique violation on
  // stripe_payment_intent_id, which means the idempotency key resolved
  // to the SAME PI → we already have a row → fall through and return.
  const { error: insertErr } = await svc
    .from("patient_payment_intents")
    .insert({
      patient_id: patient.id,
      therapist_user_id: patient.user_id,
      paid_by_user_id: user.id,
      stripe_payment_intent_id: piId,
      stripe_account_id: tca.stripe_account_id,
      amount_cents: amount,
      currency: "mxn",
      status: "pending",
    });
  if (insertErr && insertErr.code !== "23505") {
    return res.status(500).json({ error: insertErr.message });
  }

  return res.status(200).json({
    url: session.url,
    payment_intent_id: piId,
  });
}

export default withSentry(handler, { name: "patient-create-checkout" });
