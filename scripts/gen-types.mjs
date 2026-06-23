/* ── gen-types.mjs ──
   Regenerate src/types/supabase.ts from the LIVE Postgres schema via the
   Supabase Management API. Run after any migration so the generated
   Database types (and the src/types/db.ts aliases + the financial-column
   contract that build on them) reflect the current schema.

     node --env-file=.env.local scripts/gen-types.mjs

   Reads SUPABASE_PAT + SUPABASE_PROJECT_REF (same creds as
   scripts/schema-snapshot.mjs). Never writes to the database. */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PAT = process.env.SUPABASE_PAT;
const REF = process.env.SUPABASE_PROJECT_REF;
if (!PAT || !REF) {
  console.error("Missing SUPABASE_PAT / SUPABASE_PROJECT_REF (use --env-file=.env.local)");
  process.exit(1);
}

const HEADER =
`/* Supabase database types — GENERATED, do not edit by hand.
   Source of truth is the live Postgres schema. Regenerate after any
   migration with:  node --env-file=.env.local scripts/gen-types.mjs
   Typing supabaseClient against this turns schema drift into compile
   errors instead of runtime surprises. */

`;

const res = await fetch(
  `https://api.supabase.com/v1/projects/${REF}/types/typescript`,
  { headers: { Authorization: `Bearer ${PAT}` } },
);
if (!res.ok) {
  console.error(`Management API ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const { types } = await res.json();
if (!types || typeof types !== "string") {
  console.error("Unexpected response: no `types` field");
  process.exit(1);
}

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "types", "supabase.ts");
writeFileSync(out, HEADER + types);
console.log(`✓ wrote ${out} (${(HEADER + types).split("\n").length} lines)`);
