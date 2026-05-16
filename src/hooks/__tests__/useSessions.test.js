import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeSupabaseMock, makeStateHolder } from "../../test/mockSupabase";
import { SESSION_STATUS } from "../../data/constants";

// Calendar-drift-safe helpers. Hardcoding "8-Abr" worked on May 16
// when these were authored but would silently start failing every
// January–March of subsequent years (when April 8 is parsed as a
// future date by inferYear and the predicate flips its verdict).
// `pastDate()` always resolves to ~30 days ago relative to runtime.
const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
function pastDate() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return `${d.getDate()}-${SHORT_MONTHS[d.getMonth()]}`;
}

const mock = makeSupabaseMock();
const recalcPatientCounters = vi.fn(async () => null);

vi.mock("../../supabaseClient", () => ({
  get supabase() { return mock.supabase; },
}));
vi.mock("../../utils/patients", () => ({
  recalcPatientCounters: (...args) => recalcPatientCounters(...args),
}));

const { createSessionActions } = await import("../useSessions");

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function seed({ sessions = [] } = {}) {
  const patient = {
    id: "pat-1",
    name: "Ana López",
    initials: "AL",
    rate: 1000,
    paid: 0,
    sessions: 4,
    billed: 4000,
    colorIdx: 0,
  };
  const patients = makeStateHolder([patient]);
  const upcomingSessions = makeStateHolder(sessions);
  const mutating = makeStateHolder(false);
  const mutationError = makeStateHolder("");
  const actions = createSessionActions(
    "user-1",
    patients.get(),
    patients,
    upcomingSessions.get(),
    upcomingSessions,
    mutating,
    mutationError,
  );
  return { actions, patient, patients, upcomingSessions, mutating, mutationError };
}

beforeEach(() => {
  mock.reset();
  recalcPatientCounters.mockReset();
  recalcPatientCounters.mockResolvedValue(null);
});

// Tier-2 H: status updates now flow through update_session_status_atomic
// (RPC), so the tests enqueue a single rpc response instead of a
// (sessions, patients) pair. Optimistic state + revert semantics
// remain identical from the caller's perspective.
const RPC = "rpc:update_session_status_atomic";

