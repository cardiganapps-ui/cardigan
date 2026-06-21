/**
 * @vitest-environment happy-dom
 *
 * Offline-path tests for expense mutations (Phase 4 of offline support).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeSupabaseMock, makeStateHolder } from "../../test/mockSupabase";

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

const { createExpenseActions } = await import("../useExpenses");
const queue = await import("../../lib/mutationQueue");

function setOnline(value) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true, writable: true });
}

async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

function seed({ expenses: initialExpenses = [] } = {}) {
  const expenses = makeStateHolder(initialExpenses);
  const actions = createExpenseActions({
    userId: "user-1",
    expenses: expenses.get(), setExpenses: expenses,
    recurringExpenses: [], setRecurringExpenses: makeStateHolder([]),
    deleteDocument: null,
    setMutating: makeStateHolder(false),
    setMutationError: makeStateHolder(""),
  });
  return { actions, expenses };
}

beforeEach(async () => {
  mock.reset();
  kvStore = {};
  await queue.clearForTest();
  await queue.init();
  setOnline(true);
});

describe("createExpense offline path", () => {
  it("offline: inserts temp-id row + enqueues expenses.insert; no wire call", async () => {
    setOnline(false);
    const ctx = seed();

    const ok = await ctx.actions.createExpense({
      amount: 500, category: "consultorio", date: "8-Abr",
      description: "Renta",
    });
    await flush();

    expect(ok).toBe(true);
    expect(ctx.expenses.get()).toHaveLength(1);
    expect(ctx.expenses.get()[0]._optimistic).toBe(true);
    expect(ctx.expenses.get()[0].id.startsWith("temp-")).toBe(true);
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("expenses.insert");
    expect(queue.getEntries()[0].args.row.amount).toBe(500);
    expect(mock.calls).toHaveLength(0);
  });

  it("draining swaps temp-id for server row", async () => {
    setOnline(false);
    const ctx = seed();
    await ctx.actions.createExpense({ amount: 500, category: "consultorio", date: "8-Abr" });
    await flush();

    setOnline(true);
    mock.enqueue("expenses", { data: { id: "real-e-1", amount: 500, category: "consultorio", date: "8-Abr" }, error: null });

    await queue.drain();
    await flush();

    expect(ctx.expenses.get()[0].id).toBe("real-e-1");
    expect(ctx.expenses.get()[0]._optimistic).toBeUndefined();
  });
});

describe("updateExpense offline path", () => {
  it("offline: applies optimistic patch + enqueues expenses.update", async () => {
    setOnline(false);
    const ctx = seed({ expenses: [
      { id: "e-1", amount: 500, category: "consultorio", date: "8-Abr", description: "old", tax_treatment: "deductible" },
    ]});

    const ok = await ctx.actions.updateExpense("e-1", { amount: 750, description: "new" });

    expect(ok).toBe(true);
    expect(ctx.expenses.get()[0].amount).toBe(750);
    expect(ctx.expenses.get()[0].description).toBe("new");
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("expenses.update");
    expect(queue.getEntries()[0].args.patch.amount).toBe(750);
    expect(mock.calls).toHaveLength(0);
  });
});

describe("deleteExpense offline path", () => {
  it("offline: removes locally + enqueues expenses.delete", async () => {
    setOnline(false);
    const ctx = seed({ expenses: [{ id: "e-1", amount: 500, category: "consultorio", date: "8-Abr" }] });

    const ok = await ctx.actions.deleteExpense("e-1");

    expect(ok).toBe(true);
    expect(ctx.expenses.get()).toHaveLength(0);
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("expenses.delete");
  });
});
