/* ── renderWithCardigan ──────────────────────────────────────────────
   Render a screen/component that consumes useCardigan() under both the
   CardiganProvider (the ~70-key data+actions bag) and the I18nProvider
   (Spanish vocab + the useT() hook). The existing component tests
   (FinanzasTab, BalanceCard, PagosTab.window) only wrap I18nProvider
   because those components take props directly; the bigger SCREENS
   (Finances, Home, Patients…) read everything from context, so they
   were untestable until this helper existed.

   Usage:
     const { container } = renderWithCardigan(<Finances />, {
       patients: [{ id: "p1", name: "Ana", amountDue: 1200, ... }],
     });

   Pass a partial context to override the defaults below. The default
   bag is intentionally inert: empty data arrays + no-op actions +
   readOnly:false, enough for a screen to render its empty/zero state
   without throwing on a missing key.

   AnimatedNumber/useAnimatedNumber: count-up KPIs only settle to their
   target over multiple rAF frames. Tests that assert on an animated
   value should stub matchMedia to report reduced-motion so the hook
   SNAPS to the target synchronously (see the money-screen tests). */

import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { I18nProvider } from "../i18n/index";
import { CardiganProvider } from "../context/CardiganContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const noop = () => {};
const asyncNoop = async () => true;

/** The inert default context — every key a money/home screen reads. */
export function defaultCardiganContext(): Row {
  return {
    // ── data ──
    patients: [],
    payments: [],
    upcomingSessions: [],
    expenses: [],
    recurringExpenses: [],
    groups: [],
    groupMembers: [],
    notes: [],
    documents: [],
    measurements: [],
    tutorReminders: [],
    rescheduleRequests: [],

    // ── flags / identity ──
    mutating: false,
    readOnly: false,
    online: true,
    user: { id: "test-user" },
    subscription: { accessState: "active" },

    // ── actions (no-ops; override with vi.fn() to assert calls) ──
    openRecordPaymentModal: noop,
    openEditPaymentModal: noop,
    openRecordExpenseModal: noop,
    openEditExpenseModal: noop,
    openRecurringExpenseSheet: noop,
    generatePendingRecurringExpenses: asyncNoop,
    deletePayment: asyncNoop,
    deleteExpense: asyncNoop,
    deleteSession: asyncNoop,
    deleteNote: asyncNoop,
    onCancelSession: asyncNoop,
    onMarkCompleted: asyncNoop,
    rescheduleSession: asyncNoop,
    updateSessionModality: asyncNoop,
    updateSessionRate: asyncNoop,
    updateCancelReason: asyncNoop,
    createSession: asyncNoop,
    createNote: asyncNoop,
    updateNote: asyncNoop,
    openExpediente: noop,
    requestFabAction: noop,
    setAgendaView: noop,
  };
}

export function renderWithCardigan(ui: ReactNode, context: Row = {}) {
  const value = { ...defaultCardiganContext(), ...context };
  return render(
    <CardiganProvider value={value}>
      <I18nProvider>{ui}</I18nProvider>
    </CardiganProvider>,
  );
}
