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
// Hard floor for an accepted stored iteration count. New wraps always use
// PBKDF2_ITERS; this only bounds what we'll honour on read so a tampered /
// downgraded `passphrase_iters` can never be used. Mirrored server-side by
// the user_encryption_keys CHECK constraint (migration 084).
const MIN_PBKDF2_ITERS = 100_000;
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

function bytesToBase64(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

// ── Random material ──────────────────────────────────────────────────
export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  getCrypto().getRandomValues(out);
  return out;
}

export function generateMasterKeyBytes() {
  return randomBytes(32); // AES-256
}

// ── Passphrase derivation ────────────────────────────────────────────
async function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array<ArrayBuffer>, iters: number = PBKDF2_ITERS): Promise<CryptoKey> {
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
async function importAesKey(rawBytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return getCrypto().subtle.importKey(
    "raw",
    rawBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ── Recovery (RSA-OAEP) ──────────────────────────────────────────────
async function importRecoveryPublicKey(spkiBase64: string): Promise<CryptoKey> {
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
export async function wrapMasterWithPassphrase(masterKeyBytes: Uint8Array<ArrayBuffer>, passphrase: string) {
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
export async function wrapMasterWithRecovery(masterKeyBytes: Uint8Array<ArrayBuffer>, recoveryPublicKeySpkiBase64: string): Promise<string> {
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
export async function unwrapMasterWithPassphrase({ passphrase, passphrase_wrap, passphrase_salt, passphrase_iv, passphrase_iters }: { passphrase: string; passphrase_wrap: string; passphrase_salt: string; passphrase_iv: string; passphrase_iters?: number }): Promise<Uint8Array<ArrayBuffer>> {
  // Fail closed on a sub-floor iteration count rather than derive a key with
  // weak parameters (defense-in-depth against a tampered stored value).
  if (passphrase_iters != null && passphrase_iters < MIN_PBKDF2_ITERS) {
    throw new Error("Parámetros de cifrado inválidos.");
  }
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
    const e: Error & { code?: string } = new Error("Invalid passphrase");
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
export async function encryptNote(plaintext: string, masterKeyBytes: Uint8Array<ArrayBuffer>): Promise<string> {
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
export async function decryptNote(bundleBase64: string, masterKeyBytes: Uint8Array<ArrayBuffer>): Promise<string> {
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
    const e: Error & { code?: string } = new Error("Failed to decrypt note");
    e.code = "decrypt_failed";
    throw e;
  }
  return textDecoder.decode(plain);
}

// ── Attachment byte helpers (Phase 5) ──
// Same AES-GCM master key as the text notes — different envelope
// shape. Image bundles can be tens of MB so we don't prefix a
// version byte or embed the IV in the ciphertext; the row carries
// both `encrypted=true` and an `iv` column.
//
// Returns the ciphertext as raw Uint8Array and the IV as base64.
// Raw bytes for ciphertext is the right currency: it ships
// straight to R2 via PUT, and the read path decrypts from raw
// bytes too. A previous iteration returned base64 ciphertext
// here, which forced upload + download paths to round-trip
// 10MB+ payloads through atob/btoa on the main thread — multiple
// hundreds of ms on mid-range phones.
export async function encryptBytes(bytes: Uint8Array<ArrayBuffer>, masterKeyBytes: Uint8Array<ArrayBuffer>): Promise<{ ciphertext: Uint8Array<ArrayBuffer>; iv: string }> {
  if (!(bytes instanceof Uint8Array)) throw new Error("bytes must be a Uint8Array");
  const aesKey = await importAesKey(masterKeyBytes);
  const iv = randomBytes(IV_BYTES);
  const ct = await getCrypto().subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    bytes
  );
  return {
    ciphertext: new Uint8Array(ct),
    iv: bytesToBase64(iv),
  };
}

/**
 * Decrypt an attachment bundle back into raw bytes.
 * Accepts ciphertext as Uint8Array (matches what encryptBytes
 * returned) and IV as base64 (matches what the row column holds).
 * Throws on tamper / wrong key.
 */
export async function decryptBytes(ciphertextBytes: Uint8Array<ArrayBuffer>, ivBase64: string, masterKeyBytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (!(ciphertextBytes instanceof Uint8Array)) throw new Error("ciphertextBytes must be a Uint8Array");
  const iv = base64ToBytes(ivBase64);
  if (iv.length !== IV_BYTES) throw new Error("Bad IV length");
  const aesKey = await importAesKey(masterKeyBytes);
  let plain;
  try {
    plain = await getCrypto().subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ciphertextBytes);
  } catch (_err) {
    const e: Error & { code?: string } = new Error("Failed to decrypt attachment");
    e.code = "decrypt_failed";
    throw e;
  }
  return new Uint8Array(plain);
}

// ── Tag label helpers (Phase 1.3) ──
// Tags use the existing encrypt/decrypt envelope for the label
// ciphertext (when crypto is enabled). The hash helper here is the
// only new primitive — a SHA-256 of the canonical form, used by the
// (user_id, label_hash) unique constraint to dedup case + diacritic
// variations server-side without anyone seeing the plaintext.
//
// canonicalize: lowercase + strip diacritics + collapse whitespace.
// Matches utils/noteSearch.js::normalize so users can't end up with
// both "SOAP" and "soap" as separate tags by inadvertent case.
export function canonicalizeTagLabel(label?: string | null): string {
  return String(label || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

// Hex-encoded SHA-256 over the canonical form. Not HMAC-keyed: the
// threat model already assumes DB-only compromise can't decrypt note
// content, and the marginal exposure of common tag names like "SOAP"
// is bounded. Per-user uniqueness comes from the column constraint.
export async function hashTagLabel(label?: string | null): Promise<string> {
  const canonical = canonicalizeTagLabel(label);
  if (!canonical) return "";
  const buf = textEncoder.encode(canonical);
  const digest = await getCrypto().subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// Exposed for tests only.
export const _internals = {
  PBKDF2_ITERS,
  IV_BYTES,
  NOTE_FORMAT_VERSION,
  bytesToBase64,
  base64ToBytes,
};
