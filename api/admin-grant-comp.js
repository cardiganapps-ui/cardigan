/* ── POST /api/admin-grant-comp ───────────────────────────────────────
   Admin-only. Toggles complimentary (always-free) access for a user.
   Used for early-access friends, pilot users, or fixing edge cases
   where a paid customer should be granted permanent access.

   Request body:
     { user_id: <uuid>, granted: true | false, reason?: string }

   When granted=true:
     - Upsert user_subscriptions row (creating one if needed) with
       comp_granted=true and audit fields. We do NOT touch the
       stripe_customer_id field — if it's null they don't have a
       Stripe-side record and don't need one. If they already have a
       Stripe sub, comp_granted overrides without cancelling it (admin
       can cancel via the Stripe dashboard if they want).

   When granted=false:
     - Set comp_granted=false. If there's an active Stripe sub, normal
       paid-status flows resume. If not, the user falls back to the
       trial check (which has likely lapsed by now); they'll see the
       expired banner and need to subscribe.

   Caller responsibility: the AdminPanel should explain the implications
   in its confirmation copy ("This grants free access until you revoke
   it"). This endpoint just flips the flag. */

import { requireAdmin, getServiceClient, isValidUserId } from "./_admin.js";
import { withSentry } from "./_sentry.js";

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return; // requireAdmin already wrote 401/403

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}); }
  catch { return res.status(400).json({ error: "Invalid JSON" }); }

  const { user_id: userId, granted, reason } = body;
  if (!isValidUserId(userId)) {
    return res.status(400).json({ error: "Invalid user_id" });
  }
  if (typeof granted !== "boolean") {
    return res.status(400).json({ error: "granted must be a boolean" });
  }

  const svc = getServiceClient();

  // Look up an existing row first — if there's one, update; otherwise
  // we have to create a row WITHOUT a stripe_customer_id, which is a
  // schema violation (not null constraint). For comp-only users we
  // mint a placeholder customer id locally — `comp_<userId>` — that's
  // never sent to Stripe. The webhook never sees it; the checkout
  // endpoint refuses to start a Stripe flow for comp users anyway.
  const { data: existing, error: lookupError } = await svc
    .from("user_subscriptions")
    .select("user_id, stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (lookupError) return res.status(500).json({ error: "Lookup failed" });

  const now = new Date().toISOString();
  const auditFields = granted
    ? {
        comp_granted: true,
        comp_granted_at: now,
        comp_granted_by: admin.email || admin.id,
        comp_reason: reason || null,
        updated_at: now,
      }
    : {
        comp_granted: false,
        // Keep granted_at / granted_by / reason as audit history; the
        // boolean flag is enough to gate access and the trail tells us
        // when the comp was originally issued.
        updated_at: now,
      };

  if (existing) {
    const { error } = await svc
      .from("user_subscriptions")
      .update(auditFields)
      .eq("user_id", userId);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    // Brand-new comp-only row. The placeholder customer id is unique
    // (per the table's unique constraint) and intentionally distinct
    // from any real Stripe customer id (Stripe ids start with "cus_").
    const { error } = await svc
      .from("user_subscriptions")
      .insert({
        user_id: userId,
        stripe_customer_id: `comp_${userId}`,
        ...auditFields,
      });
    if (error) return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ ok: true, comp_granted: granted });
}

export default withSentry(handler, { name: "admin-grant-comp" });
