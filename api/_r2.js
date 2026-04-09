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

// Verify Supabase JWT and extract user_id
export async function getAuthUser(req) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const supabase = createClient(
    process.env.SUPABASE_URL || "https://axyuqfkmifcaupwhzfuw.supabase.co",
    process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4eXVxZmttaWZjYXVwd2h6ZnV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2MTMyODksImV4cCI6MjA5MTE4OTI4OX0.8T-_1k64HeNf8Xc4-2fODGG-2lZCPDE66pNXcsRe5YU"
  );
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}
