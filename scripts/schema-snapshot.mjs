#!/usr/bin/env node
/* ── schema-snapshot.mjs ───────────────────────────────────────────────
   Pulls the live `public` schema from the production Supabase project
   via the Management API, normalizes it to canonical JSON, and either:
     • diffs against the committed snapshot (default — fails on drift)
     • rewrites the committed snapshot (--update flag)

   Why: every DDL change should land via a migration file. The CI guard
   fails when production has been altered out-of-band (e.g. ad-hoc SQL
   in the dashboard) or when schema.sql / migrations were updated but
   never applied. Drift in either direction is a real-world bug class
   — this catches it before users see the consequence.

   Usage:
     # Dev: check current state against committed snapshot
     node --env-file=.env.local scripts/schema-snapshot.mjs

     # Dev: rewrite the snapshot after intentional changes
     node --env-file=.env.local scripts/schema-snapshot.mjs --update

     # CI: same as default, exits non-zero on drift
     SUPABASE_PAT=... SUPABASE_PROJECT_REF=... \
       node scripts/schema-snapshot.mjs

   Env:
     SUPABASE_PAT          — Management API personal access token
     SUPABASE_PROJECT_REF  — project subdomain (default extracted from
                              SUPABASE_URL when present)

   The script is read-only against production — only the local snapshot
   file is written, and only when --update is passed.
*/

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = resolve(__dirname, "..", "supabase", "schema.snapshot.json");

const PAT = process.env.SUPABASE_PAT;
const PROJECT_REF =
  process.env.SUPABASE_PROJECT_REF ||
  (process.env.SUPABASE_URL || "").match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

if (!PAT || !PROJECT_REF) {
  console.error("error: SUPABASE_PAT and SUPABASE_PROJECT_REF (or SUPABASE_URL) are required");
  process.exit(2);
}

async function q(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!res.ok) {
    throw new Error(`Management API failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

// Canonical JSON: sort object keys recursively so the snapshot is
// stable across runs regardless of column order in our queries.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const sorted = {};
    for (const k of Object.keys(value).sort()) sorted[k] = canonical(value[k]);
    return sorted;
  }
  return value;
}

async function dumpSchema() {
  // Each query is sorted server-side so the JSON we emit is stable.
  // We restrict to the `public` schema — Supabase manages `auth`,
  // `storage`, `realtime`, and friends, and their evolution is not
  // ours to track.
  //
  // pg_get_constraintdef / pg_get_functiondef render the canonical SQL
  // form of each entity, so the snapshot captures behavior (not just
  // existence) for constraints + functions. Function bodies are the
  // most-changed surface, so noisy diffs there are signal, not noise.

  const tables = await q(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
    order by table_name;
  `);

  const columns = await q(`
    select table_name, column_name, ordinal_position,
           data_type, udt_name, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public'
    order by table_name, ordinal_position;
  `);

  // Check, foreign-key, unique, primary-key constraints. Skip the rest
  // (trigger / exclusion constraints aren't used here, but harmless to
  // catch — keep the contype list narrow to avoid noise).
  const constraints = await q(`
    select conrelid::regclass::text as table_name,
           conname,
           contype,
           pg_get_constraintdef(oid) as definition
    from pg_constraint
    where connamespace = 'public'::regnamespace
      and contype in ('c','f','u','p')
    order by conrelid::regclass::text, contype, conname;
  `);

  // pg_indexes covers everything in the public schema. Constraint-
  // backed indexes (PK/UQ) show up here too but they're a duplicate of
  // the constraint row — kept anyway so a manual CREATE INDEX outside
  // a constraint is also tracked.
  const indexes = await q(`
    select tablename, indexname, indexdef
    from pg_indexes
    where schemaname = 'public'
    order by tablename, indexname;
  `);

  const triggers = await q(`
    select event_object_table as table_name,
           trigger_name,
           action_timing,
           event_manipulation,
           action_statement
    from information_schema.triggers
    where trigger_schema = 'public'
    order by event_object_table, trigger_name, event_manipulation;
  `);

  // Stored functions in public. proname can collide on overload; we
  // include identity_arguments so the canonical key is name + signature.
  const functions = await q(`
    select p.proname as name,
           pg_get_function_identity_arguments(p.oid) as args,
           pg_get_function_result(p.oid) as returns,
           pg_get_functiondef(p.oid) as definition,
           case p.prosecdef when true then 'definer' else 'invoker' end as security
    from pg_proc p
    join pg_namespace n on p.pronamespace = n.oid
    where n.nspname = 'public'
    order by p.proname, args;
  `);

  // RLS policies. qual + with_check are the actual security boundary;
  // a silent edit to either is the worst kind of drift.
  const policies = await q(`
    select tablename, policyname, cmd, roles, qual, with_check, permissive
    from pg_policies
    where schemaname = 'public'
    order by tablename, policyname;
  `);

  // Per-table RLS enabled flag. Disabling RLS on a public table is the
  // single highest-severity drift we can catch.
  const rlsState = await q(`
    select c.relname as table_name, c.relrowsecurity as rls_enabled
    from pg_class c
    join pg_namespace n on c.relnamespace = n.oid
    where n.nspname = 'public'
      and c.relkind = 'r'
    order by c.relname;
  `);

  return canonical({
    tables,
    columns,
    constraints,
    indexes,
    triggers,
    functions,
    policies,
    rls_state: rlsState,
  });
}

