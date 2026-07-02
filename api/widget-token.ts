/* ── /api/widget-token ────────────────────────────────────────────────
   Token management for the iOS widget data feed (/api/widget-data).
   Same model as calendar-token.ts: the WidgetKit extension can't carry
   a Supabase JWT, so an opaque long-lived token is the credential. The
   DB stores only its SHA-256 hash + an 8-char prefix; the plaintext
   goes out ONCE in the POST response and lives in the device's App
   Group container from then on.

     GET    → { hasToken, tokenPrefix, createdAt, lastAccessedAt }
     POST   → creates or rotates. Returns { token, tokenPrefix, ... }.
              Rotation invalidates the token on every other device, by
              design (each device re-mints lazily on next app open).
     DELETE → revokes (deletes the row). Returns { ok: true }.

   All three require a valid user JWT. */

import crypto from "node:crypto";
import { getAuthUser } from "./_r2.js";
import { getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

function generateToken() {
  // 32 bytes of CSPRNG entropy → 43-character base64url string.
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token: string) {
  // SHA-256 hex — same at-rest scheme as user_calendar_tokens
  // (migration 026); widget tokens are hash-only from day one
  // (migration 085).
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function handler(req: Row, res: Row) {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const svc = getServiceClient();

  if (req.method === "GET") {
    const { data, error } = await svc
      .from("user_widget_tokens")
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
    // Upsert on (user_id) — rotation is in-place.
    const { error } = await svc
      .from("user_widget_tokens")
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
    if (error) return res.status(500).json({ error: "Failed to create token" });
    // Plaintext goes out ONCE — the native shell must hand it to
    // WidgetBridge.setToken immediately; it's never retrievable again.
    return res.status(200).json({
      hasToken: true,
      token,
      tokenPrefix,
      createdAt: new Date().toISOString(),
      lastAccessedAt: null,
    });
  }

  if (req.method === "DELETE") {
    const { error } = await svc
      .from("user_widget_tokens")
      .delete()
      .eq("user_id", user.id);
    if (error) return res.status(500).json({ error: "Failed to revoke" });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

export default withSentry(handler, { name: "widget-token" });
