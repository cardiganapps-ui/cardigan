/* ── GET /api/widget-data ─────────────────────────────────────────────
   Compact JSON snapshot for the iOS WidgetKit extension. The opaque
   widget token IS the credential (see api/widget-token.ts) — the
   extension can't carry a Supabase JWT. Token travels ONLY in the
   Authorization header (never the URL, so it can't land in access
   logs or referrers).

   The body is built by the SAME pure builder the native app uses to
   write its App Group snapshot (src/utils/widgetSnapshot.ts), so a
   widget refreshed from the network and one refreshed by opening the
   app can never disagree.

   Column selection is deliberately minimal — no notes, phones,
   emails, birthdates or document paths, same defense-in-depth stance
   as api/_cardiTools.ts. */

import crypto from "node:crypto";
import { getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";
import { rateLimit } from "./_ratelimit.js";
import { buildWidgetSnapshot } from "../src/utils/widgetSnapshot.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

function hashToken(token: string) {
  // SHA-256 hex — matches the create-side hash in api/widget-token.ts.
  return crypto.createHash("sha256").update(token).digest("hex");
}

function bearerToken(req: Row): string | null {
  const auth = req.headers?.authorization || req.headers?.Authorization;
  if (typeof auth === "string" && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, "").trim();
  }
  // Secondary header for clients where setting Authorization is
  // awkward. Still never the URL.
  const alt = req.headers?.["x-widget-token"];
  return typeof alt === "string" && alt ? alt.trim() : null;
}

async function handler(req: Row, res: Row) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = bearerToken(req);
  // Same cheap malformed-input guard as api/calendar/[token].ts —
  // we only ever issue ~43-char base64url tokens.
  if (!token || token.length < 16 || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const svc = getServiceClient();
  const tokenHash = hashToken(token);

  const { data: row, error } = await svc
    .from("user_widget_tokens")
    .select("user_id")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) return res.status(500).json({ error: "Lookup failed" });
  // 404 (not 401) for an unknown token: the extension treats it as
  // "token revoked/rotated elsewhere" and clears its copy.
  if (!row) return res.status(404).json({ error: "Not found" });

  // WidgetKit refreshes ≤ ~40-70 timelines/day; 30/h per token is
  // generous headroom while capping a leaked token's read rate.
  const rl = await rateLimit({ endpoint: "widget-data", bucket: tokenHash, max: 30, windowSec: 3600 });
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfter));
    return res.status(429).json({ error: "Too many requests" });
  }

  // Sessions need the full history (the balance predicate walks every
  // row, same as the in-app derivation); patients/payments are small.
  const [sessionsRes, patientsRes, paymentsRes, prefsRes] = await Promise.all([
    svc
      .from("sessions")
      .select("id, patient_id, patient, initials, time, date, status, rate, created_at, modality, group_id, groups(name)")
      .eq("user_id", row.user_id)
      .limit(20000),
    svc
      .from("patients")
      .select("id, status, rate, paid, opening_balance")
      .eq("user_id", row.user_id),
    svc
      .from("payments")
      .select("amount, date, created_at")
      .eq("user_id", row.user_id),
    svc
      .from("notification_preferences")
      .select("timezone")
      .eq("user_id", row.user_id)
      .maybeSingle(),
  ]);
  if (sessionsRes.error || patientsRes.error || paymentsRes.error) {
    return res.status(500).json({ error: "Failed to read data" });
  }

  const snapshot = buildWidgetSnapshot({
    sessions: sessionsRes.data || [],
    patients: patientsRes.data || [],
    payments: paymentsRes.data || [],
    tz: prefsRes?.data?.timezone || "America/Mexico_City",
  });

  // Best-effort touch — failure here doesn't hurt the response.
  svc
    .from("user_widget_tokens")
    .update({ last_accessed_at: new Date().toISOString() })
    .eq("token_hash", tokenHash)
    .then(() => {}, () => {});

  // PHI + money — never cacheable outside the device.
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json(snapshot);
}

export default withSentry(handler, { name: "widget-data" });
