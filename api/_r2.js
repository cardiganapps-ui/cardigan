import { S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
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
