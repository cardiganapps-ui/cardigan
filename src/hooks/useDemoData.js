import { useMemo } from "react";
import { generateDemoData } from "../data/demoData";
import { getTutorReminders } from "../utils/sessions";
import { enrichPatientsWithBalance, sessionCountsTowardBalance } from "../utils/accounting";
import { DEFAULT_PROFESSION } from "../data/constants";

const noop = async () => false;
const noopNote = async () => null;

export function useDemoData(profession = DEFAULT_PROFESSION) {
  // Regenerating on every profession change is fine — generateDemoData
  // is pure and runs in <50ms even for 20-patient seed sets, well under
  // a frame. useMemo avoids regen across unrelated re-renders.
  const data = useMemo(() => generateDemoData(profession), [profession]);

  // Enrich sessions (auto-complete past ones). Routes through
  // sessionCountsTowardBalance with the demo's pinned tz so the UI
  // label can't disagree with the accounting predicate that drives
  // enrichedPatients below (prime-directive #4).
  const enrichedSessions = useMemo(() => {
    const now = new Date();
    return data.sessions.map(s => {
      if (s.status !== "scheduled") return s;
      if (sessionCountsTowardBalance(s, now, "America/Mexico_City")) {
        return { ...s, status: "completed" };
      }
      return s;
    });
  }, [data.sessions]);

  // Mirror useCardiganData: iterate raw DB sessions (data.sessions), NOT
  // the enrichedSessions memo. Auto-completed display state must not
  // influence accounting — see CLAUDE.md Prime Directive. Demo runs in
  // America/Mexico_City — matches the SQL twin's default, keeps the
  // demo's "expected" balances stable regardless of the visitor's
  // browser TZ.
  const enrichedPatients = useMemo(
    () => enrichPatientsWithBalance(data.patients, data.sessions, undefined, "America/Mexico_City"),
    [data.patients, data.sessions]
  );

  const tutorReminders = useMemo(() =>
    getTutorReminders(enrichedPatients, enrichedSessions),
    [enrichedPatients, enrichedSessions]
  );

  return {
    patients: enrichedPatients,
    upcomingSessions: enrichedSessions,
    payments: data.payments,
    notes: data.notes,
    tags: [], tagLinks: [],
    rescheduleRequests: [], setRescheduleRequests: () => {},
    noteAttachments: [],
    tutorReminders,
    userTz: "America/Mexico_City",
    loading: false,
    fetchError: "",
    mutating: false,
    mutationError: "",
    clearMutationError: () => {},
    readOnly: true,
    // All mutations are no-ops in demo. Shape mirrors useCardiganData's
    // return value so every destructure across the app resolves to a
    // callable (readOnly UI prevents most of these from firing anyway).
    // Soft-delete actions return a no-op {commit,undo} shape matching
    // the real factory so withUndoableDelete doesn't crash.
    createPatient: noop, updatePatient: noop, deletePatient: noop,
    createPotential: noop, discardPotential: noop, convertPotentialToActive: noop,
    createSession: noop, updateSessionStatus: noop, deleteSession: noop,
    softDeleteSession: () => ({ commit: async () => true, undo: () => {} }),
    rescheduleSession: noop, generateRecurringSessions: noop, applyScheduleChange: noop, finalizePatient: noop,
    updateSessionModality: noop, updateSessionRate: noop, updateSessionVisitType: noop, updateCancelReason: noop,
    createPayment: noop, deletePayment: noop, updatePayment: noop,
    softDeletePayment: () => ({ commit: async () => true, undo: () => {} }),
    createNote: noopNote, updateNote: noop, updateNoteLink: noop, togglePinNote: noop, deleteNote: noop, deleteNotes: noop,
    softDeleteNote: () => ({ commit: async () => true, undo: () => {} }),
    setNoteCover: noop,
    upsertTag: noopNote, deleteTag: noop, linkTag: noop, unlinkTag: noop,
    uploadNoteAttachment: noopNote, deleteNoteAttachment: noop,
    documents: [], uploadDocument: noop, renameDocument: noop, tagDocumentSession: noop, deleteDocument: noop, getDocumentUrl: () => null,
    measurements: data.measurements || [],
    createMeasurement: noopNote, updateMeasurement: noop, deleteMeasurement: noop,
    bulkCreateMeasurements: async () => ({ created: 0, skipped: 0 }),
    expenses: data.expenses || [],
    recurringExpenses: data.recurringExpenses || [],
    createExpense: noop, updateExpense: noop, deleteExpense: noop,
    softDeleteExpense: () => ({ commit: async () => true, undo: () => {} }),
    createRecurringTemplate: noopNote,
    updateRecurringTemplate: noop, deleteRecurringTemplate: noop,
    generateRecurringExpenses: async () => ({ inserted: 0, pending: 0 }),
    generatePendingRecurringExpenses: async () => ({ inserted: 0 }),
    refresh: async () => {},
  };
}
