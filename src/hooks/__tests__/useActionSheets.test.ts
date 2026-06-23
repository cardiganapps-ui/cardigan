/**
 * @vitest-environment happy-dom
 *
 * useActionSheets — the app-level payment / expense / recurring-expense /
 * quick-schedule sheet state extracted from AppShell. Pins the readOnly
 * gating on every write opener, the record-vs-edit draft seeding, and the
 * quick-schedule path (no readOnly guard, no-ops on null).
 */
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useActionSheets } from "../useActionSheets";

afterEach(cleanup);

describe("useActionSheets", () => {
  it("openRecordPaymentModal seeds the draft from the patient and opens", () => {
    const { result } = renderHook(() => useActionSheets(false));
    act(() => result.current.openRecordPaymentModal({ name: "Ana", amountDue: 500 }));
    expect(result.current.paymentModalOpen).toBe(true);
    expect(result.current.editingPayment).toBeNull();
    expect(result.current.paymentDraft).toEqual({ patientName: "Ana", amount: "500" });
  });

  it("openEditPaymentModal sets editing + clears the draft", () => {
    const { result } = renderHook(() => useActionSheets(false));
    const payment = { id: "pay1", amount: 300 };
    act(() => result.current.openEditPaymentModal(payment));
    expect(result.current.paymentModalOpen).toBe(true);
    expect(result.current.editingPayment).toBe(payment);
    expect(result.current.paymentDraft).toEqual({ patientName: "", amount: "" });
  });

  it("readOnly gates every write opener (no state change)", () => {
    const { result } = renderHook(() => useActionSheets(true));
    act(() => {
      result.current.openRecordPaymentModal({ name: "Ana", amountDue: 9 });
      result.current.openEditPaymentModal({ id: "x" });
      result.current.openRecordExpenseModal();
      result.current.openEditExpenseModal({ id: "e" });
      result.current.openRecurringExpenseSheet();
    });
    expect(result.current.paymentModalOpen).toBe(false);
    expect(result.current.expenseSheetOpen).toBe(false);
    expect(result.current.recurringExpenseSheetOpen).toBe(false);
    expect(result.current.editingPayment).toBeNull();
    expect(result.current.editingExpense).toBeNull();
  });

  it("expense openers distinguish record (null) vs edit (the expense)", () => {
    const { result } = renderHook(() => useActionSheets(false));
    act(() => result.current.openRecordExpenseModal());
    expect(result.current.expenseSheetOpen).toBe(true);
    expect(result.current.editingExpense).toBeNull();
    const exp = { id: "e1" };
    act(() => result.current.openEditExpenseModal(exp));
    expect(result.current.editingExpense).toBe(exp);
  });

  it("quick-schedule opens for a patient and no-ops on null (ignores readOnly)", () => {
    const { result } = renderHook(() => useActionSheets(true));
    act(() => result.current.openQuickSchedule(null));
    expect(result.current.quickScheduleFor).toBeNull();
    const patient = { id: "p1" };
    act(() => result.current.openQuickSchedule(patient));
    expect(result.current.quickScheduleFor).toBe(patient);
  });

  it("the openers are referentially stable across renders for the same readOnly", () => {
    const { result, rerender } = renderHook(({ ro }) => useActionSheets(ro), { initialProps: { ro: false } });
    const first = result.current.openRecordPaymentModal;
    rerender({ ro: false });
    expect(result.current.openRecordPaymentModal).toBe(first);
    rerender({ ro: true });
    expect(result.current.openRecordPaymentModal).not.toBe(first);
  });
});
