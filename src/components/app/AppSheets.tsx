import { lazy, Suspense } from "react";
import { QuickActions } from "../QuickActions";
import { BottomTabs } from "../BottomTabs";
import { BugReportSheet } from "../BugReportFab";
import { QuickScheduleSheet } from "../sheets/QuickScheduleSheet";
import type { MutableRefObject } from "react";
import type { ActionSheetsState } from "../../hooks/useActionSheets";

/* ── AppSheets ────────────────────────────────────────────────────────
   The layer that sits below the active screen in AppShell's main-content
   column: the record-payment modal, the expense + recurring-expense
   sheets, the FAB (QuickActions) and BottomTabs nav chrome, the command
   palette, the bug-report sheet, the tutorial, and the global
   quick-schedule sheet.

   PRESENTATIONAL extraction from AppShell — every open-flag, draft, and
   handler is owned by AppShell and threads in as props, so the JSX moved
   verbatim (and in the same sibling order, preserving paint/stacking).
   Rendered inside CardiganProvider, so the context-reading members
   (QuickActions / BottomTabs / Tutorial) keep their access.

   The lazy() chunk declarations move here with their JSX. AppShell keeps
   the matching importer factories (paymentModalImport / expenseSheetImport
   / commandPaletteImport) for its idle-time prefetch effect — both resolve
   the same Vite chunk, so prefetch still warms what these render. */

const PaymentModal = lazy(() => import("../PaymentModal").then(m => ({ default: m.PaymentModal })));
const ExpenseSheet = lazy(() => import("../sheets/ExpenseSheet").then(m => ({ default: m.ExpenseSheet })));
const RecurringExpenseSheet = lazy(() => import("../sheets/RecurringExpenseSheet").then(m => ({ default: m.RecurringExpenseSheet })));
const CommandPalette = lazy(() => import("../CommandPalette"));
const Tutorial = lazy(() => import("../Tutorial/Tutorial").then(m => ({ default: m.Tutorial })));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

/* App-shell chrome AppSheets needs that ISN'T action-sheet state: gating
   flags, the signed-in user, the command-palette + bug-report + admin
   impersonation handles, and the nav-chrome visibility toggles. Grouped so
   the component takes two cohesive objects instead of a 30-prop signature. */
export interface AppShellChrome {
  readOnly?: boolean;
  demo?: boolean;
  user: Row;
  admin?: boolean;
  screen: string;
  showSuccess: (msg: string) => void;
  hideFab: boolean;
  hideBottomTabs: boolean;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  viewAsOriginHashRef: MutableRefObject<string | null>;
  setViewAsUserId: (v: string | null) => void;
  navigate: (id: string) => void;
  bugReportOpen: boolean;
  setBugReportOpen: (v: boolean) => void;
}

export interface AppSheetsProps {
  /** The action-sheet state bundle straight from useActionSheets. */
  sheets: ActionSheetsState;
  /** Everything else AppSheets needs from the shell. */
  shell: AppShellChrome;
}

export function AppSheets({ sheets, shell }: AppSheetsProps) {
  const {
    paymentModalOpen, setPaymentModalOpen, editingPayment, setEditingPayment, paymentDraft,
    expenseSheetOpen, setExpenseSheetOpen, editingExpense, setEditingExpense,
    recurringExpenseSheetOpen, setRecurringExpenseSheetOpen,
    quickScheduleFor, setQuickScheduleFor,
  } = sheets;
  const {
    readOnly, demo, user, admin, screen, showSuccess,
    hideFab, hideBottomTabs,
    paletteOpen, setPaletteOpen, viewAsOriginHashRef, setViewAsUserId, navigate,
    bugReportOpen, setBugReportOpen,
  } = shell;
  return (
    <>
      {!readOnly && (
        <Suspense fallback={null}>
          <PaymentModal open={paymentModalOpen} onClose={((msg: Row) => { setPaymentModalOpen(false); setEditingPayment(null); if (typeof msg === "string" && msg) showSuccess(msg); }) as Row}
            initialPatientName={paymentDraft.patientName} initialAmount={paymentDraft.amount} editingPayment={editingPayment} />
        </Suspense>
      )}
      {!readOnly && expenseSheetOpen && (
        <Suspense fallback={null}>
          <ExpenseSheet
            editingExpense={editingExpense}
            onClose={((msg: Row) => {
              setExpenseSheetOpen(false);
              setEditingExpense(null);
              if (typeof msg === "string" && msg) showSuccess(msg);
            }) as Row}
          />
        </Suspense>
      )}
      {!readOnly && recurringExpenseSheetOpen && (
        <Suspense fallback={null}>
          <RecurringExpenseSheet
            onClose={() => setRecurringExpenseSheetOpen(false)}
          />
        </Suspense>
      )}
      {!readOnly && !hideFab && <QuickActions />}
      {!hideBottomTabs && <BottomTabs />}
      <Suspense fallback={null}>
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          currentAdminId={user?.id}
        onViewAsUser={admin && !readOnly ? (uid: string) => {
          // Same impersonation entry as AdminLayout's onViewAs. We
          // snapshot the admin hash (empty when invoked from a non-admin
          // screen) so the read-only banner's exit returns to wherever
          // the admin invoked the action from.
          viewAsOriginHashRef.current = typeof window !== "undefined"
            ? window.location.hash
            : null;
          setViewAsUserId(uid);
          navigate("home");
        } : undefined}
        />
      </Suspense>

      {user && !demo && !readOnly && (
        <BugReportSheet open={bugReportOpen} onClose={() => setBugReportOpen(false)} user={user} screen={screen} />
      )}
      {!demo && !readOnly && (
        <Suspense fallback={null}>
          <Tutorial />
        </Suspense>
      )}
      {/* Global QuickScheduleSheet — opened from the
          end-of-visit toast or any "openQuickSchedule(patient)"
          consumer. Mounted unconditionally; renders null when no
          patient is set so the rest of the shell isn't affected. */}
      {quickScheduleFor && (
        <QuickScheduleSheet
          patient={quickScheduleFor}
          onClose={() => setQuickScheduleFor(null)}
        />
      )}
    </>
  );
}
