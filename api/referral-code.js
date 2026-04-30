/* ── /api/referral-code ───────────────────────────────────────────────
   Self-service referral-code accessor.

     GET    → returns { code, rewardsCount, pendingCreditCents }. If
              the user doesn't have a referral_code yet, one is
              generated and persisted in this call (lazy creation
              avoids minting a code for users who never visit the
              Suscripción settings panel).

   The rewards count and pending credit are informational — useful for
   the "Has invitado a N personas" line in the Settings UI. The actual
   credit lives in Stripe's customer balance once the user is a paid
   customer; pendingCreditCents is the not-yet-applied accrual for
   inviters who haven't subscribed.

   We don't expose POST/DELETE: the code is unconditionally generated
   and never rotates. If a user ever wants to rotate (compromised /
   code-stuffing campaign), an admin endpoint would be the right
   place. For now we don't ship that. */

import crypto from "node:crypto";
import { getAuthUser } from "./_r2.js";
import { getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";

// Skip 0/O/1/I/L for human readability when shared verbally.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function newCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

async function ensureCode(svc, userId) {
  // Try a few times in case of a collision (extremely unlikely with
  // 31^8 ≈ 8.5e11 keyspace, but the unique constraint will reject
  // collisions, and we'd rather retry than 500 the request).
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    // Use a placeholder customer id when the row doesn't exist yet —
    // same convention as admin-grant-comp.js. The non-null constraint
    // on stripe_customer_id requires a value at INSERT time. The
    // referral_code becomes the primary user-facing identifier.
    const { data: existing } = await svc
      .from("user_subscriptions")
      .select("referral_code")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing?.referral_code) return existing.referral_code;
    if (existing) {
      const { error: updateError } = await svc
        .from("user_subscriptions")
        .update({ referral_code: code, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      if (!updateError) return code;
      if (updateError.code !== "23505") throw new Error(updateError.message);
      // 23505 = unique violation: same code generated twice in a row,
      // rare but possible. Loop and try again.
      continue;
    }
    const { error: insertError } = await svc
      .from("user_subscriptions")
      .insert({
        user_id: userId,
        stripe_customer_id: `pending_${userId}`,
        referral_code: code,
      });
    if (!insertError) return code;
    if (insertError.code !== "23505") throw new Error(insertError.message);
  }
  throw new Error("Failed to generate unique referral code after retries");
}

async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const svc = getServiceClient();

  let code;
  try {
    code = await ensureCode(svc, user.id);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to generate code" });
  }

  // Re-read to get the rewards count + pending credit alongside the
  // code (atomic snapshot is overkill here; a one-row select is fine).
  const { data, error } = await svc
    .from("user_subscriptions")
    .select("referral_rewards_count, pending_credit_amount_cents")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({
    code,
    rewardsCount: data?.referral_rewards_count || 0,
    pendingCreditCents: data?.pending_credit_amount_cents || 0,
  });
}

export default withSentry(handler, { name: "referral-code" });
