import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeSupabaseMock, makeStateHolder } from "../../test/mockSupabase";

// Shared across the mocked modules. Reset in beforeEach.
const mock = makeSupabaseMock();
const recalcPatientCounters = vi.fn(async () => null);

vi.mock("../../supabaseClient", () => ({
  get supabase() { return mock.supabase; },
}));
vi.mock("../../utils/patients", () => ({
  recalcPatientCounters: (...args) => recalcPatientCounters(...args),
}));

// Pull the factory AFTER the mocks are registered.
const { createPaymentActions } = await import("../usePayments");

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function seed({ payments: initialPayments = [] } = {}) {
  const patient = {
    id: "pat-1",
    name: "Ana López",
    initials: "AL",
    rate: 1000,
    paid: 500,
    sessions: 4,
    billed: 4000,
    colorIdx: 2,
  };
  const patients = makeStateHolder([patient]);
  const payments = makeStateHolder(initialPayments);
  const mutating = makeStateHolder(false);
  const mutationError = makeStateHolder("");
  const actions = createPaymentActions(
    "user-1",
    patients.get(),
    patients,
    payments.get(),
    payments,
    mutating,
    mutationError,
  );
  return { actions, patient, patients, payments, mutating, mutationError };
}

beforeEach(() => {
  mock.reset();
  recalcPatientCounters.mockReset();
  recalcPatientCounters.mockResolvedValue(null);
});

describe("createPayment", () => {
  it("happy path: optimistic insert, patient.paid bumps, temp id swapped", async () => {
    const ctx = seed();
    // After migration 068 the trigger maintains patient.paid — only
    // the payments insert hits the wire from the hook side. Don't
    // enqueue a patients response; an extra (unconsumed) enqueue would
    // mask a regression that re-introduced the JS patient UPDATE.
    mock.enqueue("payments", { data: { id: "real-1", user_id: "user-1", patient_id: "pat-1", patient: "Ana López", initials: "AL", amount: 300, date: "8-Abr", method: "transferencia", note: null, color_idx: 2 }, error: null });

    const ok = await ctx.actions.createPayment({ patientName: "Ana López", amount: 300, method: "transferencia", date: "8-Abr" });
    expect(ok).toBe(true);

    // Optimistic state applied synchronously (before IIFE).
    expect(ctx.payments.get()).toHaveLength(1);
    expect(ctx.payments.get()[0]._optimistic).toBe(true);
    expect(ctx.patients.get()[0].paid).toBe(800);

    await flush();

    // Temp row swapped for server row.
    const [row] = ctx.payments.get();
    expect(row.id).toBe("real-1");
    expect(row.colorIdx).toBe(2);
    expect(row._optimistic).toBeUndefined();
  });

  it("server insert error: row removed, patient.paid reverts, error surfaced", async () => {
    const ctx = seed();
    mock.enqueue("payments", { data: null, error: { message: "Network fail" } });

    const ok = await ctx.actions.createPayment({ patientName: "Ana López", amount: 300 });
    expect(ok).toBe(true); // optimistic path always returns true

    await flush();

    expect(ctx.payments.get()).toHaveLength(0);
    expect(ctx.patients.get()[0].paid).toBe(500);
    expect(ctx.mutationError.get()).toBe("Network fail");
  });

  // Migration 068 — patient.paid is now maintained by a DB trigger
  // (trg_payments_recalc_paid) instead of a follow-up patients UPDATE
  // from JS. The prior "second-stage patient update failure"
  // regression test is removed because the code path it exercised no
  // longer exists: createPayment makes exactly one network call (the
  // payments insert) and the trigger atomically recomputes paid.
});

describe("deletePayment", () => {
  it("happy path: removes row and decrements patient.paid", async () => {
    const ctx = seed({ payments: [{ id: "pmt-1", patient_id: "pat-1", amount: 200 }] });

    // Single network call after migration 068 — trigger handles paid.
    mock.enqueue("payments", { error: null });

    const ok = await ctx.actions.deletePayment("pmt-1");
    await flush();

    expect(ok).toBe(true);
    expect(ctx.payments.get()).toHaveLength(0);
    expect(ctx.patients.get()[0].paid).toBe(300);
  });

  // Migration 068 — patient.paid is now maintained by a DB trigger
  // (trg_payments_recalc_paid). deletePayment no longer issues a
  // patients UPDATE, so the prior "patient update failed → recalc"
  // case is gone. The trigger fires on the payment DELETE atomically.
});

