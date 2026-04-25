/* ── Note encryption (client-side) ───────────────────────────────────
   All crypto for the at-rest note encryption feature lives here. Pure
   functions over the WebCrypto API — no React, no DB, no module-level
   state — so the unit tests can exercise the round-trip without any
   harness work.

   Threat model recap (longer write-up in CLAUDE.md):
     1. Master key is generated client-side, never leaves the device
        in plaintext.
     2. Passphrase wrap (AES-GCM under a PBKDF2-derived key) is the
        user's daily unlock path.
     3. Recovery wrap (RSA-OAEP-2048 under a public key bundled in the
        client) lets the admin decrypt a user's master key with the
        matching server-held private key. Used only for password
        recovery; otherwise the server sees only ciphertext.
     4. AES-GCM is authenticated, so a server-modified ciphertext or a
        truncated payload fails to decrypt — silent corruption can't
        slip into a note.

   Format on the wire (note ciphertext, base64-encoded in notes.content):
       v1 || iv(12 bytes) || gcm_ciphertext_with_tag

   Format of passphrase_wrap (base64-encoded):
       iv(12) || gcm_wrap_of_master_key_with_tag
   The salt and iteration count live in their own columns.
*/

const PBKDF2_ITERS = 600_000;
const PBKDF2_HASH = "SHA-256";
const SALT_BYTES = 16;
const IV_BYTES = 12;
const NOTE_FORMAT_VERSION = 1;

function getCrypto() {
  // WebCrypto is available globally in modern browsers + Node 16+.
  // Throw a clear message rather than letting a TypeError surface
  // halfway through a wrap.
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error("WebCrypto subtle API is unavailable in this environment");
  }
  return c;
}

// ── Encoding helpers ──────────────────────────────────────────────────
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

function bytesToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concatBytes(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

// ── Random material ──────────────────────────────────────────────────
export function randomBytes(n) {
  const out = new Uint8Array(n);
  getCrypto().getRandomValues(out);
  return out;
}

export function generateMasterKeyBytes() {
  return randomBytes(32); // AES-256
}

// ── Passphrase derivation ────────────────────────────────────────────
async function deriveKeyFromPassphrase(passphrase, salt, iters = PBKDF2_ITERS) {
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    throw new Error("Passphrase is required");
  }
  const c = getCrypto();
  const baseKey = await c.subtle.importKey(
    "raw",
    textEncoder.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return c.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: iters, hash: PBKDF2_HASH },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ── Master key import ────────────────────────────────────────────────
async function importAesKey(rawBytes) {
  return getCrypto().subtle.importKey(
    "raw",
    rawBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ── Recovery (RSA-OAEP) ──────────────────────────────────────────────
async function importRecoveryPublicKey(spkiBase64) {
  if (!spkiBase64) throw new Error("Recovery public key not configured");
  return getCrypto().subtle.importKey(
    "spki",
    base64ToBytes(spkiBase64),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Wrap the master key under a passphrase.
 * Returns { passphrase_wrap, passphrase_salt, passphrase_iv, passphrase_iters }
 * (all strings, base64-encoded where binary).
 */
export async function wrapMasterWithPassphrase(masterKeyBytes, passphrase) {
  if (!(masterKeyBytes instanceof Uint8Array) || masterKeyBytes.length !== 32) {
    throw new Error("masterKeyBytes must be a 32-byte Uint8Array");
  }
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const wrapKey = await deriveKeyFromPassphrase(passphrase, salt);
  const ct = await getCrypto().subtle.encrypt(
    { name: "AES-GCM", iv },
    wrapKey,
    masterKeyBytes
  );
  return {
    passphrase_wrap: bytesToBase64(new Uint8Array(ct)),
    passphrase_salt: bytesToBase64(salt),
    passphrase_iv: bytesToBase64(iv),
    passphrase_iters: PBKDF2_ITERS,
  };
}

/**
 * Wrap the master key under the server-held RSA-OAEP recovery key.
 * Returns the base64-encoded ciphertext.
 */
export async function wrapMasterWithRecovery(masterKeyBytes, recoveryPublicKeySpkiBase64) {
  const pub = await importRecoveryPublicKey(recoveryPublicKeySpkiBase64);
  const ct = await getCrypto().subtle.encrypt(
    { name: "RSA-OAEP" },
    pub,
    masterKeyBytes
  );
  return bytesToBase64(new Uint8Array(ct));
}

/**
 * Unwrap the master key with the user's passphrase. Returns a 32-byte
 * Uint8Array on success; throws on a wrong passphrase or tampered wrap
 * (AES-GCM's auth tag fails to verify).
 */
export async function unwrapMasterWithPassphrase({ passphrase, passphrase_wrap, passphrase_salt, passphrase_iv, passphrase_iters }) {
  const wrapKey = await deriveKeyFromPassphrase(
    passphrase,
    base64ToBytes(passphrase_salt),
    passphrase_iters || PBKDF2_ITERS
  );
  let plain;
  try {
    plain = await getCrypto().subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(passphrase_iv) },
      wrapKey,
      base64ToBytes(passphrase_wrap)
    );
  } catch (_err) {
    // WebCrypto throws OperationError on auth-tag mismatch. Surface a
    // clean exception so the caller can render "wrong passphrase".
    const e = new Error("Invalid passphrase");
    e.code = "bad_passphrase";
    throw e;
  }
  const out = new Uint8Array(plain);
  if (out.length !== 32) {
    throw new Error("Unexpected master key length");
  }
  return out;
}

/**
 * Encrypt a UTF-8 plaintext into a base64 ciphertext bundle suitable
 * for storing in notes.content. Bundle: version || iv || ciphertext.
 */
export async function encryptNote(plaintext, masterKeyBytes) {
  if (typeof plaintext !== "string") throw new Error("plaintext must be a string");
  const aesKey = await importAesKey(masterKeyBytes);
  const iv = randomBytes(IV_BYTES);
  const ct = await getCrypto().subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    textEncoder.encode(plaintext)
  );
  const bundle = concatBytes(
    new Uint8Array([NOTE_FORMAT_VERSION]),
    iv,
    new Uint8Array(ct)
  );
  return bytesToBase64(bundle);
}

/**
 * Decrypt a note bundle. Throws on tamper / wrong key.
 */
export async function decryptNote(bundleBase64, masterKeyBytes) {
  const bundle = base64ToBytes(bundleBase64);
  if (bundle.length < 1 + IV_BYTES + 16) {
    throw new Error("Ciphertext too short");
  }
  const version = bundle[0];
  if (version !== NOTE_FORMAT_VERSION) {
    throw new Error(`Unsupported note format version: ${version}`);
  }
  const iv = bundle.slice(1, 1 + IV_BYTES);
  const ct = bundle.slice(1 + IV_BYTES);
  const aesKey = await importAesKey(masterKeyBytes);
  let plain;
  try {
    plain = await getCrypto().subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ct);
  } catch (_err) {
    const e = new Error("Failed to decrypt note");
    e.code = "decrypt_failed";
    throw e;
  }
  return textDecoder.decode(plain);
}

// Exposed for tests only.
export const _internals = {
  PBKDF2_ITERS,
  IV_BYTES,
  NOTE_FORMAT_VERSION,
  bytesToBase64,
  base64ToBytes,
};
