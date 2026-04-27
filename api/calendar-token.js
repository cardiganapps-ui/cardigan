/* ── /api/calendar-token ──────────────────────────────────────────────
   Token management for the user's iCalendar feed (api/calendar/[token]).

     GET    → returns { hasToken, tokenPrefix, createdAt, lastAccessedAt }.
              The full URL is NOT returned because the plaintext token
              isn't stored in the DB (only its SHA-256 hash). To get a
              shareable URL the user must rotate.
     POST   → creates or rotates the user's token. The plaintext is
              returned in the response ONCE — this is the only chance
              the client has to display / copy the URL. The DB stores
              only the hash + an 8-char prefix for UI recognition.
              Existing subscriptions break on rotation, by design.
     DELETE → revokes (deletes the row). Returns { ok: true }.

   All three require a valid user JWT. */

import crypto from "node:crypto";
import { getAuthUser } from "./_r2.js";
import { getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";

function generateToken() {
  // 32 bytes of CSPRNG entropy → 43-character base64url string.
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  // SHA-256 hex — matches `encode(digest(token, 'sha256'), 'hex')`
  // in supabase/migrations/026 so existing rows backfilled by the
  // migration look up correctly.
  return crypto.createHash("sha256").update(token).digest("hex");
}

function feedUrl(req, token) {
  const host = process.env.CALENDAR_HOST
    || (req.headers["x-forwarded-host"] || req.headers.host || "cardigan.mx");
  return `https://${host}/api/calendar/${token}`;
}

async function handler(req, res) {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const svc = getServiceClient();

  if (req.method === "GET") {
    const { data, error } = await svc
      .from("user_calendar_tokens")
      .select("token_prefix, last_accessed_at, created_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: "Lookup failed" });
    if (!data) return res.status(200).json({ hasToken: false });
    return res.status(200).json({
      hasToken: true,
      tokenPrefix: data.token_prefix || null,
      createdAt: data.created_at,
      lastAccessedAt: data.last_accessed_at,
    });
  }

  if (req.method === "POST") {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const tokenPrefix = token.slice(0, 8);
    // Upsert on (user_id) — rotation is in-place. ignoreDuplicates=false
    // so the update path runs and the hash + created_at refresh.
    const { error } = await svc
      .from("user_calendar_tokens")
      .upsert(
        {
          user_id: user.id,
          token_hash: tokenHash,
          token_prefix: tokenPrefix,
          created_at: new Date().toISOString(),
          last_accessed_at: null,
        },
        { onConflict: "user_id", ignoreDuplicates: false }
      );
    if (error) return res.status(500).json({ error: error.message || "Failed to create token" });
    // Plaintext + URL go out ONCE — the client must surface them
    // immediately because they're never retrievable again.
    return res.status(200).json({
      hasToken: true,
      token,
      tokenPrefix,
      url: feedUrl(req, token),
      createdAt: new Date().toISOString(),
      lastAccessedAt: null,
    });
  }

  if (req.method === "DELETE") {
    const { error } = await svc
      .from("user_calendar_tokens")
      .delete()
      .eq("user_id", user.id);
    if (error) return res.status(500).json({ error: "Failed to revoke" });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

export default withSentry(handler, { name: "calendar-token" });