describe("updatePayment", () => {
  it("reassigns payment from patient A to patient B: A.paid -= old, B.paid += new", async () => {
    const patientA = { id: "pat-A", name: "Ana López", initials: "AL", rate: 1000, paid: 500, sessions: 4, billed: 4000, colorIdx: 0 };
    const patientB = { id: "pat-B", name: "Beto Pérez", initials: "BP", rate: 1200, paid: 100, sessions: 2, billed: 2400, colorIdx: 1 };
    const patients = makeStateHolder([patientA, patientB]);
    const payments = makeStateHolder([{ id: "pmt-1", patient_id: "pat-A", patient: "Ana López", amount: 300, date: "8-Abr", method: "transferencia" }]);
    const actions = createPaymentActions("user-1", patients.get(), patients, payments.get(), payments, makeStateHolder(false), makeStateHolder(""));

    // Single payments UPDATE — the trigger handles both A.paid and
    // B.paid recompute atomically (cross-patient branch).
    mock.enqueue("payments", { data: { id: "pmt-1", user_id: "user-1", patient_id: "pat-B", patient: "Beto Pérez", amount: 400, date: "9-Abr", method: "efectivo", color_idx: 1 }, error: null });

    await actions.updatePayment("pmt-1", { patientName: "Beto Pérez", amount: 400, method: "efectivo", date: "9-Abr", note: "" });
    await flush();

    const [a, b] = patients.get();
    expect(a.paid).toBe(200); // 500 - 300
    expect(b.paid).toBe(500); // 100 + 400
  });

  it("same patient different amount: net math does not double-apply (guards line 133 branch)", async () => {
    const patient = { id: "pat-1", name: "Ana López", initials: "AL", rate: 1000, paid: 500, sessions: 4, billed: 4000, colorIdx: 0 };
    const patients = makeStateHolder([patient]);
    const payments = makeStateHolder([{ id: "pmt-1", patient_id: "pat-1", patient: "Ana López", amount: 300, date: "8-Abr", method: "transferencia" }]);
    const actions = createPaymentActions("user-1", patients.get(), patients, payments.get(), payments, makeStateHolder(false), makeStateHolder(""));

    mock.enqueue("payments", { data: { id: "pmt-1", user_id: "user-1", patient_id: "pat-1", patient: "Ana López", amount: 450, date: "8-Abr", method: "transferencia", color_idx: 0 }, error: null });

    await actions.updatePayment("pmt-1", { patientName: "Ana López", amount: 450, method: "transferencia", date: "8-Abr", note: "" });
    await flush();

    // Correct: 500 - 300 + 450 = 650. Wrong (if branch mis-nets): 500 + 150 = 650 or 500 - 300 + 450 + 450.
    expect(patients.get()[0].paid).toBe(650);
  });

  // Optimistic locking (migration 066). When the .eq("version", v)
  // filter matches zero rows, supabase-js returns { data: null, error:
  // null }. The hook must refetch the row, replace local state with
  // server truth, restore the patient.paid snapshot, and surface a
  // friendly "edited elsewhere" toast.
  it("version conflict: refetches row, replaces local state, restores patient.paid", async () => {
    const patient = { id: "pat-1", name: "Ana López", initials: "AL", rate: 1000, paid: 500, sessions: 4, billed: 4000, colorIdx: 0 };
    const patients = makeStateHolder([patient]);
    const payments = makeStateHolder([{ id: "pmt-1", patient_id: "pat-1", patient: "Ana López", amount: 300, date: "8-Abr", method: "transferencia", version: 3 }]);
    const actions = createPaymentActions("user-1", patients.get(), patients, payments.get(), payments, makeStateHolder(false), makeStateHolder(""));

    // First payments response: the update returned 0 rows (version
    // mismatch). Second: the reconciler refetches and gets a fresh row
    // (amount edited to 400 by another tab; version bumped to 4).
    mock.enqueue("payments", { data: null, error: null });
    mock.enqueue("payments", { data: { id: "pmt-1", patient_id: "pat-1", patient: "Ana López", amount: 400, date: "8-Abr", method: "transferencia", color_idx: 0, version: 4 }, error: null });

    await actions.updatePayment("pmt-1", { patientName: "Ana López", amount: 600, method: "transferencia", date: "8-Abr", note: "" });
    await flush();

    // Local row matches server truth (400), not the user's attempted edit (600).
    expect(payments.get()[0].amount).toBe(400);
    expect(payments.get()[0].version).toBe(4);
    // patient.paid snapped back to the pre-attempt value (recalc would
    // refine, but the seed is the pre-mutation snapshot).
    expect(patients.get()[0].paid).toBe(500);
  });

  it("version conflict on a deleted row: drops locally with 'ya no existe'", async () => {
    const patient = { id: "pat-1", name: "Ana López", initials: "AL", rate: 1000, paid: 500, sessions: 4, billed: 4000, colorIdx: 0 };
    const patients = makeStateHolder([patient]);
    const payments = makeStateHolder([{ id: "pmt-1", patient_id: "pat-1", patient: "Ana López", amount: 300, date: "8-Abr", method: "transferencia", version: 3 }]);
    const mutationError = makeStateHolder("");
    const actions = createPaymentActions("user-1", patients.get(), patients, payments.get(), payments, makeStateHolder(false), mutationError);

    // First: 0 rows. Second: refetch returns null (row deleted).
    mock.enqueue("payments", { data: null, error: null });
    mock.enqueue("payments", { data: null, error: null });

    await actions.updatePayment("pmt-1", { patientName: "Ana López", amount: 600, method: "transferencia", date: "8-Abr", note: "" });
    await flush();

    expect(payments.get()).toHaveLength(0);
    expect(mutationError.get()).toMatch(/ya no existe/);
  });
});
