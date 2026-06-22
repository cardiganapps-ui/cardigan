/* ── POST /api/stripe-connect-dashboard ───────────────────────────
   Therapist taps "Abrir panel de Stripe" → we mint a one-time login
   link to their Express Dashboard. Stripe handles the rest: balance,
   payouts, transactions, tax docs, account management.

   Response:
     200 { url }
     401 — not signed in
     404 — no Connect account on file
     500 — Stripe error */

import { getAuthUser, getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";
import { createLoginLink } from "./_stripe.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

async function handler(req: Row, res: Row) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const svc = getServiceClient();
  const { data: row, error: lookupErr } = await svc
    .from("therapist_connect_accounts")
    .select("stripe_account_id, details_submitted")
    .eq("user_id", user.id)
    .maybeSingle();
  if (lookupErr) return res.status(500).json({ error: lookupErr.message });
  if (!row) return res.status(404).json({ error: "No Connect account" });
  if (!row.details_submitted) {
    // Stripe rejects login_links for accounts that haven't completed
    // onboarding. Surface a clear error so the UI can route them to
    // the onboarding flow instead.
    return res.status(409).json({ error: "Onboarding not finished", code: "incomplete" });
  }

  try {
    const link = await createLoginLink(row.stripe_account_id);
    return res.status(200).json({ url: link.url });
  } catch (err: Row) {
    console.error("[stripe-connect-dashboard] failed:", err?.message);
    return res.status(500).json({ error: "Could not open Stripe dashboard" });
  }
}

export default withSentry(handler, { name: "stripe-connect-dashboard" });
