/* ── POST /api/stripe-connect-onboard ─────────────────────────────
   Therapist starts (or resumes) Stripe Connect Express onboarding.
   Idempotent: if a row already exists in therapist_connect_accounts,
   we reuse the stripe_account_id and just mint a fresh Account Link.
   If not, we create a new Express account first.

   Body: none (the user_id comes from the JWT)
   Response:
     200 { url, account_id, expires_at }
     401 — not signed in
     500 — Stripe / DB error

   The returned URL is a one-shot, 5-minute Stripe-hosted onboarding
   link. The therapist clicks through, Stripe handles the entire
   identity-verification + bank-setup flow, then redirects them back
   to our `return_url` (or `refresh_url` if the link expired). The
   webhook (account.updated) populates charges_enabled and friends. */

import { getAuthUser, getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";
import { createConnectAccount, createAccountLink } from "./_stripe.js";
import { safeAppOrigin } from "./_origin.js";

function getReturnUrls(req) {
  // Origin is allowlisted in safeAppOrigin — production / preview /
  // localhost survive, anything else collapses to the canonical
  // domain so a forged header can't bounce the therapist to
  // attacker.com after Stripe's hosted onboarding return.
  const base = safeAppOrigin(req);
  return {
    returnUrl: `${base}/?stripe_connect=return`,
    refreshUrl: `${base}/?stripe_connect=refresh`,
  };
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const svc = getServiceClient();

  // Reuse an existing Connect account if one is already on file. The
  // therapist may be coming back to finish onboarding (Stripe's flow
  // is multi-step and they can drop out partway).
  const { data: existing, error: lookupErr } = await svc
    .from("therapist_connect_accounts")
    .select("stripe_account_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (lookupErr) return res.status(500).json({ error: lookupErr.message });

  let accountId = existing?.stripe_account_id;

  if (!accountId) {
    // First-time onboarding — create the Express account.
    try {
      const fullName = user.user_metadata?.full_name || null;
      const account = await createConnectAccount({
        email: user.email,
        userId: user.id,
        fullName,
      });
      accountId = account.id;
      const { error: insertErr } = await svc
        .from("therapist_connect_accounts")
        .insert({
          user_id: user.id,
          stripe_account_id: accountId,
          charges_enabled: !!account.charges_enabled,
          payouts_enabled: !!account.payouts_enabled,
          details_submitted: !!account.details_submitted,
        });
      if (insertErr && insertErr.code !== "23505") {
        // 23505 = unique violation, which means a concurrent call beat
        // us to the insert. Fall through and use the existing row.
        return res.status(500).json({ error: insertErr.message });
      }
    } catch (err) {
      console.error("[stripe-connect-onboard] create account failed:", err?.message);
      return res.status(500).json({ error: "Could not create Stripe account" });
    }
  }

  // Mint a fresh Account Link. Always single-use; the therapist gets
  // a new one each time they tap "Empezar" / "Continuar" so an old
  // link sitting in their browser history is harmless.
  const { returnUrl, refreshUrl } = getReturnUrls(req);
  try {
    const link = await createAccountLink({
      accountId,
      returnUrl,
      refreshUrl,
    });
    return res.status(200).json({
      url: link.url,
      account_id: accountId,
      expires_at: link.expires_at,
    });
  } catch (err) {
    console.error("[stripe-connect-onboard] account link failed:", err?.message);
    return res.status(500).json({ error: "Could not start onboarding" });
  }
}

export default withSentry(handler, { name: "stripe-connect-onboard" });
