/**
 * @vitest-environment happy-dom
 */
/* ── useCardiganData orchestration integration test ───────────────────
   The 1,200-line coordinator was effectively untested: only its pure
   helpers (mapRows, isAdmin) had coverage, not the fetch → normalize →
   ENRICH pipeline that actually assembles the balance every screen
   shows. This drives the real hook through a mocked Supabase and asserts
   the end-to-end composition:

     • the 15-table parallel fetch resolves and clears `loading`,
     • raw rows pass through mapRows (legacy "8 Abr" → "8-Abr",
       color_idx → colorIdx),
     • enrichedPatients carry the canonical amountDue/credit derived from
       the RAW session history (completed + past-scheduled auto-complete)
       minus patient.paid, and
     • enrichedSessions apply the display-only auto-complete to a past
       scheduled row WITHOUT that ever feeding the accounting math.

   Past-only sessions + no groups + no recurring-expense templates keep
   the three auto-extend/generate side-effect branches inert, so the
   fetch is a clean read. */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { makeSupabaseMock } from "../../test/mockSupabase";
import { SESSION_STATUS, PATIENT_STATUS } from "../../data/constants";
import { isoToShortDate } from "../../utils/dates";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const mock = makeSupabaseMock();

vi.mock("../../supabaseClient", () => ({
  get supabase() { return mock.supabase; },
}));
// Cold start: no cached snapshot, no localStorage writes during the test.
vi.mock("../../lib/dataCache", () => ({
  loadCachedData: () => null,
  saveCachedData: () => {},
}));

const { useCardiganData } = await import("../useCardiganData");

// "D-MMM" string offset N days back from today (always past).
function shortDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return isoToShortDate(iso);
}

// Sessions are read via fetchAllPaged (.range paging), which only stops
// on an EMPTY page — exactly like real PostgREST returning 0 rows past
// the end. A flat fallback would repeat forever, so model the pager:
// rows on page 0 (from === 0), [] thereafter.
function sessionsPager(rows: Row[]) {
  return ({ ops }: Row) => {
    const range = ops.find((o: Row) => o.op === "range");
    const from = range ? range.from : 0;
    return { data: from === 0 ? rows : [], error: null };
  };
}

beforeEach(() => {
  mock.reset();
});

afterEach(() => {
  cleanup();
});

