/* ── POST /api/admin-recover-encryption ──
   Admin-only. Decrypts a target user's recovery_wrap with the server
   private key (NOTES_RECOVERY_PRIVATE_KEY) and returns the resulting
   master-key bytes as a base64 string.

   Use case: the user forgot their passphrase. The admin runs this
   endpoint, gets the master key, sends it to the user out-of-band
   (email / signal). The user pastes it into a "Restablecer cifrado"
   flow that sets a new passphrase.

   This is the ONE place the server can produce plaintext key
   material, so it's gated by:
     1. A standard JWT verified to belong to the admin (requireAdmin).
     2. A non-default audit log line so we can trace usage.

   The private key is loaded once per cold-start and kept in module
   scope — it's a few KB and idempotent imports are cheap. */

import crypto from "node:crypto";
import { requireAdmin, getServiceClient, isValidUserId } from "./_admin.js";
import { withSentry } from "./_sentry.js";

let cachedPrivateKey = null;
function getPrivateKey() {
  if (cachedPrivateKey) return cachedPrivateKey;
  const b64 = process.env.NOTES_RECOVERY_PRIVATE_KEY;
  if (!b64) throw new Error("NOTES_RECOVERY_PRIVATE_KEY is not set");
  cachedPrivateKey = crypto.createPrivateKey({
    key: Buffer.from(b64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  return cachedPrivateKey;
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { userId } = req.body || {};
  if (!isValidUserId(userId)) return res.status(400).json({ error: "Invalid userId" });

  const svc = getServiceClient();
  const { data: row, error } = await svc
    .from("user_encryption_keys")
    .select("recovery_wrap, recovery_kid")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: "Lookup failed" });
  if (!row) return res.status(404).json({ error: "User has no encryption set up" });

  let masterKeyBytes;
  try {
    masterKeyBytes = crypto.privateDecrypt(
      {
        key: getPrivateKey(),
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(row.recovery_wrap, "base64")
    );
  } catch (err) {
    // Surface a clean error rather than leaking the raw OpenSSL
    // message — most failures here are kid-mismatches (wrong server
    // key for this wrap) which the admin should resolve out-of-band.
    return res.status(500).json({ error: "Recovery decrypt failed", code: "decrypt_failed", kid: row.recovery_kid });
  }

  if (masterKeyBytes.length !== 32) {
    return res.status(500).json({ error: "Unexpected master key length" });
  }

  // Audit trail. Goes to Vercel logs and Sentry breadcrumbs.
  console.log(JSON.stringify({
    evt: "encryption.recovery",
    actor: admin.id,
    target: userId,
    kid: row.recovery_kid,
    ts: new Date().toISOString(),
  }));

  return res.status(200).json({
    master_key: masterKeyBytes.toString("base64"),
    recovery_kid: row.recovery_kid,
  });
}

export default withSentry(handler, { name: "admin-recover-encryption" });
