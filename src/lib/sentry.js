/* @sentry/react is dynamically imported by initSentry() — kept off
   the static graph so the SDK's ~6.6 KB gzipped chunk doesn't fetch
   on the cold-start critical path. captureException + setSentryTag
   buffer events when called before init, then flush as soon as the
   SDK finishes loading. */
let sentryInstance = null;
const pendingEvents = [];
const pendingTags = [];

/* PII / secret fields scrubbed from every Sentry event, breadcrumb,
   and context. Add new sensitive fields here whenever the schema or
   API surface grows — there's a unit test (src/utils/__tests__/
   sentryScrub.test.js) that asserts every field listed below redacts
   correctly, so a regression is loud.

   Categories:
   - Patient / clinical data: anything that names a person or describes
     their health, medication, or sessions.
   - Auth / session secrets: tokens, OTP codes, MFA secrets, passwords.
   - Document / storage paths: leak the user_id structure of R2 keys.
   - Calendar feed credentials: token + URL are equivalent. */
const PII_FIELDS = new Set([
  // Patient + clinical
  "patient",
  "patient_name",
  "patientName",
  "parent",
  "note",
  "notes",
  "content",
  "initials",
  "email",
  "phone",
  "allergies",
  "medical_conditions",
  "medicalConditions",
  "height_cm",
  "goal_weight_kg",
  "birthdate",
  // Auth / session secrets
  "password",
  "access_token",
  "refresh_token",
  "secret",
  "totpSecret",
  "totp_secret",
  "code",         // 6-digit MFA codes
  "otp",
  "passphrase",
  // Storage / file paths (leak user_id structure)
  "file_path",
  "filePath",
  "path",
  "filename",
  // Calendar feed credentials
  "token",
  "tokenPrefix",
  "calendar_token",
  "url",          // intentionally aggressive — covers the calendar URL
  // WhatsApp
  "recipient_phone",
  "whatsapp_phone",
  "meta_message_id",
]);

// Exported for the unit test in src/utils/__tests__/sentryScrub.test.js;
// not intended for direct use elsewhere — call sites should always go
// through Sentry's beforeSend wired up by initSentry.
export { PII_FIELDS };
export function scrubPII(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(scrubPII);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (PII_FIELDS.has(k)) { out[k] = "[redacted]"; continue; }
    if (v && typeof v === "object") { out[k] = scrubPII(v); continue; }
    out[k] = v;
  }
  return out;
}

export async function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || !import.meta.env.PROD) return;
  // Dynamic import keeps @sentry/react off the eager chunk graph.
  // The SDK chunk fetches in parallel with whatever the user is
  // doing — typical first-paint critical path doesn't wait on it.
  const Sentry = await import("@sentry/react");
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend(event) {
      if (event.extra) event.extra = scrubPII(event.extra);
      if (event.contexts) event.contexts = scrubPII(event.contexts);
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => ({
          ...b,
          data: scrubPII(b.data),
        }));
      }
      return event;
    },
  });
  sentryInstance = Sentry;
  // Flush anything captured before the SDK was ready. Empty in the
  // common case (no errors during the first ~100ms), but if the app
  // crashed during boot we still get the report.
  for (const ev of pendingEvents) Sentry.captureException(ev.error, ev.context);
  pendingEvents.length = 0;
  for (const tag of pendingTags) Sentry.setTag(tag.key, tag.value);
  pendingTags.length = 0;
}

/* captureException — drop-in for Sentry.captureException, safe to
   call before initSentry resolves. Buffered events flush during
   initSentry; if init never runs (no DSN, dev mode) the buffer just
   stays in memory and gets garbage-collected on reload. */
export function captureException(error, context) {
  if (sentryInstance) {
    sentryInstance.captureException(error, context);
  } else {
    pendingEvents.push({ error, context });
  }
}

// Tags every subsequent Sentry event with the active profession + demo
// flag. Call from AppShell after the profile resolves so issues that
// only affect (say) nutritionist users are filterable in the Sentry UI.
// Profession is non-PII — it's the same enum we'd put in a feature flag.
export function setSentryProfession(profession, { demo = false } = {}) {
  const tags = [
    { key: "profession", value: profession || "unknown" },
    { key: "demo", value: demo ? "1" : "0" },
  ];
  if (sentryInstance) {
    for (const t of tags) sentryInstance.setTag(t.key, t.value);
  } else {
    pendingTags.push(...tags);
  }
}
