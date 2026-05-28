import { S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

/* ── R2 client ───────────────────────────────────────────────────────
   Two credential paths, prefer-long-lived:

   1. **Long-lived R2 access keys** — set R2_ACCOUNT_ID +
      R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY in Vercel and the client
      uses them directly. This is the recommended setup; keys minted
      from Cloudflare's dashboard (R2 → Manage R2 API Tokens) don't
      expire and are independent of the CF API token used for other
      account ops.

   2. **CF temp-access-credentials fallback** — if the long-lived
      env vars are missing, the helper mints temporary S3 credentials
      from Cloudflare's `/r2/temp-access-credentials` endpoint using
      our regular CF API token (CLOUDFLARE_API_TOKEN +
      CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_TOKEN_ID). Temp creds last
      up to 7 days; we cache them in module scope and refresh ~1h
      before expiry. Tradeoff: a CF token rotation breaks uploads
      until the next deploy. Acceptable for "uploads always work
      out of the box" but the long-lived path is cleaner.

   Starting with @aws-sdk/client-s3 v3.729 the SDK injects a default
   request-checksum middleware that bakes
   `x-amz-sdk-checksum-algorithm` + `x-amz-checksum-crc32` into the
   signed URL. A browser fetch() doing a direct PUT to the signed URL
   doesn't send those headers, so R2 rejects the signature mismatch —
   the request manifests as a CORS preflight failure and fetch()
   throws a generic TypeError. Setting both calculation modes to
   WHEN_REQUIRED restores the pre-v3.729 behavior (no unnecessary
   checksum headers), which is what R2 / presigned browser uploads
   need. */

export const BUCKET = process.env.R2_BUCKET_NAME || "cardigan-documents";

// Mode-1 detection — set R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY +
// R2_ACCOUNT_ID and the client uses them directly. Otherwise mode-2.
//
// Disabled on the live environment because the long-lived keys baked
// into the deployment env file (VERCEL_ENCRYPTED_ENV_CONTENT) became
// invalid — R2 rejects every signed URL with AccessDenied even on
// freshly-signed-this-second requests. Symptom: user avatars +
// document previews silently fail to load. Verified by:
//   • R2 object exists on R2 (HEAD via CF API: 200, 26997 bytes)
//   • cardigan.mx/api/document-url mints a URL (200)
//   • that URL → R2 returns <Error><Code>AccessDenied</Code></Error>
//   • SAME flow locally with mode-2 temp creds (fresh mint via the
//     working "Claude" token) returns 200 OK with the JPEG bytes
// Forcing mode-2 routes through fetchTempCreds → CF /r2/temp-access-
// credentials → S3Client signs with sessionToken (X-Amz-Security-
// Token included), which R2 accepts. Switch back to true here once
// the long-lived secret access key in Vercel's encrypted env is
// rotated to a valid value.
const HAS_LONG_LIVED_KEYS = false;

// Cache for mode-2 (temp creds). Module scope persists across warm
// invocations of the same Vercel function instance; cold starts pay
// the ~200ms re-fetch latency.
let tempCredsCache = null; // { accessKeyId, secretAccessKey, sessionToken, expiresAt }

const TEMP_CREDS_TTL_SECONDS = 604800; // 7 days, the API max
const TEMP_CREDS_REFRESH_MARGIN_MS = 60 * 60 * 1000; // refresh 1h early

async function fetchTempCreds() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const tokenId = process.env.CLOUDFLARE_TOKEN_ID;
  if (!account || !token || !tokenId) {
    throw new Error("R2 credentials not configured (set R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY + R2_ACCOUNT_ID, OR CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN + CLOUDFLARE_TOKEN_ID for temp-creds fallback)");
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/r2/temp-access-credentials`,
    {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket: BUCKET,
        parentAccessKeyId: tokenId,
        permission: "object-read-write",
        ttlSeconds: TEMP_CREDS_TTL_SECONDS,
      }),
    }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    throw new Error(`temp-access-credentials failed: ${JSON.stringify(json.errors || json)}`);
  }
  return {
    accessKeyId: json.result.accessKeyId,
    secretAccessKey: json.result.secretAccessKey,
    sessionToken: json.result.sessionToken,
    expiresAt: Date.now() + TEMP_CREDS_TTL_SECONDS * 1000,
  };
}

async function getCredentials() {
  if (HAS_LONG_LIVED_KEYS) {
    return {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    };
  }
  if (tempCredsCache
      && Date.now() < tempCredsCache.expiresAt - TEMP_CREDS_REFRESH_MARGIN_MS) {
    return tempCredsCache;
  }
  tempCredsCache = await fetchTempCreds();
  return tempCredsCache;
}

function getEndpointAccount() {
  return process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
}

/* Get an R2 client. Async because mode-2 may need to mint temp creds.
   Each call returns a fresh S3Client bound to current creds — cheap
   to construct, ensures expired temp creds aren't reused. */
export async function getR2() {
  const credentials = await getCredentials();
  // Diagnostic: surface which credential shape the SDK is signing
  // with so we can debug R2 AccessDenied responses without leaking
  // secrets. Logged once per cold start (the cache means hot starts
  // reuse the same shape).
  // Once per cold start, log which credential lane we're on so a
  // future R2 incident has a quick "is it temp-creds or long-lived"
  // signal in the runtime logs. No identifiers in the log.
  if (!_loggedCredsShape) {
    _loggedCredsShape = true;
    console.log(JSON.stringify({
      evt: "r2.creds.mode",
      mode: HAS_LONG_LIVED_KEYS ? "long-lived" : "temp-creds",
      hasSessionToken: !!credentials.sessionToken,
    }));
  }
  const endpoint = `https://${getEndpointAccount()}.r2.cloudflarestorage.com`;
  return new S3Client({
    region: "auto",
    endpoint,
    credentials,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}
let _loggedCredsShape = false;

// Validate file path: must belong to user and contain no traversal.
//
// Two accepted prefixes:
//   • `<userId>/...`                      — documents, avatars, receipts
//   • `notes/<userId>/<noteId>/<uuid>`    — Phase 5 note attachments,
//     namespaced under `notes/` so the cleanup audit can find them
//     in O(1) bucket listings without enumerating every user folder
//
// Path traversal (`..`) and empty segments (`//`) are rejected in
// both shapes — same defence-in-depth as before.
export function validatePath(path, userId) {
  if (!path || typeof path !== "string" || path.length > 512) return false;
  if (path.includes("..") || path.includes("//")) return false;
  if (path.startsWith(`${userId}/`)) return true;
  if (path.startsWith(`notes/${userId}/`)) return true;
  return false;
}

// Verify Supabase JWT and extract user_id
export async function getAuthUser(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}
