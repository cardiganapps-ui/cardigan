/**
 * @vitest-environment happy-dom
 *
 * AppSheets — the action-sheet + nav-chrome layer below the active screen,
 * extracted from AppShell. The lazy / context-reading children are stubbed
 * to markers; this pins the gating AppSheets owns: the read-only
 * suppression of the write surfaces (payment / expense / FAB), the
 * hideFab / hideBottomTabs toggles, the open-flags on the expense +
 * quick-schedule sheets, and the bug-report (signed-in / non-demo /
 * non-read-only) guard.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";

vi.mock("../../PaymentModal", () => ({ PaymentModal: () => <div data-testid="payment-modal" /> }));
vi.mock("../../sheets/ExpenseSheet", () => ({ ExpenseSheet: () => <div data-testid="expense-sheet" /> }));
vi.mock("../../sheets/RecurringExpenseSheet", () => ({ RecurringExpenseSheet: () => <div data-testid="recurring-expense" /> }));
vi.mock("../../CommandPalette", () => ({ default: () => <div data-testid="command-palette" /> }));
vi.mock("../../Tutorial/Tutorial", () => ({ Tutorial: () => <div data-testid="tutorial" /> }));
vi.mock("../../QuickActions", () => ({ QuickActions: () => <div data-testid="fab" /> }));
vi.mock("../../BottomTabs", () => ({ BottomTabs: () => <div data-testid="bottom-tabs" /> }));
vi.mock("../../BugReportFab", () => ({ BugReportSheet: () => <div data-testid="bug-report" /> }));
vi.mock("../../sheets/QuickScheduleSheet", () => ({ QuickScheduleSheet: () => <div data-testid="quick-schedule" /> }));

import { AppSheets } from "../AppSheets";

afterEach(cleanup);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function renderSheets(over: Record<string, unknown> = {}) {
  const props: Any = {
    readOnly: false, demo: false, user: { id: "u1" }, admin: false, screen: "home",
    paymentModalOpen: false, setPaymentModalOpen: vi.fn(), editingPayment: null, setEditingPayment: vi.fn(),
    paymentDraft: { patientName: "", amount: "" }, showSuccess: vi.fn(),
    expenseSheetOpen: false, setExpenseSheetOpen: vi.fn(), editingExpense: null, setEditingExpense: vi.fn(),
    recurringExpenseSheetOpen: false, setRecurringExpenseSheetOpen: vi.fn(),
    hideFab: false, hideBottomTabs: false,
    paletteOpen: false, setPaletteOpen: vi.fn(), viewAsOriginHashRef: { current: null }, setViewAsUserId: vi.fn(), navigate: vi.fn(),
    bugReportOpen: false, setBugReportOpen: vi.fn(),
    quickScheduleFor: null, setQuickScheduleFor: vi.fn(),
    ...over,
  };
  const utils = render(<AppSheets {...props} />);
  return { ...utils, props };
}

describe("AppSheets gating", () => {
  it("default (writable): payment modal, FAB, bottom tabs, command palette all mount", async () => {
    const { findByTestId, queryByTestId } = renderSheets();
    expect(await findByTestId("payment-modal")).not.toBeNull();
    expect(await findByTestId("command-palette")).not.toBeNull();
    expect(queryByTestId("fab")).not.toBeNull();
    expect(queryByTestId("bottom-tabs")).not.toBeNull();
  });

  it("read-only suppresses the write surfaces (payment / FAB) but keeps bottom tabs", async () => {
    const { queryByTestId } = renderSheets({ readOnly: true });
    await waitFor(() => expect(queryByTestId("payment-modal")).toBeNull());
    expect(queryByTestId("fab")).toBeNull();
    expect(queryByTestId("bottom-tabs")).not.toBeNull();
  });

  it("hideFab / hideBottomTabs hide their respective chrome", () => {
    const { queryByTestId } = renderSheets({ hideFab: true, hideBottomTabs: true });
    expect(queryByTestId("fab")).toBeNull();
    expect(queryByTestId("bottom-tabs")).toBeNull();
  });

  it("expense sheet mounts only when open", async () => {
    const { findByTestId } = renderSheets({ expenseSheetOpen: true });
    expect(await findByTestId("expense-sheet")).not.toBeNull();
    cleanup();
    const { queryByTestId } = renderSheets({ expenseSheetOpen: false });
    await waitFor(() => expect(queryByTestId("expense-sheet")).toBeNull());
  });

  it("quick-schedule sheet mounts only when a patient is set", () => {
    const { queryByTestId, rerender, props } = renderSheets({ quickScheduleFor: { id: "p1" } });
    expect(queryByTestId("quick-schedule")).not.toBeNull();
    rerender(<AppSheets {...{ ...props, quickScheduleFor: null }} />);
    expect(queryByTestId("quick-schedule")).toBeNull();
  });

  it("bug-report sheet needs signed-in + non-demo + non-read-only", () => {
    expect(renderSheets().queryByTestId("bug-report")).not.toBeNull();
    cleanup();
    expect(renderSheets({ demo: true }).queryByTestId("bug-report")).toBeNull();
    cleanup();
    expect(renderSheets({ readOnly: true }).queryByTestId("bug-report")).toBeNull();
  });
});
