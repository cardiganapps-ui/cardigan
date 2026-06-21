/**
 * @vitest-environment happy-dom
 *
 * Coverage for the softDelete* contracts added across the four
 * everyday-destructive domains: sessions, payments, expenses, notes.
 * Each soft variant applies optimistic state immediately and returns
 * { commit, undo } so the App-level orchestrator can wire a 5-second
 * "Deshacer" toast. The tests below verify the per-domain promises:
 *   • Optimistic remove happens on softDelete*() call (synchronously).
 *   • undo() restores the row + any patient counter snapshot.
 *   • commit() fires the supabase call (or queues offline).
 *   • Commit-after-undo is a no-op; undo-after-commit is a no-op.
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
vi.mock("../../utils/patients", () => ({ recalcPatientCounters: async () => null }));
vi.mock("../../utils/heicConvert", () => ({ maybeConvertHeic: async (f) => f }));

const { createSessionActions } = await import("../useSessions");
const { createPaymentActions } = await import("../usePayments");
const { createExpenseActions } = await import("../useExpenses");
const { createNoteActions } = await import("../useNotes");
const queue = await import("../../lib/mutationQueue");

function setOnline(value) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true, writable: true });
}

async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

beforeEach(async () => {
  mock.reset();
  kvStore = {};
  await queue.clearForTest();
  await queue.init();
  setOnline(true);
});

// ── softDeleteSession ───────────────────────────────────────────────
describe("softDeleteSession", () => {
  function seed() {
    const patient = { id: "pat-1", name: "Ana López", initials: "AL", rate: 1000, paid: 500, sessions: 4, billed: 4000, colorIdx: 0 };
    const patients = makeStateHolder([patient]);
    const upcomingSessions = makeStateHolder([
      { id: "s-1", patient_id: "pat-1", status: SESSION_STATUS.COMPLETED, rate: 1000, date: "1-Mar", time: "10:00" },
    ]);
    const actions = createSessionActions(
      "user-1", patients.get(), patients,
      upcomingSessions.get(), upcomingSessions,
      makeStateHolder(false), makeStateHolder(""),
    );
    return { actions, patients, upcomingSessions };
  }

  it("optimistic remove happens synchronously; undo restores session + patient counters", () => {
    const ctx = seed();
    const handle = ctx.actions.softDeleteSession("s-1");

    // Optimistic: session gone, patient.sessions decremented, patient.billed
    // dropped by rate (session was COMPLETED → counted).
    expect(ctx.upcomingSessions.get()).toHaveLength(0);
    expect(ctx.patients.get()[0].sessions).toBe(3);
    expect(ctx.patients.get()[0].billed).toBe(3000);

    handle.undo();

    // Both restored exactly.
    expect(ctx.upcomingSessions.get()).toHaveLength(1);
    expect(ctx.upcomingSessions.get()[0].id).toBe("s-1");
    expect(ctx.patients.get()[0].sessions).toBe(4);
    expect(ctx.patients.get()[0].billed).toBe(4000);
  });

  it("commit fires the supabase delete; no wire call before commit", async () => {
    const ctx = seed();
    const handle = ctx.actions.softDeleteSession("s-1");
    expect(mock.calls).toHaveLength(0); // optimistic only, no network yet

    await handle.commit();

    const dels = mock.calls.filter(c => c.table === "sessions" && c.ops.some(o => o.op === "delete"));
    expect(dels).toHaveLength(1);
  });

  it("commit-after-undo is a no-op (no wire call, no double restore)", async () => {
    const ctx = seed();
    const handle = ctx.actions.softDeleteSession("s-1");
    handle.undo();
    await handle.commit();

    expect(mock.calls).toHaveLength(0);
    expect(ctx.upcomingSessions.get()).toHaveLength(1);
  });

  it("undo-after-commit is a no-op (the row stays gone)", async () => {
    const ctx = seed();
    mock.enqueue("sessions", { error: null });
    const handle = ctx.actions.softDeleteSession("s-1");
    await handle.commit();
    handle.undo();
    await flush();

    expect(ctx.upcomingSessions.get()).toHaveLength(0);
  });

  it("offline: commit enqueues sessions.delete instead of hitting the wire", async () => {
    setOnline(false);
    const ctx = seed();
    const handle = ctx.actions.softDeleteSession("s-1");
    await handle.commit();

    expect(mock.calls).toHaveLength(0);
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("sessions.delete");
  });
});

// ── softDeletePayment ───────────────────────────────────────────────
describe("softDeletePayment", () => {
  function seed() {
    const patient = { id: "pat-1", name: "Ana López", initials: "AL", rate: 1000, paid: 500, sessions: 4, billed: 4000, colorIdx: 0 };
    const patients = makeStateHolder([patient]);
    const payments = makeStateHolder([{ id: "pmt-1", patient_id: "pat-1", amount: 200 }]);
    const actions = createPaymentActions(
      "user-1", patients.get(), patients, payments.get(), payments,
      makeStateHolder(false), makeStateHolder(""),
    );
    return { actions, patients, payments };
  }

  it("optimistic remove + patient.paid decrement; undo restores both", () => {
    const ctx = seed();
    const handle = ctx.actions.softDeletePayment("pmt-1");

    expect(ctx.payments.get()).toHaveLength(0);
    expect(ctx.patients.get()[0].paid).toBe(300); // 500 - 200

    handle.undo();
    expect(ctx.payments.get()).toHaveLength(1);
    expect(ctx.patients.get()[0].paid).toBe(500);
  });

  it("commit fires the supabase delete", async () => {
    const ctx = seed();
    const handle = ctx.actions.softDeletePayment("pmt-1");
    await handle.commit();

    const dels = mock.calls.filter(c => c.table === "payments" && c.ops.some(o => o.op === "delete"));
    expect(dels).toHaveLength(1);
  });
});

// ── softDeleteExpense ───────────────────────────────────────────────
describe("softDeleteExpense", () => {
  function seed({ withReceipt = false } = {}) {
    const expenses = makeStateHolder([{
      id: "e-1", amount: 500, category: "consultorio", date: "8-Abr",
      receipt_document_id: withReceipt ? "doc-1" : null,
    }]);
    const deleteDocument = vi.fn(async () => true);
    const actions = createExpenseActions({
      userId: "user-1",
      expenses: expenses.get(), setExpenses: expenses,
      recurringExpenses: [], setRecurringExpenses: makeStateHolder([]),
      deleteDocument,
      setMutating: makeStateHolder(false), setMutationError: makeStateHolder(""),
    });
    return { actions, expenses, deleteDocument };
  }

  it("optimistic remove + undo restore work as expected", () => {
    const ctx = seed();
    const handle = ctx.actions.softDeleteExpense("e-1");

    expect(ctx.expenses.get()).toHaveLength(0);
    handle.undo();
    expect(ctx.expenses.get()).toHaveLength(1);
  });

  it("commit calls supabase delete + cascades the receipt document", async () => {
    const ctx = seed({ withReceipt: true });
    const handle = ctx.actions.softDeleteExpense("e-1");
    await handle.commit();

    const dels = mock.calls.filter(c => c.table === "expenses" && c.ops.some(o => o.op === "delete"));
    expect(dels).toHaveLength(1);
    expect(ctx.deleteDocument).toHaveBeenCalledWith("doc-1");
  });

  it("undo skips the receipt cascade — receipt stays intact if user reverts", async () => {
    const ctx = seed({ withReceipt: true });
    const handle = ctx.actions.softDeleteExpense("e-1");
    handle.undo();
    await flush();

    expect(ctx.deleteDocument).not.toHaveBeenCalled();
  });
});

// ── softDeleteNote ──────────────────────────────────────────────────
describe("softDeleteNote", () => {
  function seed() {
    const notes = makeStateHolder([{ id: "n-1", title: "Plan", content: "X" }]);
    const actions = createNoteActions(
      "user-1", notes.get(), notes,
      makeStateHolder(false), makeStateHolder(""), null,
    );
    return { actions, notes };
  }

  it("optimistic remove + undo restore work as expected", () => {
    const ctx = seed();
    const handle = ctx.actions.softDeleteNote("n-1");

    expect(ctx.notes.get()).toHaveLength(0);
    handle.undo();
    expect(ctx.notes.get()).toHaveLength(1);
  });

  it("commit fires the supabase delete", async () => {
    const ctx = seed();
    const handle = ctx.actions.softDeleteNote("n-1");
    await handle.commit();

    const dels = mock.calls.filter(c => c.table === "notes" && c.ops.some(o => o.op === "delete"));
    expect(dels).toHaveLength(1);
  });

  it("temp-id soft delete: commit is local-only, no wire call", async () => {
    const notes = makeStateHolder([{ id: "temp-x", title: "Plan", content: "X" }]);
    const actions = createNoteActions("user-1", notes.get(), notes, makeStateHolder(false), makeStateHolder(""), null);

    const handle = actions.softDeleteNote("temp-x");
    expect(notes.get()).toHaveLength(0);
    await handle.commit();

    expect(mock.calls).toHaveLength(0);
    expect(queue.getEntries()).toHaveLength(0);
  });
});
