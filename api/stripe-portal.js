/* ── POST /api/stripe-portal ──────────────────────────────────────────
   Returns a one-shot Stripe Billing Portal URL for the caller. The
   portal lets the user update their payment method, view invoices,
   and cancel (at period end). Configuration of which features are
   available was done once at Stripe-side via the API; we just pull a
   session for THIS customer.

   Failure modes worth knowing:
     - User has no user_subscriptions row → 404 (they've never started
       a checkout, so there's nothing to manage). The UI should hide
       the "Administrar" button when status === null.
     - Stripe returns an error → 502, message bubbled up. Most common
       cause is a stale customer id (e.g. someone deleted the customer
       in the dashboard); the user has to start a new checkout. */

import { getAuthUser } from "./_r2.js";
import { getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";
import { createBillingPortalSession } from "./_stripe.js";

function appOrigin(req) {
  const origin = req.headers.origin;
  if (origin) return origin;
  const host = req.headers["x-forwarded-host"] || req.headers.host || "cardigan.mx";
  return `https://${host}`;
}

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const svc = getServiceClient();
  const { data: row, error: lookupError } = await svc
    .from("user_subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (lookupError) return res.status(500).json({ error: "Lookup failed" });
  if (!row?.stripe_customer_id) {
    return res.status(404).json({ error: "No subscription record" });
  }

  let session;
  try {
    session = await createBillingPortalSession({
      customerId: row.stripe_customer_id,
      returnUrl: `${appOrigin(req)}/?billing=return`,
    });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Stripe portal create failed" });
  }

  return res.status(200).json({ url: session.url });
}

export default withSentry(handler, { name: "stripe-portal" });
