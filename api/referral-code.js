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

/* ── Code format: WORD + 3 digits ────────────────────────────────────
   Codes are designed to be spoken out loud and remembered after a
   single read — way friendlier than the previous 8-char random
   string. The wordlist is curated Spanish-flavored vocabulary that's
   easy to pronounce, has no accents or ñ, and skews positive /
   Cardigan-y (nature, comfort, knitting). 3-digit suffix keeps the
   keyspace at ~80,000 codes (80 words × 1000 numbers) — well above
   our foreseeable user count, and the ensureCode loop handles the
   rare collision.

   Codes already issued under the previous 8-char format remain valid;
   we only mint the new shape going forward. The validators in
   /api/stripe-checkout and /api/stripe-create-subscription accept
   anything matching /^[A-Z0-9]+$/ up to 16 chars, which covers both. */
const REFERRAL_WORDS = [
  // Knitting / cozy
  "LANA", "TEJER", "NUDO", "HILO", "MANTA", "CAFE", "CHAI", "MIEL",
  "PAN", "TEAL", "OCRE", "TRIGO",
  // Nature
  "MAR", "RIO", "SOL", "LUNA", "NUBE", "FLOR", "ROSA", "ROBLE",
  "CIELO", "BREZO", "JADE", "PINO", "MIRTO", "OLA", "BAHIA", "RAYO",
  "LAGO", "PRADO", "TIERRA", "BOSQUE", "VALLE", "MONTE", "ROCIO",
  "ALBA", "AURORA",
  // Birds / animals
  "AVE", "GAVIOTA", "ZORRO", "CIERVO", "LOBO", "FOCA", "OSO", "GATO",
  "LINCE", "BUHO", "GARZA", "CISNE",
  // Colors
  "ORO", "PLATA", "GRANA", "LILA", "AMBAR", "INDIGO", "VERDE", "RUBI",
  "TOPACIO",
  // Calm / care vibe
  "PAUSA", "CALMA", "ABRIGO", "REFUGIO", "NIDO", "FARO", "PUENTE",
  "VEREDA", "CAMINO", "VIENTO", "BRISA", "ECO", "NORTE", "SUR",
  "ESTE", "OESTE", "RUTA", "VELA", "LIRA", "SAUCE", "OLIVO",
  "CANELA", "CEDRO", "TILO", "ENEBRO",
];

function newCode() {
  // crypto.randomBytes for both halves so we don't mix Math.random
  // entropy with the rest of the system. Two bytes is more than
  // enough range to mod into the wordlist + 1000.
  const wordIdx = crypto.randomBytes(2).readUInt16BE(0) % REFERRAL_WORDS.length;
  const num = crypto.randomBytes(2).readUInt16BE(0) % 1000;
  return REFERRAL_WORDS[wordIdx] + String(num).padStart(3, "0");
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
