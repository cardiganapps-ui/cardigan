import { useMemo, useRef, useEffect } from "react";
import { isEpisodic } from "../data/constants";
import { shortDateToISO, todayISO as todayISOFn } from "../utils/dates";
import type { CardiganData } from "./useCardiganData";
import type { PatientRow, SessionRow } from "../types/rows";

/* ── useCardiganContextValue ───────────────────────────────────────────
   The CardiganContext assembler, extracted verbatim from App.tsx's
   AppShell. It composes the raw data layer (`...data`) with the shell's
   cross-cutting overrides + handlers into the single memoized object the
   106 context consumers read via useCardigan().

   The behaviorful bits that live here (and are now characterization-
   tested) are the ones that aren't simple pass-throughs:
     • uploadDocument — pro-gated; non-Pro callers get the upgrade sheet
       and a no-op resolve so their `await` doesn't throw.
     • deleteSession/Payment/Expense/Note — wrapped in the undoable-delete
       (optimistic remove + "Deshacer" toast + 3s commit) window.
     • onCancelSession — read-only gate.
     • onMarkCompleted — flips status, then for EPISODIC patients with no
       future scheduled visit fires the actionable "Programar próxima"
       toast (de-duped per patient).

   Everything else is wiring. The memo's dependency array is preserved
   exactly, plus the handful of setters/refs that were known-stable when
   they were shell locals (useState setters / useRef) and stay stable as
   params — listing them keeps exhaustive-deps honest without changing
   when the memo recomputes. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export interface CardiganContextValueDeps {
  data: CardiganData;
  readOnly: boolean;
  subscription: Row;
  requirePro: (feature?: string) => void;
  withUndoableDelete: (softFn: Row, label: string) => (...args: Row[]) => Promise<Row>;
  noteCrypto: Row;
  profession: Row;
  accentTheme: Row;
  fontScale: Row;
  userProfile: Row;
  groupsEnabled: boolean;
  setGroupsEnabled: Row;
  user: Row;
  userName: string;
  userInitial: string;
  openRecordPaymentModal: Row;
  openEditPaymentModal: Row;
  openRecordExpenseModal: Row;
  openEditExpenseModal: Row;
  openRecurringExpenseSheet: Row;
  setHideFab: Row;
  setHideBottomTabs: Row;
  setScreen: (id: string) => void;
  admin: boolean;
  navigate: Row;
  pushLayer: Row;
  popLayer: Row;
  removeLayer: Row;
  online: boolean;
  screen: string;
  drawerOpen: boolean;
  setDrawerOpen: Row;
  tutorial: Row;
  theme: Row;
  notifications: Row;
  showSuccess: (msg: string) => void;
  showToast: (msg: string, type?: string, opts?: Row) => unknown;
  pendingFabAction: Row;
  setPendingFabAction: Row;
  setActivationShareOpen: Row;
  pendingAgendaViewRef: { current: Row };
  pendingExpedienteRef: { current: Row };
  pendingNoteOpenRef: { current: Row };
  openQuickSchedule: (patient: Row) => void;
  updateSessionStatus: Row;
  patients: PatientRow[];
  upcomingSessions: SessionRow[];
  t: (key: string) => string;
}

export function useCardiganContextValue(deps: CardiganContextValueDeps) {
  const {
    data, readOnly, subscription, requirePro, withUndoableDelete,
    noteCrypto, profession, accentTheme, fontScale, userProfile, groupsEnabled, setGroupsEnabled,
    user, userName, userInitial,
    openRecordPaymentModal, openEditPaymentModal, openRecordExpenseModal, openEditExpenseModal, openRecurringExpenseSheet,
    setHideFab, setHideBottomTabs, setScreen, admin,
    navigate, pushLayer, popLayer, removeLayer, online,
    screen, drawerOpen, setDrawerOpen, tutorial, theme, notifications, showSuccess, showToast,
    pendingFabAction, setPendingFabAction, setActivationShareOpen,
    pendingAgendaViewRef, pendingExpedienteRef, pendingNoteOpenRef,
    openQuickSchedule, updateSessionStatus, patients, upcomingSessions, t,
  } = deps;

  // Latest-screen ref so openExpediente can record the origin screen
  // WITHOUT taking `screen` as a memo dependency — that's what lets the
  // nav callbacks live in the stable Main slice (below) instead of the
  // churning UI slice. The callback reads screenRef.current at tap time,
  // which is the current screen by construction (taps happen post-render).
  const screenRef = useRef(screen);
  useEffect(() => { screenRef.current = screen; }, [screen]);

  // ── Main slice ──
  // Data arrays + mutation actions + stable cross-cutting callbacks +
  // config. Crucially, its dependency array does NOT include the
  // fast-changing UI state (screen / drawerOpen / pendingFabAction /
  // tutorial / theme / notifications) — those live in the UI slice below
  // — so this value stays referentially stable across navigation, and a
  // consumer reading only useCardiganMain() stops re-rendering on nav.
  const mainValue = useMemo(() => ({
    ...data,
    // Override data.readOnly with the composed value (admin view-as
    // OR trial-expired). Order matters — this MUST come after
    // `...data` so it wins.
    readOnly,
    subscription,
    requirePro,
    // Pro-gated mutation: any caller that bypasses the UI badges (e.g.
    // a direct path inside PatientExpediente) still gets short-circuited
    // here — we open the upgrade sheet and resolve the call as a no-op
    // so the caller's `await` doesn't throw.
    uploadDocument: subscription?.isPro
      ? data.uploadDocument
      : async () => { requirePro("documents"); return null; },
    // The four everyday destructive actions go through the undoable
    // wrapper: optimistic remove + "Deshacer" toast + 3s commit
    // window. Recurring-template delete stays straight-through —
    // it's an admin-rare action and undoable wouldn't add much.
    // Gate every destructive action on the COMPOSED readOnly (admin
    // "view as user" / demo / expired-trial). The undoable overrides
    // wrap data.softDelete* which don't self-check readOnly, so without
    // this a read-only viewer could delete another user's sessions /
    // payments / notes / expenses. (bug-hunt: readOnly delete bypass)
    deleteSession: readOnly ? (async () => false) : withUndoableDelete(data.softDeleteSession, "Sesión eliminada"),
    deletePayment: readOnly ? (async () => false) : withUndoableDelete(data.softDeletePayment, "Pago eliminado"),
    deleteExpense: readOnly ? (async () => false) : withUndoableDelete(data.softDeleteExpense, "Gasto eliminado"),
    deleteRecurringTemplate: readOnly ? (async () => false) : data.deleteRecurringTemplate,
    deleteNote: readOnly ? (async () => false) : withUndoableDelete(data.softDeleteNote, "Nota eliminada"),
    noteCrypto,
    profession,
    accentTheme,
    fontScale,
    setProfessionLocal: userProfile.setProfessionLocal,
    groupsEnabled, setGroupsEnabled,
    user, userName, userInitial, openRecordPaymentModal, openEditPaymentModal, openRecordExpenseModal, openEditExpenseModal, openRecurringExpenseSheet,
    isAdminUser: admin, // surfaced to CommandPalette for admin-only commands
    online,
    showSuccess, showToast,
    openQuickSchedule,
    onCancelSession: async (s: Row, charge: Row, reason: Row) => !readOnly && await updateSessionStatus(s.id, "cancelled", charge, reason),
    /* onMarkCompleted intercepts the standard updateSessionStatus
       call to layer in the "schedule next?" affordance for episodic
       patients. After the status flip succeeds, if the patient has
       no future scheduled session, fire an actionable toast that
       opens QuickScheduleSheet on tap. Recurring patients see no
       prompt — their schedule already covers the next visit. */
    onMarkCompleted: async (s: Row, overrideStatus?: Row) => {
      if (readOnly) return false;
      const newStatus = overrideStatus || "completed";
      const ok = await updateSessionStatus(s.id, newStatus);
      if (!ok) return ok;
      // The prompt is specifically a "you just FINISHED a visit"
      // affordance — fire only when the new status lands at
      // 'completed'. Toggling a row back to 'scheduled' (rare but
      // possible from the same handler) shouldn't surface a
      // "completed" toast.
      if (newStatus !== "completed") return ok;
      const patient = patients.find((p: Row) => p.id === s.patient_id);
      if (!patient || !isEpisodic(patient)) return ok;
      // "Has a future visit already" check: any row with status=
      // 'scheduled' dated today-or-later that isn't the one we just
      // marked complete. Specifically NOT the broader "anything not
      // cancelled/charged" — a future row that's somehow already
      // 'completed' (early-marked) shouldn't suppress the prompt; the
      // user just wrapped a visit and likely wants to schedule the
      // next one regardless.
      const todayIso = todayISOFn();
      const hasFuture = (upcomingSessions || []).some((row: Row) => {
        if (row.patient_id !== patient.id) return false;
        if (row.id === s.id) return false;
        if (row.status !== "scheduled") return false;
        const iso = shortDateToISO(row.date);
        return iso >= todayIso;
      });
      if (hasFuture) return ok;
      // Fire the prompt toast. Reuses the toast queue's onRetry slot;
      // the new actionLabel prop (added in this round) carries the
      // localized "Programar próxima" label so this isn't mistaken
      // for an error retry.
      // Toast carries the patient's first name so a user marking
      // two consecutive consults complete (e.g. on the Agenda screen)
      // sees which one the [Programar próxima] button refers to.
      // First name only — the toast is narrow on phones and the full
      // "Apellido Apellido" tail crowds the action button.
      const firstName = (patient.name || "").split(" ")[0];
      showToast(
        firstName
          ? `${firstName} · ${t("scheduling.endOfVisitPrompt")}`
          : t("scheduling.endOfVisitPrompt"),
        "success",
        {
          actionLabel: t("scheduling.scheduleNext"),
          onRetry: () => openQuickSchedule(patient),
          // De-dup per patient — repeatedly toggling status (or
          // quickly marking two consecutive consults complete)
          // shouldn't stack multiple "Programar próxima" toasts.
          // The latest one wins.
          key: `end-of-visit:${patient.id}`,
        },
      );
      return ok;
    },
    // ── Stable navigation actions ──
    // None of these close over the fast-changing UI state (openExpediente
    // reads the latest screen via screenRef), so they belong in the STABLE
    // Main slice. That's what lets data screens which need them (Finances,
    // Home, …) read only useCardiganMain() and stop re-rendering on nav.
    navigate, setScreen, setDrawerOpen, pushLayer, popLayer, removeLayer,
    setHideFab, setHideBottomTabs,
    requestFabAction: setPendingFabAction,
    consumeFabAction: () => setPendingFabAction(null),
    openActivationShareSheet: () => setActivationShareOpen(true),
    setAgendaView: (v: Row) => { pendingAgendaViewRef.current = v; },
    consumeAgendaView: () => { const v = pendingAgendaViewRef.current; pendingAgendaViewRef.current = null; return v; },
    openExpediente: (patient: Row) => {
      // Remember which screen the user came from so closing the expediente
      // can take them back there instead of stranding them on Pacientes.
      // Only set an origin when the caller isn't already on Pacientes.
      pendingExpedienteRef.current = { patient, origin: screenRef.current !== "patients" ? screenRef.current : null };
      setScreen("patients");
    },
    openNoteById: (id: Row) => {
      // Navigate to Archivo (Notes tab by default) and stash the id; the
      // Notes screen reads it on mount. Same pendingRef pattern.
      pendingNoteOpenRef.current = id;
      setScreen("archivo");
    },
    consumePendingNoteOpen: () => {
      const v = pendingNoteOpenRef.current;
      pendingNoteOpenRef.current = null;
      return v;
    },
    consumeExpediente: () => {
      const v = pendingExpedienteRef.current;
      pendingExpedienteRef.current = null;
      return v;
    },
  }), [admin, data, noteCrypto, profession, accentTheme, fontScale, userProfile.setProfessionLocal, user, userName, userInitial, readOnly, subscription, requirePro, updateSessionStatus, patients, upcomingSessions, openQuickSchedule, t, openRecordPaymentModal, openEditPaymentModal, openRecordExpenseModal, openEditExpenseModal, openRecurringExpenseSheet, showSuccess, showToast, online, withUndoableDelete, groupsEnabled, setGroupsEnabled, navigate, setScreen, setDrawerOpen, pushLayer, popLayer, removeLayer, setHideFab, setHideBottomTabs, setPendingFabAction, setActivationShareOpen, pendingAgendaViewRef, pendingExpedienteRef, pendingNoteOpenRef]);

  // ── UI slice ──
  // ONLY the fast-changing navigation / UI STATE — the nav ACTIONS moved to
  // the stable Main slice above. This value changes on navigation (that's
  // the point); only components reading useCardiganUI() re-render then.
  const uiValue = useMemo(() => ({
    screen, drawerOpen, pendingFabAction, tutorial, theme, notifications,
  }), [screen, drawerOpen, pendingFabAction, tutorial, theme, notifications]);

  return { mainValue, uiValue };
}
