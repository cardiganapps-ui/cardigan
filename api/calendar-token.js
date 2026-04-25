/* ── /api/calendar-token ──────────────────────────────────────────────
   Token management for the user's iCalendar feed (api/calendar/[token]).

     GET    → returns { token: "...", url: "https://...", lastAccessedAt }
              or { token: null } if no active token.
     POST   → creates or rotates the user's token. Returns the new value.
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

function feedUrl(req, token) {
  // Build an absolute URL the user can paste into Google Calendar /
  // iCloud / Outlook. Prefer the canonical custom domain when we can
  // detect it; fall back to the request host otherwise.
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
      .select("token, last_accessed_at, created_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: "Lookup failed" });
    if (!data) return res.status(200).json({ token: null });
    return res.status(200).json({
      token: data.token,
      url: feedUrl(req, data.token),
      createdAt: data.created_at,
      lastAccessedAt: data.last_accessed_at,
    });
  }

  if (req.method === "POST") {
    const token = generateToken();
    // Upsert on (user_id) — rotation is in-place. Use the unique
    // user_id constraint as the conflict key. ignoreDuplicates=false
    // so the update path runs and the row's token + created_at refresh.
    const { error } = await svc
      .from("user_calendar_tokens")
      .upsert(
        {
          user_id: user.id,
          token,
          created_at: new Date().toISOString(),
          last_accessed_at: null,
        },
        { onConflict: "user_id", ignoreDuplicates: false }
      );
    if (error) return res.status(500).json({ error: error.message || "Failed to create token" });
    return res.status(200).json({
      token,
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
