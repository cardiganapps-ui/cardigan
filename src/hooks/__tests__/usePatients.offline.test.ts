/**
 * @vitest-environment happy-dom
 *
 * Offline-path tests for patient mutations. Patient creation is the
 * FIRST activation action a new user takes, so it must degrade
 * gracefully offline like sessions/payments/expenses already do:
 *   • offline createPatient lands a temp patient + temp seed sessions
 *     and queues ONE patients.create op (the transactional RPC args),
 *   • drain swaps the temp rows for the server truth,
 *   • replay-after-partial-success does NOT duplicate the patient
 *     (same-name idempotency guard in the handler),
 *   • edits/deletes on a not-yet-drained temp patient patch/cancel the
 *     queued insert instead of enqueuing doomed ops,
 *   • the multi-step flows (deletePatient on a real row, potentials)
 *     stay online-only and fail loudly.
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
vi.mock("../../lib/analytics", () => ({ track: () => {} }));

const { createPatientActions } = await import("../usePatients");
const queue: Row = await import("../../lib/mutationQueue");

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true, writable: true });
}

async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

const helpers = {
  formatShortDate: (d: Date) => `${d.getUTCDate()}-Jul`,
  getRecurringDates: () => [new Date("2026-07-06T12:00:00Z"), new Date("2026-07-13T12:00:00Z")],
};

function seed({ patients = [] as Row[], sessions = [] as Row[] } = {}) {
  const patientsH = makeStateHolder(patients);
  const sessionsH = makeStateHolder(sessions);
  const mutating = makeStateHolder(false);
  const error = makeStateHolder("");
  const actions = createPatientActions(
    "user-1", patientsH.get(), patientsH,
    sessionsH.get(), sessionsH,
    [], undefined, [], undefined,
    mutating, error, helpers as Row,
  );
  return { actions, patientsH, sessionsH, error };
}

const recurringArgs = {
  rate: 500, recurring: true, startDate: "2026-07-01",
  schedules: [{ day: "Lunes", time: "16:00" }], schedulingMode: "recurring",
};

beforeEach(async () => {
  mock.reset();
  kvStore = {};
  await queue.clearForTest();
  await queue.init();
  setOnline(true);
});

describe("createPatient offline path", () => {
  it("offline: lands temp patient + temp seed sessions, queues ONE patients.create, no wire call", async () => {
    setOnline(false);
    const ctx = seed();

    const ok = await ctx.actions.createPatient({ name: "Beto", ...recurringArgs });
    await flush();

    expect(ok).toBe(true);
    expect(ctx.patientsH.get()).toHaveLength(1);
    const p = ctx.patientsH.get()[0];
    expect(p._optimistic).toBe(true);
    expect(p.id.startsWith("temp-")).toBe(true);
    expect(p.billed).toBe(1000); // 2 seeded sessions × 500
    expect(p.sessions).toBe(2);
    // Temp seed sessions share the temp- prefix so useSessions' guards apply.
    expect(ctx.sessionsH.get()).toHaveLength(2);
    expect(ctx.sessionsH.get()[0].id.startsWith("temp-")).toBe(true);
    expect(ctx.sessionsH.get()[0].patient_id).toBe(p.id);
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("patients.create");
    expect(queue.getEntries()[0].args.p_patient.name).toBe("Beto");
    expect(queue.getEntries()[0].args.p_sessions).toHaveLength(2);
    // user_id is forced server-side from the JWT — never in the RPC payload.
    expect(queue.getEntries()[0].args.p_patient.user_id).toBeUndefined();
    expect(mock.calls).toHaveLength(0);
  });

  it("draining swaps the temp patient AND its temp sessions for server rows", async () => {
    setOnline(false);
    const ctx = seed();
    await ctx.actions.createPatient({ name: "Beto", ...recurringArgs });
    await flush();
    const tempId = ctx.patientsH.get()[0].id;

    setOnline(true);
    // Handler's idempotency pre-check finds nothing → falls through to RPC.
    mock.enqueue("patients", { data: [], error: null });
    mock.enqueue("rpc:create_patient_with_sessions", {
      data: {
        patient: { id: "p-real", name: "Beto", color_idx: 0, sessions: 2, billed: 1000, rate: 500 },
        sessions: [
          { id: "s1", patient_id: "p-real", date: "6-Jul", color_idx: 0 },
          { id: "s2", patient_id: "p-real", date: "13-Jul", color_idx: 0 },
        ],
      },
      error: null,
    });

    await queue.drain();
    await flush();

    expect(ctx.patientsH.get()).toHaveLength(1);
    expect(ctx.patientsH.get()[0].id).toBe("p-real");
    expect(ctx.patientsH.get()[0]._optimistic).toBeUndefined();
    expect(ctx.sessionsH.get()).toHaveLength(2);
    expect(ctx.sessionsH.get().every((s: Row) => s.patient_id === "p-real")).toBe(true);
    expect(ctx.sessionsH.get().some((s: Row) => String(s.patient_id).startsWith("temp-") || s.patient_id === tempId)).toBe(false);
  });

  it("replay after partial success does NOT duplicate: same-name row short-circuits the RPC", async () => {
    setOnline(false);
    const ctx = seed();
    await ctx.actions.createPatient({ name: "Beto", ...recurringArgs });
    await flush();

    setOnline(true);
    // First attempt already committed server-side: the pre-check finds the row.
    mock.enqueue("patients", { data: [{ id: "p-real", name: "Beto", color_idx: 0, sessions: 2, billed: 1000 }], error: null });
    mock.enqueue("sessions", { data: [{ id: "s1", patient_id: "p-real", date: "6-Jul", color_idx: 0 }], error: null });

    await queue.drain();
    await flush();

    // No RPC fired — the existing row was returned as the result.
    expect(mock.calls.filter((c: Row) => c.rpc)).toHaveLength(0);
    expect(queue.getEntries()).toHaveLength(0);
    expect(ctx.patientsH.get()).toHaveLength(1);
    expect(ctx.patientsH.get()[0].id).toBe("p-real");
    expect(ctx.sessionsH.get()).toHaveLength(1);
    expect(ctx.sessionsH.get()[0].patient_id).toBe("p-real");
  });
});

describe("updatePatient offline paths", () => {
  it("temp-id patient: patches the queued RPC args in place (incl. seed sessions on rename)", async () => {
    setOnline(false);
    const ctx = seed();
    await ctx.actions.createPatient({ name: "Beto", ...recurringArgs });
    await flush();
    const tempId = ctx.patientsH.get()[0].id;

    const ok = await ctx.actions.updatePatient(tempId, { name: "Roberto", rate: 700 });

    expect(ok).toBe(true);
    expect(ctx.patientsH.get()[0].name).toBe("Roberto");
    // Still ONE queue entry — the insert, now carrying the edits.
    expect(queue.getEntries()).toHaveLength(1);
    const args = queue.getEntries()[0].args;
    expect(args.p_patient.name).toBe("Roberto");
    expect(args.p_patient.rate).toBe(700);
    expect(args.p_sessions.every((s: Row) => s.patient === "Roberto")).toBe(true);
    expect(mock.calls).toHaveLength(0);
  });

  it("offline on a real row: applies optimistic patch + enqueues patients.update", async () => {
    setOnline(false);
    const ctx = seed({ patients: [{ id: "p-1", name: "Ana", phone: "", rate: 500 }] });

    const ok = await ctx.actions.updatePatient("p-1", { phone: "5512345678" });

    expect(ok).toBe(true);
    expect(ctx.patientsH.get()[0].phone).toBe("5512345678");
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("patients.update");
    expect(queue.getEntries()[0].args.patch.phone).toBe("5512345678");
    expect(mock.calls).toHaveLength(0);
  });
});

describe("deletePatient offline paths", () => {
  it("temp-id patient: cancels the queued insert + purges local rows, nothing hits the wire", async () => {
    setOnline(false);
    const ctx = seed();
    await ctx.actions.createPatient({ name: "Beto", ...recurringArgs });
    await flush();
    const tempId = ctx.patientsH.get()[0].id;

    const ok = await ctx.actions.deletePatient(tempId);

    expect(ok).toBe(true);
    expect(ctx.patientsH.get()).toHaveLength(0);
    expect(ctx.sessionsH.get()).toHaveLength(0);
    expect(queue.getEntries()).toHaveLength(0);
    expect(mock.calls).toHaveLength(0);
  });

  it("real row offline: refuses loudly (online-only cascade), no wire call", async () => {
    setOnline(false);
    const ctx = seed({ patients: [{ id: "p-1", name: "Ana" }] });

    const ok = await ctx.actions.deletePatient("p-1");

    expect(ok).toBe(false);
    expect(ctx.error.get()).toMatch(/conexión/i);
    expect(ctx.patientsH.get()).toHaveLength(1);
    expect(queue.getEntries()).toHaveLength(0);
    expect(mock.calls).toHaveLength(0);
  });
});
