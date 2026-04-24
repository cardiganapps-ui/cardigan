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
    mock.enqueue("payments", { data: { id: "real-1", user_id: "user-1", patient_id: "pat-1", patient: "Ana López", initials: "AL", amount: 300, date: "8-Abr", method: "transferencia", note: null, color_idx: 2 }, error: null });
    mock.enqueue("patients", { error: null });

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

  it("second-stage patient update failure triggers recalcPatientCounters", async () => {
    const ctx = seed();
    mock.enqueue("payments", { data: { id: "real-1", user_id: "user-1", patient_id: "pat-1", patient: "Ana López", amount: 300, color_idx: 2 }, error: null });
    mock.enqueue("patients", { error: { message: "boom" } });
    recalcPatientCounters.mockResolvedValue({ sessions: 4, billed: 4000, paid: 800 });

    await ctx.actions.createPayment({ patientName: "Ana López", amount: 300 });
    await flush();

    expect(recalcPatientCounters).toHaveBeenCalledWith("pat-1");
    expect(ctx.patients.get()[0].paid).toBe(800);
  });
});

describe("deletePayment", () => {
  it("happy path: removes row and decrements patient.paid", async () => {
    const ctx = seed({ payments: [{ id: "pmt-1", patient_id: "pat-1", amount: 200 }] });

    mock.enqueue("payments", { error: null });
    mock.enqueue("patients", { error: null });

    const ok = await ctx.actions.deletePayment("pmt-1");
    await flush();

    expect(ok).toBe(true);
    expect(ctx.payments.get()).toHaveLength(0);
    expect(ctx.patients.get()[0].paid).toBe(300);
  });

  it("second-stage patient update failure triggers recalcPatientCounters", async () => {
    const ctx = seed({ payments: [{ id: "pmt-1", patient_id: "pat-1", amount: 200 }] });
    mock.enqueue("payments", { error: null });
    mock.enqueue("patients", { error: { message: "boom" } });
    recalcPatientCounters.mockResolvedValue({ sessions: 4, billed: 4000, paid: 300 });

    await ctx.actions.deletePayment("pmt-1");
    await flush();

    expect(recalcPatientCounters).toHaveBeenCalledWith("pat-1");
    expect(ctx.patients.get()[0].paid).toBe(300);
  });
});

describe("updatePayment", () => {
  it("reassigns payment from patient A to patient B: A.paid -= old, B.paid += new", async () => {
    const patientA = { id: "pat-A", name: "Ana López", initials: "AL", rate: 1000, paid: 500, sessions: 4, billed: 4000, colorIdx: 0 };
    const patientB = { id: "pat-B", name: "Beto Pérez", initials: "BP", rate: 1200, paid: 100, sessions: 2, billed: 2400, colorIdx: 1 };
    const patients = makeStateHolder([patientA, patientB]);
    const payments = makeStateHolder([{ id: "pmt-1", patient_id: "pat-A", patient: "Ana López", amount: 300, date: "8-Abr", method: "transferencia" }]);
    const actions = createPaymentActions("user-1", patients.get(), patients, payments.get(), payments, makeStateHolder(false), makeStateHolder(""));

    mock.enqueue("payments", { data: { id: "pmt-1", user_id: "user-1", patient_id: "pat-B", patient: "Beto Pérez", amount: 400, date: "9-Abr", method: "efectivo", color_idx: 1 }, error: null });
    mock.enqueue("patients", { error: null });
    mock.enqueue("patients", { error: null });

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
    mock.enqueue("patients", { error: null });

    await actions.updatePayment("pmt-1", { patientName: "Ana López", amount: 450, method: "transferencia", date: "8-Abr", note: "" });
    await flush();

    // Correct: 500 - 300 + 450 = 650. Wrong (if branch mis-nets): 500 + 150 = 650 or 500 - 300 + 450 + 450.
    expect(patients.get()[0].paid).toBe(650);
  });
});
