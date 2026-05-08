#!/usr/bin/env node
/* ── setup-stripe-connect-webhook.mjs ─────────────────────────────────
   One-shot setup for the Stage 3 patient-portal payments. Configures
   Stripe's webhook endpoints so the existing /api/stripe-webhook
   handler receives every event it needs to process patient payments.

   What it does:

     1. Finds the existing PLATFORM webhook endpoint (the one set up
        when Cardigan first launched SaaS subscriptions). Adds
        `account.updated` to its enabled_events list so the webhook
        handler can refresh therapist_connect_accounts state when an
        Express account's onboarding progresses.

     2. Looks for an existing CONNECT-mode webhook endpoint. If absent,
        creates one pointing at the same /api/stripe-webhook URL with
        the patient-payment events:
          - payment_intent.succeeded
          - payment_intent.payment_failed
          - payment_intent.canceled

     3. Prints the new endpoint's signing secret. The user must add it
        to Vercel as STRIPE_CONNECT_WEBHOOK_SECRET (production +
        preview), then redeploy. The webhook handler verifies signatures
        against EITHER the platform OR Connect secret (see _stripe.js
        getConnectWebhookSecret).

   Usage:
     # Test mode (preview / development)
     node --env-file=.env.local scripts/setup-stripe-connect-webhook.mjs

     # Live mode — same script, just point STRIPE_SECRET_KEY at the live
     # key. Cardigan keeps test/live keys in separate Vercel envs
     # (Production = live, Preview/Development = test); pull the live key
     # locally to run this against prod:
     STRIPE_SECRET_KEY=sk_live_... node scripts/setup-stripe-connect-webhook.mjs

   The script is idempotent: re-running with the platform endpoint
   already updated and the Connect endpoint already created will just
   print "no changes" and skip the steps. */

const STRIPE_API = "https://api.stripe.com/v1";

// The URL Stripe should hit. Override via WEBHOOK_URL env var when
// targeting a preview deployment.
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://cardigan.mx/api/stripe-webhook";

// New event for the platform endpoint.
const PLATFORM_NEW_EVENTS = [
  "account.updated",
];

// Events for the new Connect endpoint.
const CONNECT_EVENTS = [
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
];

function requireKey() {
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k || !k.trim()) {
    console.error("STRIPE_SECRET_KEY not set. Run with --env-file=.env.local or export it.");
    process.exit(1);
  }
  return k.trim();
}

function encode(obj) {
  const params = new URLSearchParams();
  const append = (key, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => append(`${key}[${i}]`, v));
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) append(`${key}[${k}]`, v);
    } else {
      params.append(key, String(value));
    }
  };
  for (const [k, v] of Object.entries(obj)) append(k, v);
  return params.toString();
}

