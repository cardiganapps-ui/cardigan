import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeSupabaseMock } from "../../test/mockSupabase";

/* Locks in the CLAUDE.md Prime Directive rule #4 invariant:
   recalcPatientCounters MUST use the same formula as the live
   amountDue calc. Previously it counted only {completed, charged},
   silently dropping past-scheduled (auto-complete) contributions
   and disagreeing with the live consumed calc. */

const mock = makeSupabaseMock();
vi.mock("../../supabaseClient", () => ({
  get supabase() { return mock.supabase; },
}));

const { recalcPatientCounters } = await import("../patients");

beforeEach(() => {
  mock.reset();
});

function shortMonths() {
  return ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
}

// Build a date string N days from today in "D-Mmm" format, matching
// the production short-date encoding.
function dateFromOffset(daysAhead) {
  const months = shortMonths();
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return `${d.getDate()}-${months[d.getMonth()]}`;
}

describe("recalcPatientCounters", () => {
  it("counts past-scheduled (auto-complete) toward billed — predicate alignment", async () => {
    // A past-scheduled session is the linchpin: the live amountDue
    // calc counts it as consumed (past+1h passed), so recalc must
    // count it as billed. Pre-fix the recalc dropped it and drifted
    // below consumed.
    mock.enqueue("sessions", {
      data: [{ rate: 1000, status: "scheduled", date: dateFromOffset(-7), time: "10:00" }],
      error: null,
    });
    mock.enqueue("payments", { data: [], error: null });
    mock.enqueue("patients", { error: null });

    const result = await recalcPatientCounters("pat-1");
    expect(result).toEqual({ sessions: 1, billed: 1000, paid: 0 });
  });

  it("does NOT count future-scheduled toward billed", async () => {
    mock.enqueue("sessions", {
      data: [{ rate: 1000, status: "scheduled", date: dateFromOffset(7), time: "10:00" }],
      error: null,
    });
    mock.enqueue("payments", { data: [], error: null });
    mock.enqueue("patients", { error: null });

    const result = await recalcPatientCounters("pat-1");
    expect(result).toEqual({ sessions: 1, billed: 0, paid: 0 });
  });

  it("counts completed + charged regardless of date", async () => {
    mock.enqueue("sessions", {
      data: [
        { rate: 1000, status: "completed", date: dateFromOffset(-30), time: "10:00" },
        { rate: 500,  status: "charged",   date: dateFromOffset(10),  time: "10:00" },
      ],
      error: null,
    });
    mock.enqueue("payments", { data: [], error: null });
    mock.enqueue("patients", { error: null });

    const result = await recalcPatientCounters("pat-1");
    expect(result).toEqual({ sessions: 2, billed: 1500, paid: 0 });
  });

  it("excludes cancelled from billed but includes in sessions count", async () => {
    mock.enqueue("sessions", {
      data: [
        { rate: 1000, status: "completed", date: dateFromOffset(-7), time: "10:00" },
        { rate: 1000, status: "cancelled", date: dateFromOffset(-3), time: "10:00" },
      ],
      error: null,
    });
    mock.enqueue("payments", { data: [], error: null });
    mock.enqueue("patients", { error: null });

    const result = await recalcPatientCounters("pat-1");
    expect(result).toEqual({ sessions: 2, billed: 1000, paid: 0 });
  });

  it("sums payments into paid", async () => {
    mock.enqueue("sessions", { data: [], error: null });
    mock.enqueue("payments", {
      data: [{ amount: 800 }, { amount: 200 }],
      error: null,
    });
    mock.enqueue("patients", { error: null });

    const result = await recalcPatientCounters("pat-1");
    expect(result).toEqual({ sessions: 0, billed: 0, paid: 1000 });
  });

  it("returns null on session-fetch error", async () => {
    mock.enqueue("sessions", { data: null, error: { message: "DB down" } });
    mock.enqueue("payments", { data: [], error: null });

    const result = await recalcPatientCounters("pat-1");
    expect(result).toBeNull();
  });

  it("treats missing rate as 0 (defensive)", async () => {
    // Malformed row with null rate shouldn't crash the recalc or
    // poison the sum with NaN.
    mock.enqueue("sessions", {
      data: [{ rate: null, status: "completed", date: dateFromOffset(-5), time: "10:00" }],
      error: null,
    });
    mock.enqueue("payments", { data: [], error: null });
    mock.enqueue("patients", { error: null });

    const result = await recalcPatientCounters("pat-1");
    expect(result).toEqual({ sessions: 1, billed: 0, paid: 0 });
  });
});
