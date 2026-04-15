/* ── Shared helpers for admin-only API routes ──
   Every admin endpoint must:
   1) Verify the caller's JWT is valid (getAuthUser)
   2) Confirm that user's email matches ADMIN_EMAIL
   3) Use the service-role client for privileged operations

   The service-role key bypasses RLS and has access to auth.users admin
   APIs, so it MUST only be instantiated server-side. Never ship it to the
   browser. */

import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = "gaxioladiego@gmail.com";

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

export async function requireAdmin(req, res) {
  const user = await getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (user.email !== ADMIN_EMAIL) {
    // Intentionally generic message so this endpoint doesn't confirm to a
    // probing caller whether they passed the auth check.
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return user;
}

export function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Be specific about which var is missing so the admin knows what to
  // fix in Vercel. Also trim: a trailing newline in the pasted value
  // will pass the truthy check but break createClient downstream.
  const missing = [];
  if (!url || !url.trim()) missing.push("SUPABASE_URL");
  if (!key || !key.trim()) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) {
    throw new Error(`Missing env var(s): ${missing.join(", ")}`);
  }
  return createClient(url.trim(), key.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isValidUserId(id) {
  // UUID v4-ish validation to guard against malformed input that could
  // slip into SQL filters or admin API calls.
  return typeof id === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
