/**
 * @vitest-environment happy-dom
 *
 * Offline-path tests for createPayment — exercises the Phase 1 mutation
 * queue (src/lib/mutationQueue.js). happy-dom for `navigator.onLine`
 * + the IndexedDB shim (mocked below).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeSupabaseMock, makeStateHolder } from "../../test/mockSupabase";

const mock = makeSupabaseMock();

// Mock idbKv to in-memory storage so the queue persists without a real
// IndexedDB. Mirror the pattern used in mutationQueue.test.js.
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

const { createPaymentActions } = await import("../usePayments");
const queue = await import("../../lib/mutationQueue.js");

function setOnline(value) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true, writable: true });
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function seed({ payments: initialPayments = [] } = {}) {
  const patient = { id: "pat-1", name: "Ana López", initials: "AL", rate: 1000, paid: 500, sessions: 4, billed: 4000, colorIdx: 0 };
  const patients = makeStateHolder([patient]);
  const payments = makeStateHolder(initialPayments);
  const actions = createPaymentActions(
    "user-1", patients.get(), patients, payments.get(), payments,
    makeStateHolder(false), makeStateHolder(""),
  );
  return { actions, patient, patients, payments };
}

beforeEach(async () => {
  mock.reset();
  kvStore = {};
  await queue.clearForTest();
  await queue.init();
});

describe("createPayment offline path", () => {
  it("when navigator.onLine === false: enqueues the insert + optimistic state still applies", async () => {
    setOnline(false);
    const ctx = seed();

    const ok = await ctx.actions.createPayment({
      patientName: "Ana López", amount: 300, method: "transferencia", date: "8-Abr",
    });
    await flush();

    expect(ok).toBe(true);
    // Optimistic state in place
    expect(ctx.payments.get()).toHaveLength(1);
    expect(ctx.payments.get()[0]._optimistic).toBe(true);
    expect(ctx.patients.get()[0].paid).toBe(800);
    // Queue has the pending entry — no network call was made.
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("payments.insert");
    expect(queue.getEntries()[0].args.row.amount).toBe(300);
    expect(mock.calls).toHaveLength(0);
  });

  it("draining the queue replays the insert and swaps the temp row for the server row", async () => {
    setOnline(false);
    const ctx = seed();
    await ctx.actions.createPayment({
      patientName: "Ana López", amount: 300, method: "transferencia", date: "8-Abr",
    });
    await flush();

    const tempId = ctx.payments.get()[0].id;
    expect(tempId.startsWith("temp-")).toBe(true);

    // Now "come back online" and prime the queue's network response.
    setOnline(true);
    mock.enqueue("payments", { data: { id: "real-99", patient_id: "pat-1", patient: "Ana López", amount: 300, date: "8-Abr", method: "transferencia", color_idx: 0 }, error: null });

    const result = await queue.drain();
    await flush();

    expect(result).toEqual({ drained: 1, remaining: 0 });
    // Replay reconciler swapped temp id → real id.
    expect(ctx.payments.get()[0].id).toBe("real-99");
    expect(ctx.payments.get()[0]._optimistic).toBeUndefined();
  });

  it("fetch failure mid-flight falls back to the queue (transport error)", async () => {
    setOnline(true);
    const ctx = seed();

    // Make the insert throw — simulates a fetch() rejection (network
    // drop after the request started but before headers arrived).
    mock.enqueue("payments", () => { throw new Error("fetch failed"); });

    await ctx.actions.createPayment({
      patientName: "Ana López", amount: 300, method: "transferencia", date: "8-Abr",
    });
    await flush();

    // Queued for retry — optimistic state still in place.
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("payments.insert");
    expect(ctx.payments.get()).toHaveLength(1);
  });
});

describe("deletePayment offline path", () => {
  it("offline: removes locally + enqueues a payments.delete; no network call", async () => {
    setOnline(false);
    const ctx = seed({ payments: [{ id: "pmt-real", patient_id: "pat-1", amount: 200, version: 1 }] });

    const ok = await ctx.actions.deletePayment("pmt-real");

    expect(ok).toBe(true);
    expect(ctx.payments.get()).toHaveLength(0);
    expect(ctx.patients.get()[0].paid).toBe(300); // 500 - 200
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("payments.delete");
    expect(queue.getEntries()[0].args.id).toBe("pmt-real");
    expect(mock.calls).toHaveLength(0);
  });

  it("deleting a temp-id row removes locally without queuing (no real row exists)", async () => {
    setOnline(true);
    const ctx = seed({ payments: [{ id: "temp-abc", patient_id: "pat-1", amount: 200 }] });

    const ok = await ctx.actions.deletePayment("temp-abc");

    expect(ok).toBe(true);
    expect(ctx.payments.get()).toHaveLength(0);
    expect(queue.getEntries()).toHaveLength(0);
    expect(mock.calls).toHaveLength(0);
  });
});

describe("updatePayment offline path", () => {
  it("offline: queues with last-write-wins semantics (no version filter)", async () => {
    setOnline(false);
    const ctx = seed({ payments: [{ id: "pmt-real", patient_id: "pat-1", patient: "Ana López", amount: 300, date: "8-Abr", method: "transferencia", version: 5 }] });

    const ok = await ctx.actions.updatePayment("pmt-real", {
      patientName: "Ana López", amount: 450, method: "transferencia", date: "9-Abr", note: "",
    });

    expect(ok).toBe(true);
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("payments.update");
    expect(queue.getEntries()[0].args.patch.amount).toBe(450);
    // No version filter persisted — replay is last-write-wins.
    expect(queue.getEntries()[0].args).not.toHaveProperty("expectedVersion");
    expect(mock.calls).toHaveLength(0);
  });
});
