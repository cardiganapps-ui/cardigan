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

const mock = makeSupabaseMock();

let kvStore = {};
vi.mock("../../lib/idbKv.js", () => ({
  kvGet: async (k) => kvStore[k],
  kvSet: async (k, v) => { kvStore[k] = v; },
  kvDelete: async (k) => { delete kvStore[k]; },
  kvAvailable: async () => true,
}));

vi.mock("../../supabaseClient", () => ({
  get supabase() { return mock.supabase; },
}));
vi.mock("../../utils/patients", () => ({
  recalcPatientCounters: async () => null,
}));

const { createSessionActions } = await import("../useSessions");
const queue = await import("../../lib/mutationQueue.js");

function setOnline(value) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true, writable: true });
}

async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

function seed({ sessions = [] } = {}) {
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
    });
    expect(queue.getEntries()[0].args).not.toHaveProperty("expectedVersion");
    // No RPC call hit the wire.
    const rpcCalls = mock.calls.filter((c) => c.rpc);
    expect(rpcCalls).toHaveLength(0);
  });
});
