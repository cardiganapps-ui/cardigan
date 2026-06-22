/* ── GET /api/patient-invite-preview?token=… ──────────────────────
   Anonymous read of an invite's metadata so the welcome screen can
   show "[Therapist name] te invitó" before the patient signs in.
   Deliberately minimal: returns only the therapist's display name +
   profession + token state. No patient name, no patient row data,
   no therapist email/phone.

   The token itself is the credential — if the URL leaks, the leaker
   sees the same metadata anyway. We never expose the patient row
   contents pre-claim because (a) we don't know yet if the caller
   should ever own that data, and (b) it'd be a privacy regression
   relative to the current patient model.

   Returns:
     200 { therapist_full_name, therapist_profession, expired, used }
     400 — missing token
     404 — token doesn't exist */

import { createHash } from "node:crypto";
import { getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";
import { rateLimit, getClientIp } from "./_ratelimit.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

async function handler(req: Row, res: Row) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const token = req.query?.token;
  if (typeof token !== "string" || !token) {
    return res.status(400).json({ error: "Invalid token" });
  }

  // Anonymous endpoint — bucket per-IP. Tokens are 256-bit CSPRNG so
  // direct brute-force is intractable, but a per-IP cap prevents an
  // attacker from sweeping a leaked token range and learning which
  // ones map to live invites.
  const rl = await rateLimit({ endpoint: "patient-invite-preview", bucket: getClientIp(req), max: 60, windowSec: 3600 });
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfter));
    return res.status(429).json({ error: "Too many requests" });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const svc = getServiceClient();

  const { data: invite, error } = await svc
    .from("patient_invites")
    .select("therapist_id, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) {
    // Don't leak Supabase error.message — could disclose schema /
    // RLS policy names. Sentry has the full error via withSentry.
    return res.status(500).json({ error: "Lookup failed" });
  }
  if (!invite) {
    return res.status(404).json({ error: "Token not found", code: "not_found" });
  }

  // Resolve therapist display fields — name from auth.users.user_metadata,
  // profession from user_profiles. Both via service-role since the
  // anonymous caller has no JWT.
  const { data: therapistRow } = await svc.auth.admin.getUserById(invite.therapist_id);
  const therapist = therapistRow?.user;
  const therapistName = therapist?.user_metadata?.full_name
    || therapist?.email?.split("@")[0]
    || "";

  const { data: profile } = await svc
    .from("user_profiles")
    .select("profession")
    .eq("user_id", invite.therapist_id)
    .maybeSingle();
  const profession = profile?.profession || "psychologist";

  const expired = new Date(invite.expires_at).getTime() < Date.now();

  return res.status(200).json({
    therapist_full_name: therapistName,
    therapist_profession: profession,
    expired,
    used: !!invite.used_at,
    expires_at: invite.expires_at,
  });
}

export default withSentry(handler, { name: "patient-invite-preview" });
