/* ── Analytics (Vercel-backed) ────────────────────────────────────────
   Cardigan tracks a small set of named events at the moments that
   matter for trial → paid conversion analysis. Backed by Vercel
   Analytics' custom-event API — already wired into <Analytics /> in
   main.jsx, so events stream directly into the project's dashboard
   without a separate account or env var.

   Why Vercel over a dedicated product-analytics service:
     - Already shipping pageviews; custom events count toward the same
       (generous) Pro-tier quota, no extra billing surface.
     - Privacy-first by default — no cookies, no PII collection at the
       transport layer. We add a denylist on top so a careless
       `track("…", { patient: "…" })` can't slip through anyway.
     - Zero new bundle weight (the package is already in the graph).

   Trade-offs documented for future-proofing:
     - Vercel Analytics has no per-user identity model; identify() is a
       no-op for the dashboard but stores a session-scoped user_id +
       profession on the module so subsequent track() calls carry
       them as event properties. That gives us coarse user-cohort
       analysis via the Custom Events filter UI.
     - reset() clears that session state on sign-out.
     - Properties must be flat string|number|boolean|null — the Vercel
       SDK throws on nested objects. We flatten under the hood.

   Event taxonomy (kept short on purpose):
     - identify (sets context, doesn't fire an event)
     - trial_started
     - activation_step_completed
     - activation_complete
     - activation_share_opened
     - plan_sheet_opened
     - checkout_started
     - subscribe_success
     - checkout_cancelled
     - referral_share_initiated
     - referral_share              (channel: native|whatsapp|email|copy_link)
     - notification_prompt_shown   (variant: initial|post_patient)
     - calendar_prompt_shown
     - calendar_prompt_enabled
     - calendar_prompt_dismissed
     - calendar_prompt_subscribe   (channel: apple|google)
     - rating_sheet_shown          (prompt_kind)
     - rating_submitted            (prompt_kind, stars)
     - rating_dismissed            (prompt_kind, stars)
     - rating_promoter_referral_clicked
     - pdf_summary_downloaded */

import { track as vercelTrack } from "@vercel/analytics";

const PII_KEYS = new Set([
  "email", "phone", "patient", "patientName", "patient_name",
  "note", "notes", "content", "initials",
]);

/* Scrub + flatten — Vercel only accepts string|number|boolean|null at
   the top level. Nested objects are dropped (logged once in dev) so
   a property bag that grew an object accidentally fails fast and
   visibly rather than silently throwing inside the SDK. */
function scrubAndFlatten(props?: unknown): Record<string, string | number | boolean> {
  if (!props || typeof props !== "object") return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props)) {
    if (PII_KEYS.has(k)) continue;
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
    // Anything else (object, array, function) is silently dropped —
    // logging would risk leaking the data we're trying to scrub.
  }
  return out;
}

// Session-scoped identity. Vercel doesn't model user IDs at the
// dashboard level, but stamping them on every event gives us a
// filter dimension in the Custom Events view ("show events where
// user_id = X").
let userContext: Record<string, string | number | boolean> = {};

export function identify(userId?: string, properties?: Record<string, unknown>) {
  if (!userId) return;
  userContext = {
    user_id: userId,
    ...scrubAndFlatten(properties || {}),
  };
}

export function track(event?: string, properties?: Record<string, unknown>) {
  if (!event || typeof event !== "string") return;
  const merged = { ...userContext, ...scrubAndFlatten(properties || {}) };
  // vercelTrack is a no-op outside production by default (the
  // <Analytics /> component decides), so this is safe to call from
  // dev without polluting the dashboard.
  try {
    vercelTrack(event, Object.keys(merged).length > 0 ? merged : undefined);
  } catch {
    // Defensive — the SDK has thrown on malformed payloads in the
    // past. We never want analytics to take down a user-visible flow.
  }
}

export function reset() {
  userContext = {};
}
