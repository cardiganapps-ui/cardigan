/* ── PostHog analytics (zero-dep transport) ────────────────────────────
   Cardigan tracks a small set of named events at the moments that
   matter for trial → paid conversion analysis. Implemented as direct
   POSTs to PostHog's public capture endpoint instead of pulling the
   posthog-js SDK because:

     - Autocapture (clicks, page views) bloats the event volume with
       data we'd need to scrub for PII anyway. Named events only is
       both leaner and easier to audit.
     - The SDK is ~50KB gzipped; the wrapper here is ~3KB and ships
       only what we use.
     - Initialization is trivially gated by an env var — when
       VITE_POSTHOG_KEY is unset (local dev, Preview without it
       configured), the module no-ops entirely.

   The event taxonomy (kept short on purpose):
     - identify                 — on first sign-in, with profession +
                                  trial_active
     - trial_started            — on first sign-in for new accounts
     - activation_step_completed — once per (user, step), captured by
                                  ActivationChecklist
     - activation_complete      — when all 4 activation steps done
     - plan_sheet_opened        — Settings → Suscripción opened
     - checkout_started         — Stripe checkout session created
     - subscribe_success        — non-active → active transition
     - subscription_cancelled   — active → cancelled
     - referral_share_initiated — WhatsApp share button tapped
     - pdf_summary_downloaded   — monthly PDF generated

   All payloads are scrubbed against a denylist that mirrors Sentry's
   PII set so a careless `track("…", { patient: "…" })` can't leak. */

const ENDPOINT = "https://us.i.posthog.com/capture/";

const PII_KEYS = new Set([
  "email", "phone", "patient", "patientName", "patient_name",
  "note", "notes", "content", "initials",
]);

function scrub(props) {
  if (!props || typeof props !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    if (PII_KEYS.has(k)) continue;
    if (v == null) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      out[k] = scrub(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

let apiKey = null;
let distinctId = null;
let identified = false;
let queue = [];

function getKey() {
  if (apiKey != null) return apiKey;
  apiKey = import.meta.env.VITE_POSTHOG_KEY || "";
  return apiKey;
}

function postEvent(event, properties) {
  const key = getKey();
  if (!key) return;
  const id = distinctId || properties?.distinct_id || "anonymous";
  const body = {
    api_key: key,
    event,
    distinct_id: id,
    properties: {
      ...scrub(properties),
      $lib: "cardigan-direct",
      timestamp: new Date().toISOString(),
    },
  };
  // Best-effort, fire-and-forget. keepalive: true so a track() racing
  // with the user closing the tab still completes the post.
  try {
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => { /* swallow */ });
  } catch { /* swallow */ }
}

/* Mark the current user. Subsequent track() calls inherit the
   distinct_id. Idempotent — a second identify() call with the same
   userId is a no-op (we still update properties, but skip the
   distinct-id flip that would make PostHog think the user changed
   accounts). Properties are scrubbed before send. */
export function identify(userId, properties) {
  if (!userId) return;
  if (distinctId === userId && identified) {
    // Update properties only (no $identify event needed).
    postEvent("$set", { $set: scrub(properties || {}) });
    return;
  }
  distinctId = userId;
  identified = true;
  postEvent("$identify", {
    $set: scrub(properties || {}),
  });
  // Drain anything tracked before identify() — anonymous events get
  // their distinct_id rewritten to the now-known user id.
  for (const q of queue) {
    postEvent(q.event, { ...q.properties, distinct_id: userId });
  }
  queue = [];
}

export function track(event, properties) {
  if (!getKey()) return;
  if (!distinctId) {
    // Defer until identify() so the event lands under the right user.
    if (queue.length < 50) queue.push({ event, properties });
    return;
  }
  postEvent(event, properties);
}

export function reset() {
  distinctId = null;
  identified = false;
  queue = [];
}
