import * as Sentry from "@sentry/react";

const PII_FIELDS = new Set([
  "patient",
  "patient_name",
  "patientName",
  "note",
  "notes",
  "content",
  "initials",
  "email",
  "phone",
]);

function scrubPII(obj) {
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

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || !import.meta.env.PROD) return;
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
}

// Tags every subsequent Sentry event with the active profession + demo
// flag. Call from AppShell after the profile resolves so issues that
// only affect (say) nutritionist users are filterable in the Sentry UI.
// Profession is non-PII — it's the same enum we'd put in a feature flag.
export function setSentryProfession(profession, { demo = false } = {}) {
  try {
    Sentry.setTag("profession", profession || "unknown");
    Sentry.setTag("demo", demo ? "1" : "0");
  } catch {
    // Sentry not initialised (no DSN, dev mode) — no-op.
  }
}

export { Sentry };