describe("updateSessionStatus", () => {
  it("scheduled → completed flips local status; server error reverts", async () => {
    const sess = { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.SCHEDULED, rate: 1000, date: pastDate(), time: "10:00" };
    const ctx = seed({ sessions: [sess] });
    mock.enqueue(RPC, { error: { message: "Offline" } });

    // Optimistic flip is applied synchronously before the function
    // returns — in production React re-renders observe it before the
    // background rpc continuation. The test can't reliably observe
    // that intermediate value because microtask ordering between the
    // outer `await updateSessionStatus` and the inner `await rpc`
    // depends on the underlying mock's resolution depth (async
    // function = one hop; chained-thenable = more hops). What's
    // load-bearing here is the *outcome*: revert on server error,
    // mutationError surfaced.
    const ok = await ctx.actions.updateSessionStatus("s-1", SESSION_STATUS.COMPLETED, false);
    expect(ok).toBe(true);

    await flush();

    // Revert.
    expect(ctx.upcomingSessions.get()[0].status).toBe(SESSION_STATUS.SCHEDULED);
    expect(ctx.patients.get()[0].billed).toBe(4000);
    expect(ctx.mutationError.get()).toBe("Offline");
  });

  it("cancel-with-charge: status = charged, patient.billed unchanged (charge still counts)", async () => {
    const sess = { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.SCHEDULED, rate: 1000, date: pastDate(), time: "10:00" };
    const ctx = seed({ sessions: [sess] });
    mock.enqueue(RPC, { error: null });

    const ok = await ctx.actions.updateSessionStatus("s-1", SESSION_STATUS.CANCELLED, /* charge= */ true);
    expect(ok).toBe(true);
    expect(ctx.upcomingSessions.get()[0].status).toBe(SESSION_STATUS.CHARGED);

    await flush();
    // Charged is NOT cancelled, so wasCancelled === nowCancelled === false → no billed delta applied.
    expect(ctx.patients.get()[0].billed).toBe(4000);
  });

  it("cancel-without-charge decrements patient.billed by session rate", async () => {
    const sess = { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.SCHEDULED, rate: 1000, date: pastDate(), time: "10:00" };
    const ctx = seed({ sessions: [sess] });
    mock.enqueue(RPC, { error: null });

    await ctx.actions.updateSessionStatus("s-1", SESSION_STATUS.CANCELLED, false);
    await flush();

    expect(ctx.upcomingSessions.get()[0].status).toBe(SESSION_STATUS.CANCELLED);
    expect(ctx.patients.get()[0].billed).toBe(3000);
  });

  // ── Retroactive edits on past sessions ──
  // Lifted the UI restriction that hid Cancel from completed rows,
  // and switched updateSessionStatus to a predicate-based delta so
  // every transition (not just the cancellation toggle) lands
  // patient.billed on the same value the live amountDue calc would.

  it("completed → cancelled (no charge) decrements billed by rate", async () => {
    const sess = { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.COMPLETED, rate: 1000, date: pastDate(), time: "10:00" };
    const ctx = seed({ sessions: [sess] });
    mock.enqueue(RPC, { error: null });

    await ctx.actions.updateSessionStatus("s-1", SESSION_STATUS.CANCELLED, false);
    await flush();

    expect(ctx.upcomingSessions.get()[0].status).toBe(SESSION_STATUS.CANCELLED);
    // Was counted (completed) → not counted (cancelled). billed drops.
    expect(ctx.patients.get()[0].billed).toBe(3000);
  });

  it("completed → cancel-with-charge keeps billed unchanged (charged still counts)", async () => {
    const sess = { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.COMPLETED, rate: 1000, date: pastDate(), time: "10:00" };
    const ctx = seed({ sessions: [sess] });
    mock.enqueue(RPC, { error: null });

    await ctx.actions.updateSessionStatus("s-1", SESSION_STATUS.CANCELLED, /* charge= */ true);
    await flush();

    expect(ctx.upcomingSessions.get()[0].status).toBe(SESSION_STATUS.CHARGED);
    // Both completed and charged count toward consumed → no delta.
    expect(ctx.patients.get()[0].billed).toBe(4000);
  });

  it("charged → cancelled (refund a cancellation fee) decrements billed", async () => {
    const sess = { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.CHARGED, rate: 1000, date: pastDate(), time: "10:00" };
    const ctx = seed({ sessions: [sess] });
    mock.enqueue(RPC, { error: null });

    await ctx.actions.updateSessionStatus("s-1", SESSION_STATUS.CANCELLED, false);
    await flush();

    expect(ctx.upcomingSessions.get()[0].status).toBe(SESSION_STATUS.CANCELLED);
    // Charged counted; cancelled doesn't. Billed drops.
    expect(ctx.patients.get()[0].billed).toBe(3000);
  });

  it("cancelled → completed (retroactive bill) increments billed", async () => {
    const sess = { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.CANCELLED, rate: 1000, date: pastDate(), time: "10:00" };
    const ctx = seed({ sessions: [sess] });
    mock.enqueue(RPC, { error: null });

    await ctx.actions.updateSessionStatus("s-1", SESSION_STATUS.COMPLETED, false);
    await flush();

    expect(ctx.upcomingSessions.get()[0].status).toBe(SESSION_STATUS.COMPLETED);
    // Was not counted → now counted. Billed rises.
    expect(ctx.patients.get()[0].billed).toBe(5000);
  });

  it("past-scheduled → cancelled drops billed (auto-completing slot no longer counts)", async () => {
    // pastDate() places the session in the past relative to the
    // canonical predicate's auto-complete window, so SCHEDULED
    // counted as consumed. Cancelling explicitly removes it.
    const sess = { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.SCHEDULED, rate: 1000, date: pastDate(), time: "10:00" };
    const ctx = seed({ sessions: [sess] });
    mock.enqueue(RPC, { error: null });

    await ctx.actions.updateSessionStatus("s-1", SESSION_STATUS.CANCELLED, false);
    await flush();

    expect(ctx.upcomingSessions.get()[0].status).toBe(SESSION_STATUS.CANCELLED);
    expect(ctx.patients.get()[0].billed).toBe(3000);
  });

  it("RPC call carries the expected payload (id, status, reason, expected version)", async () => {
    // Migration 069 removed p_billed_delta — the patient.billed
    // recompute is now triggered server-side by the session UPDATE.
    const sess = { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.COMPLETED, rate: 1000, date: pastDate(), time: "10:00", version: 7 };
    const ctx = seed({ sessions: [sess] });
    mock.enqueue(RPC, { error: null });

    await ctx.actions.updateSessionStatus("s-1", SESSION_STATUS.CANCELLED, false, "tarde");
    await flush();

    const rpcCall = mock.calls.find((c) => c.rpc === "update_session_status_atomic");
    expect(rpcCall).toBeDefined();
    expect(rpcCall.args).toEqual({
      p_session_id: "s-1",
      p_new_status: SESSION_STATUS.CANCELLED,
      p_cancel_reason: "tarde",
      p_expected_version: 7,
    });
  });

  // Optimistic locking (migration 065). When the RPC raises SQLSTATE
  // 40001 ("serialization failure" — our reserved code for "another
  // writer bumped the version under your feet"), the hook must:
  //   1. Revert the optimistic flip back to the prior session shape
  //   2. Refetch the row to learn the new server state
  //   3. Surface a user-facing "edited elsewhere" message
  //   4. Restore the patient-billed snapshot we touched optimistically
  it("40001 version conflict: refetches row, replaces local state, restores patient", async () => {
    const sess = { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.SCHEDULED, rate: 1000, date: pastDate(), time: "10:00", version: 3 };
    const ctx = seed({ sessions: [sess] });
    // RPC rejects with the optimistic-lock conflict code.
    mock.enqueue(RPC, { error: { message: "session version conflict", code: "40001" } });
    // Hook's reconcileSessionConflict then refetches sessions. The server
    // already has a fresh row (someone else flipped it to completed AND
    // bumped version to 4).
    mock.enqueue("sessions", { data: { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.COMPLETED, rate: 1000, date: pastDate(), time: "10:00", version: 4 }, error: null });

    const ok = await ctx.actions.updateSessionStatus("s-1", SESSION_STATUS.CANCELLED, false);
    expect(ok).toBe(true);
    await flush();

    // Local state replaced with server truth (status from the refetch,
    // not the optimistic CANCELLED we tried).
    const refreshed = ctx.upcomingSessions.get()[0];
    expect(refreshed.status).toBe(SESSION_STATUS.COMPLETED);
    expect(refreshed.version).toBe(4);
    // patient.billed bounced back to the pre-attempt value.
    expect(ctx.patients.get()[0].billed).toBe(4000);
    // User-facing message uses the conflict copy, not the raw RPC error.
    expect(ctx.mutationError.get()).toContain("se editó");
  });

  it("40001 version conflict on a deleted row: drops it locally and surfaces 'no existe'", async () => {
    const sess = { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.SCHEDULED, rate: 1000, date: pastDate(), time: "10:00", version: 3 };
    const ctx = seed({ sessions: [sess] });
    mock.enqueue(RPC, { error: { message: "session version conflict", code: "40001" } });
    // Refetch returns null — row was hard-deleted by another tab.
    mock.enqueue("sessions", { data: null, error: null });

    await ctx.actions.updateSessionStatus("s-1", SESSION_STATUS.CANCELLED, false);
    await flush();

    expect(ctx.upcomingSessions.get()).toHaveLength(0);
    expect(ctx.mutationError.get()).toMatch(/ya no existe/);
  });

  it("success bumps local version to match the trigger's server-side increment", async () => {
    const sess = { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.SCHEDULED, rate: 1000, date: pastDate(), time: "10:00", version: 5 };
    const ctx = seed({ sessions: [sess] });
    mock.enqueue(RPC, { error: null });

    await ctx.actions.updateSessionStatus("s-1", SESSION_STATUS.COMPLETED, false);
    await flush();

    expect(ctx.upcomingSessions.get()[0].version).toBe(6);
  });
});

