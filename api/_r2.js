import { S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

/* ── R2 client ───────────────────────────────────────────────────────
   Starting with @aws-sdk/client-s3 v3.729, the SDK injects a default
   request-checksum middleware that bakes `x-amz-sdk-checksum-algorithm`
   + `x-amz-checksum-crc32` into the signed URL. A browser fetch()
   doing a direct PUT to the signed URL doesn't send those headers,
   so R2 rejects the signature mismatch — the request manifests as a
   CORS preflight failure and fetch() throws a generic TypeError.
   Setting both calculation modes to WHEN_REQUIRED restores the
   pre-v3.729 behavior (no unnecessary checksum headers), which is
   what R2 / presigned browser uploads need. */
export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

export const BUCKET = process.env.R2_BUCKET_NAME || "cardigan-documents";

// Validate file path: must belong to user and contain no traversal
export function validatePath(path, userId) {
  if (!path || typeof path !== "string" || path.length > 512) return false;
  if (path.includes("..") || path.includes("//")) return false;
  return path.startsWith(`${userId}/`);
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
