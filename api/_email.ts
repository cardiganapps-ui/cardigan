/* ── Resend transactional email helper ──
   Used by app-level notifications that don't go through Supabase Auth
   (those go via Supabase's SMTP integration). Currently:
     - export-user-data success notice (audit trail; the user gets
       emailed every time someone successfully exports their data
       via /api/export-user-data, even if it's themselves).
     - patient-cancel-session / patient-reschedule-session — both
       parties (patient + therapist) get a confirmation.
     - _lifecycle — engagement campaign sends (trial reminders,
       win-back, referral nudges, ratings).

   Resend sends from `Cardigan <no-reply@cardigan.mx>`. RESEND_API_KEY
   must be set in the Vercel env. If it isn't, every send returns
   { ok: false } silently — which is how an entire feature can ship
   to prod looking healthy while no email ever leaves the building.
   To prevent that class of bug, we ALERT to Sentry (once per cold
   boot, deduped via a module-level flag) when the key is missing.
   The serverless function is short-lived enough that "once per cold
   boot" is roughly "once per inbound request that needs email" —
   loud enough to surface in Sentry without spamming.

   Returns { ok: boolean, error?: string }. Never throws — calling
   sites are best-effort by design (a failed audit email shouldn't
   block the user's actual operation). */

import * as Sentry from "@sentry/node";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const FROM = "Cardigan <no-reply@cardigan.mx>";

// Dedupe the missing-key alert per cold boot so we don't spam Sentry
// when the feature is bursty (e.g. lifecycle cron loops).
let _missingKeyReported = false;

export async function sendTransactionalEmail({ to, subject, html, text }: Row): Promise<Row> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (!_missingKeyReported) {
      _missingKeyReported = true;
      try {
        Sentry.captureMessage("RESEND_API_KEY missing — transactional email silently disabled", {
          level: "error",
          tags: { component: "email", reason: "missing_api_key" },
        });
        await Sentry.flush(1000).catch(() => {});
      } catch { /* never let Sentry's own failure mask the original */ }
    }
    return { ok: false, error: "RESEND_API_KEY not set" };
  }
  if (!to || !subject) return { ok: false, error: "missing to / subject" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject,
        html: html || `<p>${text || ""}</p>`,
        text: text || (html ? html.replace(/<[^>]+>/g, "") : ""),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // Surface real Resend failures (invalid key, unverified domain,
      // rate limit) too — they're symptomatic of broken infrastructure
      // the operator needs to fix.
      try {
        Sentry.captureMessage(`Resend send failed: ${res.status}`, {
          level: "warning",
          tags: { component: "email", status: String(res.status) },
          extra: { detail: detail.slice(0, 500), to: to.slice(0, 80) },
        });
      } catch { /* swallow */ }
      return { ok: false, error: `Resend ${res.status}: ${detail.slice(0, 200)}` };
    }
    // Resend returns `{ id: "<uuid>" }` on success — surface it so
    // callers can stamp it into their audit row for support follow-up.
    const body: Row = await res.json().catch(() => ({}));
    return { ok: true, id: body?.id || null };
  } catch (err: Row) {
    return { ok: false, error: err?.message || "fetch failed" };
  }
}
