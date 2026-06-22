/**
 * @vitest-environment happy-dom
 *
 * Offline-path tests for the session mutations wired in Phase 2:
 * createSession, deleteSession, updateSessionStatus. Same scaffolding
 * pattern as usePayments.offline.test.js.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeSupabaseMock, makeStateHolder } from "../../test/mockSupabase";
import { SESSION_STATUS } from "../../data/constants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const mock = makeSupabaseMock();

let kvStore: Record<string, Row> = {};
vi.mock("../../lib/idbKv.js", () => ({
  kvGet: async (k: Row) => kvStore[k],
  kvSet: async (k: Row, v: Row) => { kvStore[k] = v; },
  kvDelete: async (k: Row) => { delete kvStore[k]; },
  kvAvailable: async () => true,
}));

vi.mock("../../supabaseClient", () => ({
  get supabase() { return mock.supabase; },
}));
vi.mock("../../utils/patients", () => ({
  recalcPatientCounters: async () => null,
}));

const { createSessionActions } = await import("../useSessions");
const queue: Row = await import("../../lib/mutationQueue");

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true, writable: true });
}

async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

function seed({ sessions = [] as Row[] } = {}) {
  const patient = {
    id: "pat-1", name: "Ana López", initials: "AL",
    rate: 1000, paid: 500, sessions: 4, billed: 4000, colorIdx: 0,
  };
  const patients = makeStateHolder([patient]);
  const upcomingSessions = makeStateHolder(sessions);
  const actions = createSessionActions(
    "user-1", patients.get(), patients,
    upcomingSessions.get(), upcomingSessions,
    makeStateHolder(false), makeStateHolder(""),
  );
  return { actions, patient, patients, upcomingSessions };
}

// Spanish month for today (so the inserted session passes the
// migration-067 date-format check on replay). Doesn't actually run
// against a real DB here, but keeps the test data realistic.
const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
function todayShort() {
  const d = new Date();
  return `${d.getDate()}-${MONTHS[d.getMonth()]}`;
}

beforeEach(async () => {
  mock.reset();
  kvStore = {};
  await queue.clearForTest();
  await queue.init();
  setOnline(true); // safe default; individual tests flip
});

describe("createSession offline path", () => {
  it("offline: adds optimistic temp row + enqueues sessions.insert; no network call", async () => {
    setOnline(false);
    const ctx = seed();

    const ok = await ctx.actions.createSession({
      patientName: "Ana López", date: todayShort(), time: "10:00", duration: 60,
    });
    await flush();

    expect(ok).toBe(true);
    expect(ctx.upcomingSessions.get()).toHaveLength(1);
    expect(ctx.upcomingSessions.get()[0]._optimistic).toBe(true);
    expect(ctx.upcomingSessions.get()[0].id.startsWith("temp-")).toBe(true);
    expect(ctx.patients.get()[0].sessions).toBe(5); // 4 → 5

    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("sessions.insert");
    expect(queue.getEntries()[0].args.row.patient).toBe("Ana López");
    expect(queue.getEntries()[0].optimisticMeta.tempId).toBe(ctx.upcomingSessions.get()[0].id);
    expect(mock.calls).toHaveLength(0);
  });

  it("draining the queue swaps the temp row for the server-assigned row", async () => {
    setOnline(false);
    const ctx = seed();
    await ctx.actions.createSession({
      patientName: "Ana López", date: todayShort(), time: "10:00", duration: 60,
    });
    await flush();
    // Capture the temp id only to verify the swap happens.
    expect(ctx.upcomingSessions.get()[0].id.startsWith("temp-")).toBe(true);

    setOnline(true);
    mock.enqueue("sessions", { data: { id: "real-s-1", patient_id: "pat-1", patient: "Ana López", date: todayShort(), time: "10:00", status: "scheduled", rate: 1000, color_idx: 0 }, error: null });

    await queue.drain();
    await flush();

    expect(ctx.upcomingSessions.get()[0].id).toBe("real-s-1");
    expect(ctx.upcomingSessions.get()[0]._optimistic).toBeUndefined();
  });
});

describe("deleteSession offline path", () => {
  it("offline: removes locally + enqueues sessions.delete; no network call", async () => {
    setOnline(false);
    const ctx = seed({ sessions: [
      { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.COMPLETED, rate: 1000, date: todayShort(), time: "10:00", version: 1 },
    ]});

    const ok = await ctx.actions.deleteSession("s-1");

    expect(ok).toBe(true);
    expect(ctx.upcomingSessions.get()).toHaveLength(0);
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("sessions.delete");
    expect(queue.getEntries()[0].args.id).toBe("s-1");
    expect(mock.calls).toHaveLength(0);
  });

  it("deleting a temp-id row removes locally without queuing", async () => {
    setOnline(true);
    const ctx = seed({ sessions: [
      { id: "temp-xyz", patient_id: "pat-1", status: SESSION_STATUS.SCHEDULED, rate: 1000, date: todayShort(), time: "10:00" },
    ]});

    const ok = await ctx.actions.deleteSession("temp-xyz");

    expect(ok).toBe(true);
    expect(ctx.upcomingSessions.get()).toHaveLength(0);
    expect(queue.getEntries()).toHaveLength(0);
  });
});

describe("updateSessionStatus offline path", () => {
  it("offline: enqueues the RPC without expected_version", async () => {
    setOnline(false);
    const ctx = seed({ sessions: [
      { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.SCHEDULED, rate: 1000, date: todayShort(), time: "10:00", version: 3 },
    ]});

    const ok = await ctx.actions.updateSessionStatus("s-1", SESSION_STATUS.COMPLETED, false);
    await flush();

    expect(ok).toBe(true);
    // Optimistic local flip applied.
    expect(ctx.upcomingSessions.get()[0].status).toBe(SESSION_STATUS.COMPLETED);
    // Queue carries the args, NO expected_version (last-write-wins replay).
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("sessions.update_status_atomic");
    expect(queue.getEntries()[0].args).toEqual({
      id: "s-1",
      newStatus: SESSION_STATUS.COMPLETED,
      cancelReason: null,
      // enqueuedVersion captured so the replay handler can detect a
      // version conflict (last-write-wins, but flagged in drain result).
      enqueuedVersion: 3,
    });
    // No RPC call hit the wire.
    const rpcCalls = mock.calls.filter((c: Row) => c.rpc);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("writeSessionWithLock offline path (via updateSessionModality)", () => {
  it("offline: queues sessions.update with the patch and no version filter", async () => {
    setOnline(false);
    const ctx = seed({ sessions: [
      { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.SCHEDULED, rate: 1000, date: todayShort(), time: "10:00", modality: "presencial", version: 2 },
    ]});

    const ok = await ctx.actions.updateSessionModality("s-1", "virtual");

    expect(ok).toBe(true);
    expect(ctx.upcomingSessions.get()[0].modality).toBe("virtual");
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("sessions.update");
    expect(queue.getEntries()[0].args.patch).toEqual({ modality: "virtual" });
    expect(queue.getEntries()[0].args.id).toBe("s-1");
    expect(mock.calls).toHaveLength(0);
  });

  it("temp-id row: applies optimistic locally and skips both wire and queue", async () => {
    setOnline(true);
    const ctx = seed({ sessions: [
      { id: "temp-xyz", patient_id: "pat-1", status: SESSION_STATUS.SCHEDULED, rate: 1000, date: todayShort(), time: "10:00", modality: "presencial" },
    ]});

    const ok = await ctx.actions.updateSessionModality("temp-xyz", "virtual");

    expect(ok).toBe(true);
    expect(ctx.upcomingSessions.get()[0].modality).toBe("virtual");
    // Underlying insert is still in the queue from elsewhere; this
    // update is deferred — no new queue entry, no wire call.
    expect(queue.getEntries()).toHaveLength(0);
    expect(mock.calls).toHaveLength(0);
  });
});

describe("rescheduleSession offline path", () => {
  it("offline: applies optimistic patch + enqueues sessions.update", async () => {
    setOnline(false);
    const ctx = seed({ sessions: [
      { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.SCHEDULED, rate: 1000, date: todayShort(), time: "10:00", version: 1, day: "Lun" },
    ]});

    const ok = await ctx.actions.rescheduleSession("s-1", "15-Abr", "11:00", 60);

    expect(ok).toBe(true);
    expect(ctx.upcomingSessions.get()[0].date).toBe("15-Abr");
    expect(ctx.upcomingSessions.get()[0].time).toBe("11:00");
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("sessions.update");
    expect(queue.getEntries()[0].args.patch.date).toBe("15-Abr");
    expect(queue.getEntries()[0].args.patch.time).toBe("11:00");
    expect(mock.calls).toHaveLength(0);
  });
});

describe("generateRecurringSessions offline path", () => {
  it("offline: adds temp rows + enqueues a single sessions.bulk_insert", async () => {
    setOnline(false);
    const ctx = seed();
    // DAY_TO_JS uses full Spanish names ("Lunes", not "Lun").
    const schedules = [{ day: "Lunes", time: "10:00", duration: 60, frequency: "weekly", modality: "presencial" }];

    // Start + end dates inside a small window so we only get a handful of rows.
    const startIso = "2026-05-18";
    const endIso = "2026-06-08";

    const ok = await ctx.actions.generateRecurringSessions("pat-1", schedules, startIso, endIso);

    expect(ok).toBe(true);
    const rows = ctx.upcomingSessions.get();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: Row) => r._optimistic)).toBe(true);
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("sessions.bulk_insert");
    expect(queue.getEntries()[0].args.rows.length).toBe(rows.length);
    expect(mock.calls).toHaveLength(0);
  });

  it("bulk_insert replay swallows 23505 (idempotent on duplicate-key)", async () => {
    setOnline(true);
    // Prime the response queue with a 23505 error — what a 2nd drain
    // would see if the first one already inserted the rows.
    mock.enqueue("sessions", { data: null, error: { code: "23505", message: "duplicate key" } });

    await queue.enqueue("sessions.bulk_insert", { rows: [{ patient_id: "pat-1", date: todayShort(), time: "10:00" }] });
    const result = await queue.drain();

    expect(result).toEqual({ drained: 1, remaining: 0, conflicts: 0 });
  });
});

describe("applyScheduleChange offline path", () => {
  it("offline: optimistic local state + one queue entry that carries the whole flow", async () => {
    setOnline(false);
    const ctx = seed({ sessions: [
      // Past completed — kept (not in toDelete because !SCHEDULED).
      { id: "s-past", patient_id: "pat-1", status: SESSION_STATUS.COMPLETED, rate: 1000, date: "1-Mar", time: "10:00" },
      // Future scheduled — will be removed by the effDate filter.
      { id: "s-fut", patient_id: "pat-1", status: SESSION_STATUS.SCHEDULED, rate: 1000, date: "15-Jun", time: "10:00" },
    ]});

    const ok = await ctx.actions.applyScheduleChange("pat-1", {
      schedules: [{ day: "Lunes", time: "11:00", duration: 60, frequency: "weekly", modality: "presencial" }],
      rate: 1200,
      effectiveDate: "2026-06-01",
      endDate: "2026-06-29",
    });

    expect(ok).toBe(true);
    // Future scheduled session removed locally; new temp rows appended.
    const rows = ctx.upcomingSessions.get();
    expect(rows.some((r: Row) => r.id === "s-fut")).toBe(false);
    expect(rows.some((r: Row) => r.id === "s-past")).toBe(true);
    const newRows = rows.filter((r: Row) => r._optimistic);
    expect(newRows.length).toBeGreaterThan(0);
    // Patient patch applied locally — rate moved.
    expect(ctx.patients.get()[0].rate).toBe(1200);
    // Single queue entry carries the whole multi-step replay.
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("sessions.apply_schedule_change");
    expect(queue.getEntries()[0].args.toDeleteIds).toEqual(["s-fut"]);
    expect(queue.getEntries()[0].args.patientPatch).toEqual({ rate: 1200, day: "Lunes", time: "11:00" });
    expect(queue.getEntries()[0].args.newRows.length).toBe(newRows.length);
    expect(mock.calls).toHaveLength(0);
  });
});

describe("finalizePatient offline path", () => {
  it("offline: removes future scheduled rows locally + enqueues sessions.finalize_patient", async () => {
    setOnline(false);
    const ctx = seed({ sessions: [
      // past completed (kept)
      { id: "s-past", patient_id: "pat-1", status: SESSION_STATUS.COMPLETED, rate: 1000, date: "1-Mar", time: "10:00" },
      // future scheduled (deleted) — inferYear picks 2026-06-15
      // (closest to runtime 2026-05-16), which is > the 2026-06-01
      // cutoff so it lands in toDelete.
      { id: "s-fut", patient_id: "pat-1", status: SESSION_STATUS.SCHEDULED, rate: 1000, date: "15-Jun", time: "10:00" },
    ]});

    const ok = await ctx.actions.finalizePatient("pat-1", "2026-06-01");

    expect(ok).toBe(true);
    // Only the future scheduled row was removed.
    expect(ctx.upcomingSessions.get().map((s: Row) => s.id)).toEqual(["s-past"]);
    // Patient status flipped optimistically.
    expect(ctx.patients.get()[0].status).toBe("ended");
    // Queue carries the multi-step op.
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("sessions.finalize_patient");
    expect(queue.getEntries()[0].args.toDeleteIds).toEqual(["s-fut"]);
    expect(queue.getEntries()[0].args.statusValue).toBe("ended");
    expect(mock.calls).toHaveLength(0);
  });
});
