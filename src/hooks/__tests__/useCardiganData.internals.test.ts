/* ── useCardiganData read-path normalizer tests ──
   `mapRows` runs on every sessions/payments row the moment it lands from
   Supabase, BEFORE the UI or the accounting layer ever sees it. CLAUDE.md
   leans on three guarantees it provides:
     1. `date` is canonicalized to the "D-MMM" hyphen form so the UI never
        sees the legacy space-separated form (pre-migration-008 rows).
     2. `color_idx` (DB snake_case) is surfaced as `colorIdx` (JS).
     3. `modality` defaults to "presencial" so downstream code never
        branches on undefined.
   None of this was under test despite the 968-line coordinator being the
   busiest hot path in the app. Pin it here. `isAdmin` is bundled in since
   it gates the entire read-only "view as user" surface. */

import { describe, it, expect, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

// The module imports `../supabaseClient`, whose top-level createClient()
// would throw on the undefined test-env URL. Stub it — these tests only
// exercise pure exported helpers, not the network path.
vi.mock("../../supabaseClient", () => ({
  supabase: { from: () => ({}), auth: {}, rpc: () => ({}) },
}));

const { _internals, isAdmin } = await import("../useCardiganData");
const mapRows: (rows: Row) => Row[] = _internals.mapRows;

describe("mapRows — date canonicalization", () => {
  it("normalizes the legacy space-separated form to 'D-MMM'", () => {
    const [row] = mapRows([{ id: "s1", date: "8 Abr" }]);
    expect(row.date).toBe("8-Abr");
  });

  it("leaves an already-canonical 'D-MMM' date untouched", () => {
    const [row] = mapRows([{ id: "s1", date: "8-Abr" }]);
    expect(row.date).toBe("8-Abr");
  });

  it("passes a null/empty date through without throwing", () => {
    expect(mapRows([{ id: "s1", date: null }])[0].date).toBe(null);
    expect(mapRows([{ id: "s2", date: "" }])[0].date).toBe("");
  });
});

describe("mapRows — field shaping", () => {
  it("maps color_idx → colorIdx", () => {
    const [row] = mapRows([{ id: "s1", color_idx: 3 }]);
    expect(row.colorIdx).toBe(3);
  });

  it("maps color_idx → colorIdx even when 0 (falsy but valid index)", () => {
    const [row] = mapRows([{ id: "s1", color_idx: 0 }]);
    expect(row.colorIdx).toBe(0);
  });

  it("defaults a missing modality to 'presencial'", () => {
    expect(mapRows([{ id: "s1" }])[0].modality).toBe("presencial");
    expect(mapRows([{ id: "s2", modality: null }])[0].modality).toBe("presencial");
  });

  it("preserves an explicit modality", () => {
    expect(mapRows([{ id: "s1", modality: "virtual" }])[0].modality).toBe("virtual");
  });

  it("preserves all other fields verbatim", () => {
    const [row] = mapRows([
      { id: "s1", patient_id: "p1", status: "scheduled", rate: 700, date: "8-Abr" },
    ]);
    expect(row).toMatchObject({
      id: "s1",
      patient_id: "p1",
      status: "scheduled",
      rate: 700,
    });
  });
});

describe("mapRows — null / empty input safety", () => {
  it("returns [] for null/undefined input rather than throwing", () => {
    expect(mapRows(null)).toEqual([]);
    expect(mapRows(undefined)).toEqual([]);
    expect(mapRows([])).toEqual([]);
  });
});

describe("isAdmin", () => {
  it("is true only for the configured ADMIN_EMAIL", () => {
    expect(isAdmin({ email: "gaxioladiego@gmail.com" })).toBe(true);
  });

  it("is false for any other email and for null-ish users", () => {
    expect(isAdmin({ email: "someone@else.com" })).toBe(false);
    expect(isAdmin({})).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});
