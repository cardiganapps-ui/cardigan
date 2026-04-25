/* ── /api/encryption — note-encryption setup & status ─────────────────
   Three operations on the user's user_encryption_keys row:

     GET    → returns wrap metadata (or { enabled: false } when none).
              The CT and salt go to the browser unauthenticated-read-
              wise, which is fine — they're useless without the
              passphrase.
     POST   → first-time setup. Stores both wraps. Rejects if a row
              already exists.
     PUT    → re-wrap with a new passphrase (passphrase change).
              Updates the passphrase wrap fields only; the recovery
              wrap is unchanged because the master key didn't change.
     DELETE → disable. Drops the row. The user's encrypted notes
              become permanently unreadable.

   All four require a valid Supabase JWT. The handler uses the
   service-role client so RLS doesn't block service-side operations
   that are intentionally scoped by user_id below. */

import { getAuthUser } from "./_r2.js";
import { getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";
import { getFlag } from "./_flags.js";

function pick(body, keys) {
  const out = {};
  for (const k of keys) if (body[k] !== undefined) out[k] = body[k];
  return out;
}

function validateWrap(b) {
  if (typeof b.passphrase_wrap !== "string" || b.passphrase_wrap.length < 16) return "Invalid passphrase_wrap";
  if (typeof b.passphrase_salt !== "string" || b.passphrase_salt.length < 8)  return "Invalid passphrase_salt";
  if (typeof b.passphrase_iv   !== "string" || b.passphrase_iv.length   < 8)  return "Invalid passphrase_iv";
  if (!Number.isInteger(b.passphrase_iters) || b.passphrase_iters < 100_000)  return "Invalid passphrase_iters";
  return null;
}

async function handler(req, res) {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const svc = getServiceClient();

  if (req.method === "GET") {
    const { data, error } = await svc
      .from("user_encryption_keys")
      .select("passphrase_wrap, passphrase_salt, passphrase_iv, passphrase_iters")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: "Lookup failed" });
    if (!data) return res.status(200).json({ enabled: false });
    return res.status(200).json({ enabled: true, ...data });
  }

  if (req.method === "POST") {
    // Edge Config kill switch — flip encryption_setup_enabled=false to
    // pause new encryption sign-ups while we investigate a bug. Existing
    // users with encryption already configured are unaffected (GET/PUT/
    // DELETE keep working).
    if (!(await getFlag("encryption_setup_enabled"))) {
      return res.status(503).json({ error: "Encryption setup temporarily unavailable" });
    }
    const body = req.body || {};
    const validationError = validateWrap(body);
    if (validationError) return res.status(400).json({ error: validationError });
    if (typeof body.recovery_wrap !== "string" || body.recovery_wrap.length < 64) {
      return res.status(400).json({ error: "Invalid recovery_wrap" });
    }
    const recoveryKid = typeof body.recovery_kid === "string" && body.recovery_kid.length > 0
      ? body.recovery_kid : "v1";

    // Reject re-setup — must DELETE first to overwrite, or PUT to
    // re-wrap. Otherwise a malicious caller could blow away an
    // existing wrap row with one they control.
    const { data: existing } = await svc
      .from("user_encryption_keys")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing) return res.status(409).json({ error: "Encryption already set up" });

    const { error: insErr } = await svc.from("user_encryption_keys").insert({
      user_id: user.id,
      ...pick(body, ["passphrase_wrap", "passphrase_salt", "passphrase_iv", "passphrase_iters"]),
      recovery_wrap: body.recovery_wrap,
      recovery_kid: recoveryKid,
    });
    if (insErr) return res.status(500).json({ error: insErr.message || "Insert failed" });
    return res.status(200).json({ ok: true });
  }

  if (req.method === "PUT") {
    const body = req.body || {};
    const validationError = validateWrap(body);
    if (validationError) return res.status(400).json({ error: validationError });
    const { error: upErr } = await svc
      .from("user_encryption_keys")
      .update({
        ...pick(body, ["passphrase_wrap", "passphrase_salt", "passphrase_iv", "passphrase_iters"]),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);
    if (upErr) return res.status(500).json({ error: upErr.message || "Update failed" });
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const { error: delErr } = await svc
      .from("user_encryption_keys")
      .delete()
      .eq("user_id", user.id);
    if (delErr) return res.status(500).json({ error: delErr.message || "Delete failed" });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

export default withSentry(handler, { name: "encryption" });
