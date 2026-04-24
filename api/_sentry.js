/* ── Sentry wrapper for serverless handlers ──
   Every mutating /api/* route wraps its default export in withSentry so
   unhandled exceptions and 5xx responses land in the Sentry dashboard.
   Lazy-init: we skip entirely if SENTRY_DSN isn't set, which keeps
   preview/dev environments quiet without a config branch in every
   handler. */

import * as Sentry from "@sentry/node";

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

function scrubPII(obj, depth = 0) {
  if (depth > 6 || obj == null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => scrubPII(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (PII_FIELDS.has(k)) { out[k] = "[redacted]"; continue; }
    out[k] = v && typeof v === "object" ? scrubPII(v, depth + 1) : v;
  }
  return out;
}

let initialized = false;
function ensureInit() {
  if (initialized) return;
  initialized = true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "production",
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.extra) event.extra = scrubPII(event.extra);
      if (event.request?.data) event.request.data = scrubPII(event.request.data);
      return event;
    },
  });
}

// Treat these as expected traffic, not errors — they're auth/validation
// failures that a probing client will generate at volume.
const EXPECTED_STATUSES = new Set([400, 401, 403, 404, 405, 409, 413, 429]);

export function withSentry(handler, { name } = {}) {
  return async function wrapped(req, res) {
    ensureInit();
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) return handler(req, res);

    try {
      await handler(req, res);
      if (res.statusCode >= 500) {
        Sentry.captureMessage(
          `${name || req.url || "handler"} responded ${res.statusCode}`,
          { level: "error" }
        );
        await Sentry.flush(1000).catch(() => {});
      } else if (EXPECTED_STATUSES.has(res.statusCode)) {
        // Expected rejection — no report.
      }
    } catch (err) {
      Sentry.captureException(err, {
        tags: { route: name || req.url || "unknown" },
      });
      await Sentry.flush(1000).catch(() => {});
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal error" });
      }
      throw err;
    }
  };
}