async function stripe(path, { method = "GET", body } = {}) {
  const headers = {
    Authorization: `Bearer ${requireKey()}`,
    "Stripe-Version": "2024-04-10",
  };
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers,
    body: body ? encode(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Stripe ${method} ${path} failed (${res.status}):`, json?.error?.message);
    process.exit(1);
  }
  return json;
}

async function listEndpoints() {
  // Stripe paginates webhook_endpoints; 100 per page is the hard cap.
  // Cardigan should never have more than a handful, so one page is
  // enough.
  const r = await stripe("/webhook_endpoints?limit=100");
  return r.data || [];
}

function isCardiganEndpoint(ep) {
  // Match by host so a custom path or trailing slash doesn't slip past.
  try {
    const u = new URL(ep.url);
    return u.host === new URL(WEBHOOK_URL).host && u.pathname === new URL(WEBHOOK_URL).pathname;
  } catch {
    return false;
  }
}

async function ensurePlatformEvents(endpoints) {
  const platformEps = endpoints.filter((e) => isCardiganEndpoint(e) && !e.application);
  // .application set means it's a platform-managed endpoint we don't
  // own. .connect_accounts indicates a Connect-mode endpoint — those
  // are handled separately below. The webhook_endpoints API uses a
  // different field shape across versions; we test both.
  const platformOnly = platformEps.filter((e) => {
    if (typeof e.connect === "boolean") return !e.connect;
    return !(e.api_version && e.connect_accounts);
  });

  if (platformOnly.length === 0) {
    console.warn(`⚠️  No PLATFORM webhook endpoint found at ${WEBHOOK_URL}.`);
    console.warn("   Create one in the Stripe dashboard first (the SaaS-side webhook).");
    return;
  }

  for (const ep of platformOnly) {
    const existing = new Set(ep.enabled_events || []);
    if (existing.has("*")) {
      console.log(`✓ platform endpoint ${ep.id} already wildcards events; nothing to add`);
      continue;
    }
    const toAdd = PLATFORM_NEW_EVENTS.filter((ev) => !existing.has(ev));
    if (toAdd.length === 0) {
      console.log(`✓ platform endpoint ${ep.id} already has account.updated`);
      continue;
    }
    const merged = Array.from(new Set([...(ep.enabled_events || []), ...toAdd]));
    await stripe(`/webhook_endpoints/${ep.id}`, {
      method: "POST",
      body: { enabled_events: merged },
    });
    console.log(`✓ updated platform endpoint ${ep.id}: added ${toAdd.join(", ")}`);
  }
}

async function ensureConnectEndpoint(endpoints) {
  const connectEps = endpoints.filter((e) => {
    if (!isCardiganEndpoint(e)) return false;
    if (typeof e.connect === "boolean") return e.connect;
    return false;
  });

  if (connectEps.length > 0) {
    const ep = connectEps[0];
    const existing = new Set(ep.enabled_events || []);
    const toAdd = CONNECT_EVENTS.filter((ev) => !existing.has(ev));
    if (toAdd.length === 0) {
      console.log(`✓ Connect endpoint ${ep.id} already configured (events: ${ep.enabled_events?.join(", ")})`);
      console.log(`  Existing secret: hidden (Stripe doesn't expose it after creation).`);
      console.log(`  If you need to rotate, delete it via dashboard then re-run.`);
      return;
    }
    const merged = Array.from(new Set([...(ep.enabled_events || []), ...toAdd]));
    await stripe(`/webhook_endpoints/${ep.id}`, {
      method: "POST",
      body: { enabled_events: merged },
    });
    console.log(`✓ updated Connect endpoint ${ep.id}: added ${toAdd.join(", ")}`);
    return;
  }

  // Create the Connect endpoint.
  const created = await stripe("/webhook_endpoints", {
    method: "POST",
    body: {
      url: WEBHOOK_URL,
      connect: "true",
      enabled_events: CONNECT_EVENTS,
      description: "Cardigan — patient payments via Stripe Connect (stage 3)",
      api_version: "2024-04-10",
    },
  });
  console.log(`✓ created Connect endpoint ${created.id}`);
  console.log("");
  console.log("┌─────────────────────────────────────────────────────────────");
  console.log("│ NEW WEBHOOK SECRET — add this to Vercel before redeploying:");
  console.log("│");
  console.log(`│   STRIPE_CONNECT_WEBHOOK_SECRET=${created.secret}`);
  console.log("│");
  console.log("│ Add to BOTH Production and Preview environments. The webhook");
  console.log("│ handler verifies against either platform or Connect secret,");
  console.log("│ so older deploys keep working without it.");
  console.log("└─────────────────────────────────────────────────────────────");
}

async function main() {
  console.log(`Targeting webhook URL: ${WEBHOOK_URL}`);
  const keyMode = process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "LIVE" : "TEST";
  console.log(`Stripe key mode: ${keyMode}`);
  console.log("");

  const endpoints = await listEndpoints();
  console.log(`Found ${endpoints.length} webhook endpoint(s) total.`);
  console.log("");

  await ensurePlatformEvents(endpoints);
  console.log("");
  await ensureConnectEndpoint(endpoints);
  console.log("");
  console.log("Done.");
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
