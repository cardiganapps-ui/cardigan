/* ── audit-api-auth.mjs ──
   Walks every `api/*.js` route handler (excluding `_*.js` helpers and
   intentionally-unauth endpoints) and verifies that getServiceClient
   is never called before an auth gate in the same handler.

   Why: the service-role client bypasses RLS. If a handler calls it
   before checking who the caller is — or doesn't check at all — the
   route effectively grants any anonymous request full read/write to
   the database, scoped only by what query the handler happens to make.
   Past incident: see CLAUDE.md "RLS / cross-tenant leak" section.

   Allowlist below documents the routes that legitimately don't need a
   JWT: webhooks (verified by HMAC signature inside the handler), the
   public health check, and unauthenticated push token swap (auth via
   single-use rotation token). Add to the allowlist deliberately, with
   a justification comment — never to silence the audit.

   Usage:
     npm run audit:api
   Exits non-zero on any violation; prints a per-file diagnostic. */

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "api");

/* Endpoints where a JWT-based auth check is intentionally absent.
   Each entry must justify itself in code comments above the endpoint's
   handler. Don't add to this list to make a lint pass — fix the code. */
const ALLOWED_NO_AUTH = new Set([
  "health.js",                  // public health probe; no DB writes
  "whatsapp-webhook.js",        // Meta delivery callback; HMAC verified
  "resend-webhook.js",          // Resend delivery callback; HMAC verified
  "push-resubscribe.js",        // browser SW can't carry JWT; (oldEndpoint, resubToken) pair
  "push-test.js",               // dev-only diagnostic; not deployed in prod (verify before shipping)
  "calendar/[token].js",        // token IS the credential; no JWT possible from cal clients
  "stripe-webhook.js",          // Stripe delivery callback; HMAC verified via STRIPE_WEBHOOK_SECRET
]);

const AUTH_PATTERNS = [
  /\bawait\s+getAuthUser\s*\(/,
  /\bawait\s+requireAdmin\s*\(/,
  /\bverifyCronSecret\s*\(/,
];
const SERVICE_PATTERN = /\bgetServiceClient\s*\(/;

function findFirstMatch(text, regex) {
  const m = regex.exec(text);
  return m ? m.index : -1;
}

async function listRoutes(dir, prefix = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__") continue;
    const full = join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...await listRoutes(full, rel));
    } else if (entry.isFile() && entry.name.endsWith(".js") && !entry.name.startsWith("_")) {
      out.push({ rel, path: full });
    }
  }
  return out;
}

function findHandlerBody(text) {
  // Match `async function handler(req, res) {` and slice from there.
  // The closing brace match is approximate but good enough — we only
  // need everything from the handler open through end-of-file because
  // any service-client call after the handler closes is irrelevant.
  const m = /async\s+function\s+handler\s*\([^)]*\)\s*\{/.exec(text);
  if (!m) return null;
  return text.slice(m.index + m[0].length);
}

const issues = [];
const routes = await listRoutes(ROOT);
for (const r of routes) {
  const src = await readFile(r.path, "utf8");
  const body = findHandlerBody(src);
  if (!body) {
    issues.push(`  ${r.rel} — could not locate handler() function body`);
    continue;
  }
  const svcAt = findFirstMatch(body, SERVICE_PATTERN);
  if (svcAt < 0) continue; // doesn't use the service client; nothing to check

  if (ALLOWED_NO_AUTH.has(r.rel)) continue;

  const authAt = AUTH_PATTERNS
    .map(p => findFirstMatch(body, p))
    .filter(i => i >= 0)
    .reduce((a, b) => Math.min(a, b), Infinity);

  if (authAt === Infinity) {
    issues.push(`  ${r.rel} — uses getServiceClient() but NO auth gate in handler`);
  } else if (authAt > svcAt) {
    issues.push(`  ${r.rel} — getServiceClient() at offset ${svcAt} BEFORE auth gate at offset ${authAt}`);
  }
}

if (issues.length) {
  console.error("\nAPI auth-order audit FAILED:\n");
  for (const i of issues) console.error(i);
  console.error("\nA service-role DB client must NEVER be created before the");
  console.error("caller's identity is verified. Either add a getAuthUser /");
  console.error("requireAdmin / verifyCronSecret call before getServiceClient,");
  console.error("or — only if the endpoint is intentionally unauth and you've");
  console.error("documented why — add it to ALLOWED_NO_AUTH in this script.\n");
  process.exit(1);
}

console.log(`API auth-order audit OK (${routes.length} routes scanned).`);
