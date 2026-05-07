/* ── POST /api/patient-invite ─────────────────────────────────────
   Therapist-only. Generates a single-use invite token for a patient
   the therapist owns and returns the shareable URL once. The
   plaintext token is never persisted — only its SHA-256 hash sits
   in `patient_invites.token_hash`.

   Flow:
     1. Verify caller is authenticated (JWT).
     2. Verify the patient row belongs to the caller (RLS check via
        the user's own client — guards against patient_id forgery).
     3. Generate 32-byte CSPRNG → base64url. Take a 6-char prefix
        for the therapist's UI; SHA-256 the rest for storage.
     4. Insert the invite row via service-role (RLS would also let
        the therapist insert via their own client, but going through
        service-role here keeps the pattern uniform with claim-side
        writes).
     5. Return { url, expires_at, token_prefix } — plaintext token
        embedded in the URL, never sent again.

   Body: { patient_id: string }
   Auth: standard JWT (therapist).
   Response: 200 { url, expires_at, token_prefix } | 400 | 401 | 404 */

import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getAuthUser, getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";

const APP_URL = "https://cardigan.mx";

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { patient_id } = req.body || {};
  if (typeof patient_id !== "string" || !patient_id) {
    return res.status(400).json({ error: "Invalid patient_id" });
  }

  // Verify ownership via the user's own JWT'd client. This goes
  // through RLS so a forged patient_id from a different therapist
  // returns no row and we 404 cleanly without leaking existence.
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
    .select("id, name, patient_user_id")
    .eq("id", patient_id)
    .single();
  if (pErr || !patient) {
    return res.status(404).json({ error: "Patient not found" });
  }

  // Generate the token. 32 bytes = 256 bits of entropy, ~43 chars
  // base64url. The 6-char prefix is presentational only (doesn't
  // weaken the hash).
  const tokenBytes = randomBytes(32);
  const token = tokenBytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const tokenPrefix = token.slice(0, 6);
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const svc = getServiceClient();
  const { data: invite, error: insertErr } = await svc
    .from("patient_invites")
    .insert({
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      patient_id: patient.id,
      therapist_id: user.id,
    })
    .select("expires_at")
    .single();
  if (insertErr) {
    return res.status(500).json({ error: insertErr.message || "Failed to create invite" });
  }

  const url = `${APP_URL}/i/${token}`;
  return res.status(200).json({
    url,
    token_prefix: tokenPrefix,
    expires_at: invite.expires_at,
    already_linked: !!patient.patient_user_id,
  });
}

export default withSentry(handler, { name: "patient-invite" });
