/* ── GET /api/auth-config-check ───────────────────────────────────────
   Admin-only invariant probe for the captcha-enforcement kill switch.

   Background (see CLAUDE.md "Auth captcha"): the web AuthScreen mounts a
   Cloudflare Turnstile widget, but the Capacitor native webview CANNOT
   run Turnstile (`capacitor://localhost` is not an allowed Turnstile
   origin), so `TURNSTILE_ENABLED = !!SITE_KEY && !isNative()` disables
   it on native. If Supabase's server-side `security_captcha_enabled` is
   ever flipped ON (via the dashboard or a project restore), EVERY native
   sign-up / sign-in would 400 with a captcha error — the native shell
   sends no token. Nothing detects this drift today.

   This endpoint reads the live Supabase Auth config via the Management
   API and asserts `security_captcha_enabled === false`. When it has
   drifted true, the response is non-200 (409) with `captchaEnforced:
   true` so an external monitor (or the admin) catches it.

   Security posture: admin-gated (requireAdmin), mirroring the other
   /api/admin-* endpoints. It depends on SUPABASE_PAT, which is a
   high-privilege Management token — that must NEVER be reachable from an
   unauthenticated probe like /api/health, which is why this lives in its
   own admin-gated route rather than extending health.js.

   Response:
     200 { ok: true,  captchaEnforced: false, ... }  — invariant holds
     409 { ok: false, captchaEnforced: true,  ... }  — DRIFTED, fix it
     500 — missing SUPABASE_PAT / SUPABASE_URL, or Management API error */

import { requireAdmin } from "./_admin.js";
import { withSentry } from "./_sentry.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

// Extract the project ref from the Supabase URL hostname
// (`<ref>.supabase.co`). Returns null if the URL is missing/malformed.
function projectRef(url: Row) {
  if (typeof url !== "string" || !url) return null;
  try {
    const host = new URL(url).hostname; // <ref>.supabase.co
    const ref = host.split(".")[0];
    return ref && ref !== "supabase" ? ref : null;
  } catch {
    return null;
  }
}

async function handler(req: Row, res: Row) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return; // requireAdmin already wrote 401/403

  const pat = process.env.SUPABASE_PAT;
  const ref = projectRef(process.env.SUPABASE_URL);
  if (!pat || !pat.trim()) {
    return res.status(500).json({ error: "SUPABASE_PAT not configured" });
  }
  if (!ref) {
    return res.status(500).json({ error: "Could not derive project ref from SUPABASE_URL" });
  }

  let config: Row;
  try {
    const resp = await fetch(
      `https://api.supabase.com/v1/projects/${ref}/config/auth`,
      { headers: { Authorization: `Bearer ${pat.trim()}` } }
    );
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return res.status(502).json({
        error: "Management API request failed",
        status: resp.status,
        detail: detail.slice(0, 300),
      });
    }
    config = await resp.json();
  } catch (err: Row) {
    return res.status(502).json({ error: err?.message || "Management API unreachable" });
  }

  // The invariant: enforcement MUST stay off so native auth keeps
  // working. Coerce to a real boolean — a missing field reads as
  // "not enforced", which is the safe default.
  const captchaEnforced = config?.security_captcha_enabled === true;

  const payload: Row = {
    ok: !captchaEnforced,
    captchaEnforced,
    captchaProvider: config?.security_captcha_provider ?? null,
    ts: new Date().toISOString(),
  };

  // 409 on drift so a monitor pointed here (with an admin token) trips
  // a non-200, and the body explains the remediation.
  if (captchaEnforced) {
    payload.message =
      "security_captcha_enabled has drifted ON — native auth will 400. " +
      "Set it back to false in the Supabase dashboard or via the Management API.";
    return res.status(409).json(payload);
  }
  return res.status(200).json(payload);
}

export default withSentry(handler, { name: "auth-config-check" });