function renderJson(obj) {
  return JSON.stringify(obj, null, 2) + "\n";
}

// Minimal line-by-line diff for the human reading the CI log. Keeps the
// script dependency-free; the noise budget is small enough that a full
// diff library isn't worth the install footprint.
function lineDiff(a, b) {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const out = [];
  let i = 0, j = 0;
  while (i < aLines.length || j < bLines.length) {
    if (i < aLines.length && j < bLines.length && aLines[i] === bLines[j]) {
      i++; j++; continue;
    }
    // Greedy: advance whichever side mismatches the other; print up to
    // the next sync line. Not a true Myers diff, but more than good
    // enough for "what changed in the snapshot" readability.
    const aNext = aLines.indexOf(bLines[j] ?? "\0", i);
    const bNext = bLines.indexOf(aLines[i] ?? "\0", j);
    if (aNext !== -1 && (bNext === -1 || aNext - i <= bNext - j)) {
      while (i < aNext) out.push(`- ${aLines[i++]}`);
    } else if (bNext !== -1) {
      while (j < bNext) out.push(`+ ${bLines[j++]}`);
    } else {
      if (i < aLines.length) out.push(`- ${aLines[i++]}`);
      if (j < bLines.length) out.push(`+ ${bLines[j++]}`);
    }
  }
  return out.join("\n");
}

const args = process.argv.slice(2);
const updateMode = args.includes("--update");

const live = await dumpSchema();
const liveJson = renderJson(live);

if (updateMode) {
  writeFileSync(SNAPSHOT_PATH, liveJson);
  console.log(`✓ snapshot written: ${SNAPSHOT_PATH}`);
  process.exit(0);
}

if (!existsSync(SNAPSHOT_PATH)) {
  console.error(`error: snapshot missing at ${SNAPSHOT_PATH}`);
  console.error("Run with --update to create it from the current live schema.");
  process.exit(2);
}

const committed = readFileSync(SNAPSHOT_PATH, "utf-8");

if (committed === liveJson) {
  console.log("✓ no schema drift detected");
  process.exit(0);
}

console.error("⚠️  Schema drift detected — live database differs from supabase/schema.snapshot.json");
console.error("");
console.error("Diff (- committed, + live):");
console.error("");
console.error(lineDiff(committed.trim(), liveJson.trim()));
console.error("");
console.error("If this drift is intentional (you just ran a migration), regenerate the");
console.error("snapshot locally and commit it:");
console.error("");
console.error("  node --env-file=.env.local scripts/schema-snapshot.mjs --update");
console.error("  git add supabase/schema.snapshot.json && git commit");
console.error("");
process.exit(1);
