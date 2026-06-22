/* ── JS ↔ SQL accounting-predicate parity gate ────────────────────────
   The Prime Directive (CLAUDE.md) requires that the JS predicate
   `sessionCountsTowardBalance` (src/utils/accounting.ts) and the SQL
   `public.session_counts_at(...)` (migration 080) agree exactly — they
   are two implementations of the same "has this session been consumed?"
   decision, one for the UI/audit and one for the trigger-maintained
   counters. If they drift, users see one balance and the DB stores
   another. Until now nothing in CI compared them; the nightly audit
   only re-derives JS-vs-counters, not JS-vs-SQL.

   This test feeds an identical fixture matrix to BOTH predicates and
   asserts the booleans match. The SQL side runs against the live
   Postgres function via the Supabase Management API (read-only — it
   calls a pure IMMUTABLE function with synthetic inputs, reads no rows,
   touches no patient data). It SKIPS when SUPABASE_PAT /
   SUPABASE_PROJECT_REF are absent, so the default hermetic CI run is
   unaffected; a dedicated CI job supplies the secrets.

   TZ is pinned to UTC on both sides (process TZ set below + p_tz='UTC')
   so the +1h grace boundary is interpreted identically. */

// Pin the Node process to UTC BEFORE importing the predicate (which uses
// local-time Date math) so it lines up with the SQL p_tz='UTC' arg.
process.env.TZ = "UTC";

import { describe, it, expect } from "vitest";
import { sessionCountsTowardBalance, type BalanceSession } from "../accounting";

const PAT = process.env.SUPABASE_PAT;
const REF = process.env.SUPABASE_PROJECT_REF;
const TZ = "UTC";

type Fixture = {
  label: string;
  status: string;
  date: string;
  time: string;
  created_at: string | null; // ISO
  now: string;               // ISO reference time
};

// Reference "now" used across the relative cases.
const NOW = "2026-06-22T12:00:00.000Z";

const fixtures: Fixture[] = [
  // status short-circuits — date is irrelevant
  { label: "completed counts regardless of date", status: "completed", date: "1-Ene", time: "10:00", created_at: NOW, now: NOW },
  { label: "charged counts regardless of date", status: "charged", date: "31-Dic", time: "23:00", created_at: NOW, now: NOW },
  { label: "cancelled never counts", status: "cancelled", date: "1-Ene", time: "10:00", created_at: NOW, now: NOW },
  // scheduled, clearly past (days ago) — counts
  { label: "scheduled days ago counts", status: "scheduled", date: "20-Jun", time: "10:00", created_at: "2026-06-01T00:00:00.000Z", now: NOW },
  // scheduled, clearly future (days ahead) — does not count
  { label: "scheduled days ahead does not count", status: "scheduled", date: "25-Jun", time: "10:00", created_at: "2026-06-01T00:00:00.000Z", now: NOW },
  // grace boundary: slot today at 10:00, +1h = 11:00 ≤ 12:00 now → counts
  { label: "scheduled past +1h grace counts", status: "scheduled", date: "22-Jun", time: "10:00", created_at: "2026-06-01T00:00:00.000Z", now: NOW },
  // grace boundary: slot today at 11:30, +1h = 12:30 > 12:00 now → no
  { label: "scheduled within grace does not count", status: "scheduled", date: "22-Jun", time: "11:30", created_at: "2026-06-01T00:00:00.000Z", now: NOW },
  // C1 regression: yearless past date anchored on created_at a year back
  { label: "scheduled last-year anchored on created_at counts", status: "scheduled", date: "20-May", time: "10:00", created_at: "2025-05-10T00:00:00.000Z", now: NOW },
  // Boundary at year-end with created_at anchoring across the rollover.
  { label: "scheduled 31-Dic anchored prior year counts", status: "scheduled", date: "31-Dic", time: "10:00", created_at: "2025-12-20T00:00:00.000Z", now: NOW },
];

/* Domain note: session rows store dates YEARLESS ("D-MMM") — the
   year-suffixed form ("20-May-27") is a display/export-only rendering
   (formatShortDateWithYear) and is never persisted to sessions.date, so
   it never reaches EITHER predicate from real data. The two
   implementations intentionally diverge on suffixed input (SQL honors
   the suffix defensively; JS parseShortDate strips it by design — see
   src/utils/dates.ts:6-8), so suffixed fixtures are deliberately
   excluded from the parity domain. If a future change ever persists a
   year-suffixed session date, this exclusion must be revisited and the
   two predicates reconciled. */

async function sqlPredicate(f: Fixture): Promise<boolean> {
  const createdArg = f.created_at ? `'${f.created_at}'::timestamptz` : "null";
  const query =
    `select public.session_counts_at(` +
    `'${f.status}', '${f.date}', '${f.time}', '${TZ}', ` +
    `'${f.now}'::timestamptz, ${createdArg}) as r;`;
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  if (!res.ok) {
    throw new Error(`Management API ${res.status}: ${await res.text()}`);
  }
  const rows = await res.json();
  return rows[0].r === true;
}

function jsPredicate(f: Fixture): boolean {
  const session: BalanceSession = {
    status: f.status,
    date: f.date,
    time: f.time,
    created_at: f.created_at,
  };
  return sessionCountsTowardBalance(session, new Date(f.now));
}

describe.skipIf(!PAT || !REF)("JS ↔ SQL session_counts_at parity", () => {
  for (const f of fixtures) {
    it(f.label, async () => {
      const [js, sql] = await Promise.all([
        Promise.resolve(jsPredicate(f)),
        sqlPredicate(f),
      ]);
      expect(
        js,
        `JS=${js} SQL=${sql} disagree for ${JSON.stringify(f)}`,
      ).toBe(sql);
    });
  }
});