describe("useCardiganData — fetch → normalize → enrich", () => {
  it("computes amountDue from raw sessions and normalizes rows on the read path", async () => {
    // One active patient who has paid 1500. Two past sessions @1000 each
    // count toward consumed (one completed, one past-scheduled
    // auto-complete) → consumed 2000 → amountDue = max(0, 2000-1500) = 500.
    mock.setFallback("patients", {
      data: [{
        id: "p1", user_id: "u1", name: "Ana", initials: "AL",
        rate: 1000, paid: 1500, opening_balance: 0,
        status: PATIENT_STATUS.ACTIVE, color_idx: 2,
        scheduling_mode: "recurring",
      }],
      error: null,
    });
    mock.setFallback("sessions", sessionsPager([
      // Legacy space-separated date — must normalize to "8-Abr".
      { id: "s1", user_id: "u1", patient_id: "p1", status: SESSION_STATUS.COMPLETED, rate: 1000, date: "8 Abr", time: "10:00", is_recurring: false },
      // Past scheduled → auto-completes for display AND counts toward consumed.
      { id: "s2", user_id: "u1", patient_id: "p1", status: SESSION_STATUS.SCHEDULED, rate: 1000, date: shortDaysAgo(10), time: "10:00", is_recurring: false },
    ]));

    const { result } = renderHook(() => useCardiganData({ id: "u1", email: "u1@test.com" }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.fetchError).toBe("");

    // Enriched balance (the number every money screen reads).
    const ana = result.current.patients.find((p: Row) => p.id === "p1")!;
    expect(ana.amountDue).toBe(500);
    expect(ana.credit).toBe(0);
    // mapRows field shaping: color_idx → colorIdx.
    expect(ana.colorIdx).toBe(2);

    // mapRows date canonicalization reflected through the coordinator.
    const s1 = result.current.upcomingSessions.find((s: Row) => s.id === "s1")!;
    expect(s1.date).toBe("8-Abr");

    // enrichedSessions display-only auto-complete on the past scheduled row.
    const s2 = result.current.upcomingSessions.find((s: Row) => s.id === "s2")!;
    expect(s2.status).toBe(SESSION_STATUS.COMPLETED);
    expect(s2._autoCompleted).toBe(true);
  });

  it("reports a credit (saldo a favor) when the patient overpaid", async () => {
    mock.setFallback("patients", {
      data: [{
        id: "p1", user_id: "u1", name: "Ana", rate: 1000, paid: 1500,
        opening_balance: 0, status: PATIENT_STATUS.ACTIVE, color_idx: 0,
        scheduling_mode: "recurring",
      }],
      error: null,
    });
    // Only one completed session @1000 → consumed 1000, paid 1500 →
    // credit 500, amountDue 0.
    mock.setFallback("sessions", sessionsPager([
      { id: "s1", user_id: "u1", patient_id: "p1", status: SESSION_STATUS.COMPLETED, rate: 1000, date: "8-Abr", time: "10:00" },
    ]));

    const { result } = renderHook(() => useCardiganData({ id: "u1" }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ana = result.current.patients.find((p: Row) => p.id === "p1")!;
    expect(ana.amountDue).toBe(0);
    expect(ana.credit).toBe(500);
  });

  it("surfaces a table-level fetch error without crashing the hook", async () => {
    mock.setFallback("patients", { data: null, error: { message: "boom" } });
    mock.setFallback("sessions", { data: [], error: null });

    const { result } = renderHook(() => useCardiganData({ id: "u1" }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.fetchError).toBe("boom");
    // Degrades to empty data rather than throwing.
    expect(result.current.patients).toEqual([]);
  });

  it("degrades gracefully when a single query rejects (allSettled)", async () => {
    // The patients query rejects (e.g. a connection dropped mid-flight),
    // but the other tables must still hydrate — the regression the
    // Promise.allSettled change prevents (Promise.all would blank
    // everything).
    mock.setFallback("patients", () => Promise.reject(new Error("network dropped")));
    mock.setFallback("sessions", sessionsPager([]));
    mock.setFallback("payments", {
      data: [{ id: "pay1", user_id: "u1", patient_id: "p1", amount: 500, date: "8-Abr", method: "transferencia", color_idx: 0 }],
      error: null,
    });

    const { result } = renderHook(() => useCardiganData({ id: "u1" }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The failure is surfaced…
    expect(result.current.fetchError).toBe("network dropped");
    // …the rejected table degrades to empty…
    expect(result.current.patients).toEqual([]);
    // …but the OTHER tables still loaded (this is the whole point).
    expect(result.current.payments).toHaveLength(1);
  });

  it("KEEPS last-known-good data when a table errors on a background refresh", async () => {
    // First load succeeds: one patient + one completed session (consumed
    // 1000, paid 0 → owes 1000).
    mock.setFallback("patients", {
      data: [{ id: "p1", user_id: "u1", name: "Ana", rate: 1000, paid: 0, opening_balance: 0, status: PATIENT_STATUS.ACTIVE, color_idx: 0, scheduling_mode: "recurring" }],
      error: null,
    });
    mock.setFallback("sessions", sessionsPager([
      { id: "s1", user_id: "u1", patient_id: "p1", status: SESSION_STATUS.COMPLETED, rate: 1000, date: "8-Abr", time: "10:00" },
    ]));

    const { result } = renderHook(() => useCardiganData({ id: "u1" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.patients).toHaveLength(1);
    expect(result.current.patients[0].amountDue).toBe(1000);

    // A later background refresh hits a flaky patients table.
    mock.setFallback("patients", { data: null, error: { message: "flaky" } });
    await act(async () => { await result.current.refresh(); });

    // The failure surfaces via fetchError…
    expect(result.current.fetchError).toBe("flaky");
    // …but the previously-loaded patient (and its balance) is NOT wiped to
    // [] — last-known-good stays on screen instead of flashing a wrong $0.
    expect(result.current.patients).toHaveLength(1);
    expect(result.current.patients[0].name).toBe("Ana");
    expect(result.current.patients[0].amountDue).toBe(1000);
  });

  it("skips the fetch entirely when there is no user", async () => {
    const { result } = renderHook(() => useCardiganData(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.patients).toEqual([]);
    // No query was ever issued.
    expect(mock.calls.length).toBe(0);
  });
});
