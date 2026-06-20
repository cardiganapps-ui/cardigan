/* ── POST /api/patient-claim ──────────────────────────────────────
   Patient-side. Redeems an invite token: validates it's still good,
   stamps `patient_user_id = auth.uid()` on the linked patients row,
   and marks the invite used. Both writes are race-safe — a
   conditional UPDATE returning rows guarantees only one concurrent
   claim wins.

   Body: { token: string }
   Auth: standard JWT (the about-to-be-patient user).
   Response:
     200 { patient_id, therapist_user_id }
     400 — missing token
     401 — not signed in
     404 — token doesn't exist OR patient row was deleted
     409 — token already claimed
     410 — token expired */

import { createHash } from "node:crypto";
import { getAuthUser, getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";
import { rateLimit } from "./_ratelimit.js";

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  // Per-user limiter — token redemption is the brute-force surface
  // (an attacker guessing token hashes). 256-bit tokens make guessing
  // infeasible, but the cap blunts any automated probing and the DB
  // load it would generate. 20 in 60s is generous for a real claim.
  const rl = await rateLimit({
    endpoint: "patient-claim",
    bucket: user.id,
    max: 20,
    windowSec: 60,
  });
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfter));
    return res.status(429).json({ error: "Demasiados intentos. Espera un minuto." });
  }

  const { token } = req.body || {};
  if (typeof token !== "string" || !token) {
    return res.status(400).json({ error: "Invalid token" });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const svc = getServiceClient();

  // 1. Look up the invite. Pull patient_id + therapist + expiry +
  //    used_at so we can build a precise error response.
  const { data: invite, error: lookupErr } = await svc
    .from("patient_invites")
    .select("id, patient_id, therapist_id, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (lookupErr) {
    return res.status(500).json({ error: lookupErr.message });
  }
  if (!invite) {
    return res.status(404).json({ error: "Token not found", code: "not_found" });
  }
  if (invite.used_at) {
    return res.status(409).json({ error: "Token already used", code: "already_used" });
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: "Token expired", code: "expired" });
  }

  // 2. Race-safe atomic claim: only the first concurrent caller
  //    flips used_at from null to a real timestamp; subsequent
  //    callers see 0 affected rows and 409.
  const { data: claimed, error: claimErr } = await svc
    .from("patient_invites")
    .update({
      used_at: new Date().toISOString(),
      used_by_user_id: user.id,
    })
    .eq("id", invite.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (claimErr) {
    return res.status(500).json({ error: claimErr.message });
  }
  if (!claimed) {
    return res.status(409).json({ error: "Token already used", code: "race_lost" });
  }

  // 3. Stamp patient_user_id. Also race-safe: if some prior claim
  //    already set the column to a different user, the WHERE clause
  //    drops to 0 rows and we surface 409. (Shouldn't happen given
  //    step 2's lock, but defense in depth.)
  const { data: stamped, error: stampErr } = await svc
    .from("patients")
    .update({ patient_user_id: user.id })
    .eq("id", invite.patient_id)
    .is("patient_user_id", null)
    .select("id")
    .maybeSingle();
  if (stampErr) {
    return res.status(500).json({ error: stampErr.message });
  }
  if (!stamped) {
    // Patient row either deleted between invite-create and claim,
    // OR was already linked to a different user. Either way the
    // invite is dead — the user couldn't have claimed it usefully.
    // Roll back the invite so it doesn't sit there as a confusing
    // "used" row pointing at nothing.
    await svc.from("patient_invites")
      .update({ used_at: null, used_by_user_id: null })
      .eq("id", invite.id);
    // Distinguish row-deleted (404) from already-linked (409) by
    // re-checking patients existence.
    const { data: stillExists } = await svc
      .from("patients")
      .select("id, patient_user_id")
      .eq("id", invite.patient_id)
      .maybeSingle();
    if (!stillExists) {
      return res.status(404).json({ error: "Patient row deleted", code: "patient_gone" });
    }
    return res.status(409).json({ error: "Patient already linked", code: "patient_linked" });
  }

  return res.status(200).json({
    patient_id: invite.patient_id,
    therapist_user_id: invite.therapist_id,
  });
}

export default withSentry(handler, { name: "patient-claim" });
