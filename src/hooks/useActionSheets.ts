import { useState, useCallback } from "react";

/* ── useActionSheets ──────────────────────────────────────────────────
   The app-level "action sheet" state that used to live inline in
   AppShell: the record/edit-payment modal, the record/edit-expense
   sheet, the recurring-expense sheet, and the global quick-schedule
   sheet. Each one is opened from anywhere via a callback exposed on the
   Cardigan context (FAB, list rows, end-of-visit toast), and rendered
   once at the App level (see components/app/AppSheets).

   Cohesive because every opener shares the same shape — flip an `open`
   flag, seed an `editing`/`draft` value — and the same single dependency:
   `readOnly` (admin "view as user" / demo / trial-expired all gate every
   write surface off). Pulling them here lets AppShell stop owning ~50
   lines of near-identical useState + useCallback boilerplate.

   The openers preserve their exact guard (`if (readOnly) return`) and
   dependency arrays, so the gating is unchanged. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export interface PaymentDraft { patientName: string; amount: string }

export function useActionSheets(readOnly: boolean) {
  // ── Payment modal ──
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState<Row>({ patientName: "", amount: "" });
  const [editingPayment, setEditingPayment] = useState<Row>(null);

  const openEditPaymentModal = useCallback((payment: Row) => {
    if (readOnly) return;
    setEditingPayment(payment);
    setPaymentDraft({ patientName: "", amount: "" });
    setPaymentModalOpen(true);
  }, [readOnly]);

  const openRecordPaymentModal = useCallback((patient: Row) => {
    if (readOnly) return;
    setEditingPayment(null);
    setPaymentDraft({
      patientName: patient?.name || "",
      amount: patient ? String(patient.amountDue || 0) : "",
    });
    setPaymentModalOpen(true);
  }, [readOnly]);

  // ── Expense sheet — mirrors the payment-modal pattern so any screen
  // (FAB, GastosTab list, ResumenTab CTA) can open record-mode or
  // edit-mode through context. ──
  const [expenseSheetOpen, setExpenseSheetOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Row>(null);
  const openRecordExpenseModal = useCallback(() => {
    if (readOnly) return;
    setEditingExpense(null);
    setExpenseSheetOpen(true);
  }, [readOnly]);
  const openEditExpenseModal = useCallback((expense: Row) => {
    if (readOnly) return;
    setEditingExpense(expense);
    setExpenseSheetOpen(true);
  }, [readOnly]);

  // ── Recurring-expense sheet ──
  const [recurringExpenseSheetOpen, setRecurringExpenseSheetOpen] = useState(false);
  const openRecurringExpenseSheet = useCallback(() => {
    if (readOnly) return;
    setRecurringExpenseSheetOpen(true);
  }, [readOnly]);

  // ── Global quick-schedule sheet — opened from the end-of-visit toast
  // or any openQuickSchedule(patient) consumer. No readOnly guard here:
  // scheduling the next consult is allowed from the toast even mid-flow,
  // and the sheet itself no-ops on a null patient. ──
  const [quickScheduleFor, setQuickScheduleFor] = useState<Row>(null);
  const openQuickSchedule = useCallback((patient: Row) => {
    if (!patient) return;
    setQuickScheduleFor(patient);
  }, []);

  return {
    paymentModalOpen, setPaymentModalOpen,
    paymentDraft, setPaymentDraft,
    editingPayment, setEditingPayment,
    openEditPaymentModal, openRecordPaymentModal,
    expenseSheetOpen, setExpenseSheetOpen,
    editingExpense, setEditingExpense,
    openRecordExpenseModal, openEditExpenseModal,
    recurringExpenseSheetOpen, setRecurringExpenseSheetOpen,
    openRecurringExpenseSheet,
    quickScheduleFor, setQuickScheduleFor, openQuickSchedule,
  };
}
