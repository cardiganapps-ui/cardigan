#!/usr/bin/env node
/* migrate-subscription-prices.mjs

   One-shot migration to swap every active Cardigan Pro subscription onto
   a new Stripe Price ID. Required after lowering the plan price (so
   existing subs renew at the new price) — Stripe Prices are immutable
   once attached to a Subscription, so the only way to lower an
   existing sub is to update its `items[].price` to the new Price ID.

   Migration policy: `proration_behavior=none` so no immediate credit/
   charge — the new price kicks in at the next renewal naturally. The
   webhook (`customer.subscription.updated`) fires for each update;
   that's the source of truth for our own row in `user_subscriptions`,
   so the DB self-heals without an extra UPDATE here.

   Usage (DRY RUN by default — prints what would happen, doesn't write):

     node --env-file=.env.local scripts/migrate-subscription-prices.mjs

   Apply the change (live calls to Stripe + Supabase reads):

     node --env-file=.env.local scripts/migrate-subscription-prices.mjs --apply

   Required env (already in .env.local for full autonomous control):
     STRIPE_SECRET_KEY  — live key when targeting production subs.
     SUPABASE_URL       — to fetch `user_subscriptions` rows.
     SUPABASE_SERVICE_ROLE_KEY  — bypasses RLS to read all users' subs.
     STRIPE_PRICE_ID    — the NEW price id to migrate everyone to.

   The script is idempotent: any sub already on the target price is
   skipped, so re-running after a partial run resumes cleanly.
*/

import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const NEW_PRICE_ID = process.env.STRIPE_PRICE_ID;
const STRIPE_BASE = "https://api.stripe.com/v1";
const STRIPE_API_VERSION = "2024-12-18.acacia";

if (!STRIPE_KEY) die("STRIPE_SECRET_KEY missing");
if (!SUPABASE_URL || !SERVICE_ROLE) die("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
if (!NEW_PRICE_ID) die("STRIPE_PRICE_ID missing — set this to the NEW (lower) price id you minted");
if (!STRIPE_KEY.startsWith("sk_")) die("STRIPE_SECRET_KEY shape looks wrong");

function die(msg) { console.error(`✗ ${msg}`); process.exit(1); }
function fmt(n) { return new Intl.NumberFormat("en-US").format(n); }
function encodeBody(obj) {
  const params = new URLSearchParams();
  const append = (key, value) => {
    if (value == null) return;
    if (Array.isArray(value)) value.forEach((v, i) => append(`${key}[${i}]`, v));
    else if (typeof value === "object") for (const [k, v] of Object.entries(value)) append(`${key}[${k}]`, v);
    else params.append(key, String(value));
  };
  for (const [k, v] of Object.entries(obj)) append(k, v);
  return params.toString();
}

async function stripe(path, { method = "GET", body } = {}) {
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_API_VERSION,
    },
    body: body ? encodeBody(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `Stripe ${path} failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

async function main() {
  const mode = STRIPE_KEY.startsWith("sk_live_") ? "LIVE" : "TEST";
  console.log(`\n${APPLY ? "🔥 APPLY" : "🧪 DRY-RUN"}  Stripe ${mode}  →  new price: ${NEW_PRICE_ID}\n`);

  // 1. Verify the destination price exists & is active before we touch anything.
  const newPrice = await stripe(`/prices/${NEW_PRICE_ID}`).catch(e => die(`Cannot fetch new price: ${e.message}`));
  if (!newPrice.active) die("New price is inactive — activate it in the dashboard first");
  console.log(`  ✓ New price OK: ${newPrice.unit_amount / 100} ${newPrice.currency.toUpperCase()} / ${newPrice.recurring?.interval || "?"}`);

  // 2. Pull every row from user_subscriptions that's plausibly active.
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: subs, error } = await supa
    .from("user_subscriptions")
    .select("user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, comp_granted")
    .not("stripe_subscription_id", "is", null)
    .in("status", ["active", "trialing", "past_due"]);
  if (error) die(`Supabase read failed: ${error.message}`);

  console.log(`  Found ${subs.length} candidate sub(s) (status in active/trialing/past_due, has Stripe sub id)`);

  let migrated = 0, skipped = 0, errors = 0, comped = 0;
  for (const row of subs) {
    if (row.comp_granted) {
      console.log(`  · ${row.user_id.slice(0, 8)}…  comp_granted, skipping`);
      comped += 1;
      continue;
    }
    if (row.stripe_price_id === NEW_PRICE_ID) {
      skipped += 1;
      continue; // already migrated
    }

    try {
      // Fetch the live sub to get the SubscriptionItem id (we update
      // items[].id, not the sub directly).
      const sub = await stripe(`/subscriptions/${row.stripe_subscription_id}`);
      if (!["active", "trialing", "past_due"].includes(sub.status)) {
        console.log(`  · ${row.user_id.slice(0, 8)}…  sub status=${sub.status}, skipping`);
        skipped += 1;
        continue;
      }
      const item = sub.items?.data?.[0];
      if (!item?.id) {
        console.log(`  ✗ ${row.user_id.slice(0, 8)}…  no SubscriptionItem on Stripe`);
        errors += 1;
        continue;
      }

      const oldAmount = item.price?.unit_amount || 0;
      const newAmount = newPrice.unit_amount;
      const diff = oldAmount - newAmount;
      const summary = `${row.user_id.slice(0, 8)}…  ${oldAmount/100} → ${newAmount/100} ${newPrice.currency.toUpperCase()} (saves ${diff/100}/period)`;

      if (!APPLY) {
        console.log(`  · ${summary}`);
        migrated += 1;
        continue;
      }

      // Idempotency: include the user id + target price in the key so a
      // re-run after a partial failure doesn't double-fire.
      const idemKey = `migrate-price-${row.user_id}-${NEW_PRICE_ID}`;
      await fetch(`${STRIPE_BASE}/subscriptions/${sub.id}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${STRIPE_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Stripe-Version": STRIPE_API_VERSION,
          "Idempotency-Key": idemKey,
        },
        body: encodeBody({
          items: [{ id: item.id, price: NEW_PRICE_ID }],
          proration_behavior: "none",
          metadata: { migrated_from_price: row.stripe_price_id || "unknown" },
        }),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error?.message || `HTTP ${r.status}`);
      });

      console.log(`  ✓ ${summary}`);
      migrated += 1;
      // Tiny pause so we stay under Stripe's 100 req/s limit even on
      // accounts with thousands of subs.
      await new Promise((r) => setTimeout(r, 50));
    } catch (e) {
      console.log(`  ✗ ${row.user_id.slice(0, 8)}…  ${e.message}`);
      errors += 1;
    }
  }

  console.log(`\n${APPLY ? "Applied" : "Would apply"}: ${fmt(migrated)} migrated  ·  ${fmt(skipped)} skipped (already on price or inactive)  ·  ${fmt(comped)} comped (free)  ·  ${fmt(errors)} errors`);
  if (!APPLY) console.log("\nRe-run with --apply to commit.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
