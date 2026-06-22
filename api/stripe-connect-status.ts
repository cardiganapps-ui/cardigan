/* ── GET /api/stripe-connect-status ───────────────────────────────
   Therapist polls the current state of their Connect account. The
   webhook is the canonical source of truth, but the therapist might
   land back on Cardigan within seconds of finishing onboarding —
   before the webhook has processed. So this endpoint also
   refresh-fetches the account from Stripe and writes any state delta
   back to the DB, ensuring the UI shows the correct state on first
   render.

   Response:
     200 { exists: false }                       — no account at all
     200 { exists: true, charges_enabled, payouts_enabled,
            details_submitted, requirements_count }
     401 — not signed in */

import { getAuthUser, getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";
import { getConnectAccount } from "./_stripe.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

async function handler(req: Row, res: Row) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const svc = getServiceClient();
  const { data: row, error: lookupErr } = await svc
    .from("therapist_connect_accounts")
    .select("stripe_account_id, charges_enabled, payouts_enabled, details_submitted, last_event_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (lookupErr) return res.status(500).json({ error: lookupErr.message });
  if (!row) return res.status(200).json({ exists: false });

  // Live-refresh against Stripe so the UI has the freshest possible
  // state. If Stripe's API is briefly slow we fall back to the cached
  // row — better to render slightly stale state than show a spinner
  // forever. Snapshot fetch time BEFORE the call so the stale-write
  // guard below uses a conservative timestamp.
  const fetchStartedIso = new Date().toISOString();
  let live = null;
  try {
    live = await getConnectAccount(row.stripe_account_id);
  } catch (err: Row) {
    console.warn("[stripe-connect-status] live fetch failed:", err?.message);
  }

  if (live) {
    const update = {
      charges_enabled: !!live.charges_enabled,
      payouts_enabled: !!live.payouts_enabled,
      details_submitted: !!live.details_submitted,
      updated_at: new Date().toISOString(),
    };
    // Only persist when the live state actually differs — avoids a
    // write on every status poll.
    const stateChanged =
      update.charges_enabled !== row.charges_enabled
      || update.payouts_enabled !== row.payouts_enabled
      || update.details_submitted !== row.details_submitted;
    if (stateChanged) {
      // Stale-write guard: a webhook (account.updated) with a newer
      // timestamp may have updated the row while our Stripe fetch
      // was in flight. Conditional UPDATE writes only when our
      // fetchStartedIso is strictly newer than what's there. Mirrors
      // the webhook's own guard so they cooperate cleanly.
      let upd = svc.from("therapist_connect_accounts")
        .update({ ...update, last_event_at: fetchStartedIso })
        .eq("user_id", user.id);
      upd = upd.or(`last_event_at.is.null,last_event_at.lt.${fetchStartedIso}`);
      await upd;
    }
    const reqs = live.requirements || {};
    const requirementsCount =
      (reqs.currently_due?.length || 0)
      + (reqs.past_due?.length || 0);
    return res.status(200).json({
      exists: true,
      charges_enabled: !!live.charges_enabled,
      payouts_enabled: !!live.payouts_enabled,
      details_submitted: !!live.details_submitted,
      requirements_count: requirementsCount,
    });
  }

  return res.status(200).json({
    exists: true,
    charges_enabled: !!row.charges_enabled,
    payouts_enabled: !!row.payouts_enabled,
    details_submitted: !!row.details_submitted,
    requirements_count: 0,
  });
}

export default withSentry(handler, { name: "stripe-connect-status" });