describe("createSession", () => {
  // BUG REGRESSION: prior to migration 013 the UI could double-insert a session
  // if two tabs raced. The DB-level unique index now returns 23505. The handler
  // must NOT increment patient counters on an insert error — otherwise the
  // losing tab's counter drifts upward while the DB holds exactly one row.
  it("23505 unique-violation: returns false and does NOT increment patient counter", async () => {
    const ctx = seed();
    mock.enqueue("sessions", { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } });

    const ok = await ctx.actions.createSession({ patientName: "Ana López", date: pastDate(), time: "10:00", duration: 60 });
    expect(ok).toBe(false);

    expect(ctx.patients.get()[0].sessions).toBe(4);
    expect(ctx.patients.get()[0].billed).toBe(4000);
    expect(ctx.upcomingSessions.get()).toHaveLength(0);
    expect(ctx.mutationError.get()).toContain("duplicate key");
  });
});

describe("rescheduleSession", () => {
  it("optimistic update; server error reverts to prevSession", async () => {
    const originalDate = pastDate();
    const sess = { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.SCHEDULED, rate: 1000, date: originalDate, time: "10:00", day: "Mié" };
    const ctx = seed({ sessions: [sess] });
    mock.enqueue("sessions", { error: { message: "Network down" } });

    const ok = await ctx.actions.rescheduleSession("s-1", "15-Abr", "11:00", 60);
    expect(ok).toBe(true);
    // Optimistic applied.
    expect(ctx.upcomingSessions.get()[0].date).toBe("15-Abr");
    expect(ctx.upcomingSessions.get()[0].time).toBe("11:00");

    await flush();

    // Reverted to the original (runtime-relative past) date.
    expect(ctx.upcomingSessions.get()[0].date).toBe(originalDate);
    expect(ctx.upcomingSessions.get()[0].time).toBe("10:00");
    expect(ctx.mutationError.get()).toBe("Network down");
  });
});
