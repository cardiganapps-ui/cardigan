/**
 * @vitest-environment happy-dom
 *
 * Offline-path tests for measurement mutations — the last domain hook
 * without queue support. Single-row CRUD degrades gracefully offline;
 * the CSV bulk import stays online-only and fails loudly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeSupabaseMock, makeStateHolder } from "../../test/mockSupabase";

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

const { createMeasurementActions } = await import("../useMeasurements");
const queue: Row = await import("../../lib/mutationQueue");

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true, writable: true });
}

async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

function seed({ measurements = [] as Row[] } = {}) {
  const measurementsH = makeStateHolder(measurements);
  const error = makeStateHolder("");
  const actions = createMeasurementActions(
    "user-1", measurementsH.get(), measurementsH,
    makeStateHolder(false), error,
  );
  return { actions, measurementsH, error };
}

beforeEach(async () => {
  mock.reset();
  kvStore = {};
  await queue.clearForTest();
  await queue.init();
  setOnline(true);
});

describe("createMeasurement offline path", () => {
  it("offline: inserts temp-id row + enqueues measurements.insert; no wire call", async () => {
    setOnline(false);
    const ctx = seed();

    const result = await ctx.actions.createMeasurement({
      patientId: "p-1", takenAt: "2026-07-04", weightKg: 72.5, waistCm: "",
    });
    await flush();

    expect(result).toBeTruthy();
    expect(ctx.measurementsH.get()).toHaveLength(1);
    expect(ctx.measurementsH.get()[0]._optimistic).toBe(true);
    expect(ctx.measurementsH.get()[0].id.startsWith("temp-")).toBe(true);
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("measurements.insert");
    expect(queue.getEntries()[0].args.row.weight_kg).toBe(72.5);
    // Blank fields persist as null, never 0 — chart-skew guard holds offline too.
    expect(queue.getEntries()[0].args.row.waist_cm).toBeNull();
    expect(mock.calls).toHaveLength(0);
  });

  it("draining swaps temp-id for server row", async () => {
    setOnline(false);
    const ctx = seed();
    await ctx.actions.createMeasurement({ patientId: "p-1", takenAt: "2026-07-04", weightKg: 72.5 });
    await flush();

    setOnline(true);
    mock.enqueue("measurements", { data: { id: "real-m-1", patient_id: "p-1", taken_at: "2026-07-04", weight_kg: 72.5 }, error: null });

    await queue.drain();
    await flush();

    expect(ctx.measurementsH.get()[0].id).toBe("real-m-1");
    expect(ctx.measurementsH.get()[0]._optimistic).toBeUndefined();
  });
});

describe("updateMeasurement offline paths", () => {
  it("temp-id row: patches the queued insert args instead of enqueuing an update", async () => {
    setOnline(false);
    const ctx = seed();
    await ctx.actions.createMeasurement({ patientId: "p-1", takenAt: "2026-07-04", weightKg: 72.5 });
    await flush();
    const tempId = ctx.measurementsH.get()[0].id;

    const ok = await ctx.actions.updateMeasurement(tempId, { weight_kg: 71 });

    expect(ok).toBe(true);
    expect(ctx.measurementsH.get()[0].weight_kg).toBe(71);
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("measurements.insert");
    expect(queue.getEntries()[0].args.row.weight_kg).toBe(71);
  });

  it("offline on a real row: applies optimistic patch + enqueues measurements.update", async () => {
    setOnline(false);
    const ctx = seed({ measurements: [{ id: "m-1", patient_id: "p-1", weight_kg: 72.5 }] });

    const ok = await ctx.actions.updateMeasurement("m-1", { weight_kg: 71 });

    expect(ok).toBe(true);
    expect(ctx.measurementsH.get()[0].weight_kg).toBe(71);
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("measurements.update");
    expect(mock.calls).toHaveLength(0);
  });
});

describe("deleteMeasurement offline paths", () => {
  it("temp-id row: cancels the queued insert, no delete op enqueued", async () => {
    setOnline(false);
    const ctx = seed();
    await ctx.actions.createMeasurement({ patientId: "p-1", takenAt: "2026-07-04", weightKg: 72.5 });
    await flush();
    const tempId = ctx.measurementsH.get()[0].id;

    const ok = await ctx.actions.deleteMeasurement(tempId);

    expect(ok).toBe(true);
    expect(ctx.measurementsH.get()).toHaveLength(0);
    expect(queue.getEntries()).toHaveLength(0);
  });

  it("offline on a real row: removes locally + enqueues measurements.delete", async () => {
    setOnline(false);
    const ctx = seed({ measurements: [{ id: "m-1", patient_id: "p-1" }] });

    const ok = await ctx.actions.deleteMeasurement("m-1");

    expect(ok).toBe(true);
    expect(ctx.measurementsH.get()).toHaveLength(0);
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("measurements.delete");
    expect(mock.calls).toHaveLength(0);
  });
});

describe("bulkCreateMeasurements offline", () => {
  it("refuses loudly — online-only import, nothing queued", async () => {
    setOnline(false);
    const ctx = seed();

    const res = await ctx.actions.bulkCreateMeasurements({
      patientId: "p-1",
      rows: [{ scanned_at: "2026-07-04T10:00:00Z", weight_kg: 72 }],
    });

    expect(res).toEqual({ created: 0, skipped: 1 });
    expect(ctx.error.get()).toMatch(/conexión/i);
    expect(queue.getEntries()).toHaveLength(0);
    expect(mock.calls).toHaveLength(0);
  });
});
