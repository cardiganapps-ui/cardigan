import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeSupabaseMock, makeStateHolder } from "../../test/mockSupabase";
import { SESSION_STATUS } from "../../data/constants";

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

describe("updateSessionStatus", () => {
  it("scheduled → completed flips local status; server error reverts", async () => {
    const sess = { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.SCHEDULED, rate: 1000, date: "8-Abr", time: "10:00" };
    const ctx = seed({ sessions: [sess] });
    mock.enqueue("sessions", { error: { message: "Offline" } });

    const ok = await ctx.actions.updateSessionStatus("s-1", SESSION_STATUS.COMPLETED, false);
    expect(ok).toBe(true);
    // Optimistic flip applied immediately.
    expect(ctx.upcomingSessions.get()[0].status).toBe(SESSION_STATUS.COMPLETED);
    // Patient.billed doesn't change: scheduled → completed doesn't toggle the cancelled-ness.
    expect(ctx.patients.get()[0].billed).toBe(4000);

    await flush();

    // Revert.
    expect(ctx.upcomingSessions.get()[0].status).toBe(SESSION_STATUS.SCHEDULED);
    expect(ctx.mutationError.get()).toBe("Offline");
  });

  it("cancel-with-charge: status = charged, patient.billed unchanged (charge still counts)", async () => {
    const sess = { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.SCHEDULED, rate: 1000, date: "8-Abr", time: "10:00" };
    const ctx = seed({ sessions: [sess] });
    mock.enqueue("sessions", { error: null });

    const ok = await ctx.actions.updateSessionStatus("s-1", SESSION_STATUS.CANCELLED, /* charge= */ true);
    expect(ok).toBe(true);
    expect(ctx.upcomingSessions.get()[0].status).toBe(SESSION_STATUS.CHARGED);

    await flush();
    // Charged is NOT cancelled, so wasCancelled === nowCancelled === false → no billed delta applied.
    expect(ctx.patients.get()[0].billed).toBe(4000);
  });

  it("cancel-without-charge decrements patient.billed by session rate", async () => {
    const sess = { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.SCHEDULED, rate: 1000, date: "8-Abr", time: "10:00" };
    const ctx = seed({ sessions: [sess] });
    mock.enqueue("sessions", { error: null });
    mock.enqueue("patients", { error: null });

    await ctx.actions.updateSessionStatus("s-1", SESSION_STATUS.CANCELLED, false);
    await flush();

    expect(ctx.upcomingSessions.get()[0].status).toBe(SESSION_STATUS.CANCELLED);
    expect(ctx.patients.get()[0].billed).toBe(3000);
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

    const ok = await ctx.actions.createSession({ patientName: "Ana López", date: "8-Abr", time: "10:00", duration: 60 });
    expect(ok).toBe(false);

    expect(ctx.patients.get()[0].sessions).toBe(4);
    expect(ctx.patients.get()[0].billed).toBe(4000);
    expect(ctx.upcomingSessions.get()).toHaveLength(0);
    expect(ctx.mutationError.get()).toContain("duplicate key");
  });
});

describe("rescheduleSession", () => {
  it("optimistic update; server error reverts to prevSession", async () => {
    const sess = { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.SCHEDULED, rate: 1000, date: "8-Abr", time: "10:00", day: "Mié" };
    const ctx = seed({ sessions: [sess] });
    mock.enqueue("sessions", { error: { message: "Network down" } });

    const ok = await ctx.actions.rescheduleSession("s-1", "15-Abr", "11:00", 60);
    expect(ok).toBe(true);
    // Optimistic applied.
    expect(ctx.upcomingSessions.get()[0].date).toBe("15-Abr");
    expect(ctx.upcomingSessions.get()[0].time).toBe("11:00");

    await flush();

    // Reverted.
    expect(ctx.upcomingSessions.get()[0].date).toBe("8-Abr");
    expect(ctx.upcomingSessions.get()[0].time).toBe("10:00");
    expect(ctx.mutationError.get()).toBe("Network down");
  });
});
