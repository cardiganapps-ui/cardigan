import { useMemo } from "react";
import { generateDemoData } from "../data/demoData";
import { parseShortDate } from "../utils/dates";
import { getTutorReminders } from "../utils/sessions";
import { enrichPatientsWithBalance } from "../utils/accounting";
import { DEFAULT_PROFESSION } from "../data/constants";

const noop = async () => false;
const noopNote = async () => null;

export function useDemoData(profession = DEFAULT_PROFESSION) {
  // Regenerating on every profession change is fine — generateDemoData
  // is pure and runs in <50ms even for 20-patient seed sets, well under
  // a frame. useMemo avoids regen across unrelated re-renders.
  const data = useMemo(() => generateDemoData(profession), [profession]);

  // Enrich sessions (auto-complete past ones)
  const enrichedSessions = useMemo(() => {
    const now = new Date();
    return data.sessions.map(s => {
      if (s.status !== "scheduled") return s;
      const d = parseShortDate(s.date);
      if (s.time) {
        const [h, m] = s.time.split(":");
        d.setHours(parseInt(h) || 0, parseInt(m) || 0);
      }
      d.setTime(d.getTime() + 60 * 60 * 1000);
      if (now >= d) return { ...s, status: "completed" };
      return s;
    });
  }, [data.sessions]);

  // Mirror useCardiganData: iterate raw DB sessions (data.sessions), NOT
  // the enrichedSessions memo. Auto-completed display state must not
  // influence accounting — see CLAUDE.md Prime Directive.
  const enrichedPatients = useMemo(
    () => enrichPatientsWithBalance(data.patients, data.sessions),
    [data.patients, data.sessions]
  );

  const tutorReminders = useMemo(() =>
    getTutorReminders(enrichedPatients, enrichedSessions),
    [enrichedPatients, enrichedSessions]
  );

  // A few inbox fixtures so the bell + sheet are populated in demo mode.
  const demoNotifications = useMemo(() => {
    const iso = (mins) => new Date(new Date().getTime() - mins * 60000).toISOString();
    return [
      { id: "demo-n1", kind: "reminder", title: "Recordatorio de sesión", body: "Ana López · 17:00", url: "/#agenda", session_id: null, patient_id: null, read: false, created_at: iso(25) },
      { id: "demo-n2", kind: "reminder", title: "Recordatorio de sesión", body: "Carlos Ruiz · 12:30", url: "/#agenda", session_id: null, patient_id: null, read: false, created_at: iso(180) },
      { id: "demo-n3", kind: "system", title: "Te damos la bienvenida", body: "Aquí aparecerán tus recordatorios de sesión y avisos.", url: "/", session_id: null, patient_id: null, read: true, created_at: iso(1440) },
    ];
  }, []);

  return {
    patients: enrichedPatients,
    upcomingSessions: enrichedSessions,
    payments: data.payments,
    notes: data.notes,
    tags: [], tagLinks: [],
    rescheduleRequests: [], setRescheduleRequests: () => {},
    noteAttachments: [],
    groups: data.groups || [],
    groupMembers: data.groupMembers || [],
    inbox: demoNotifications,
    inboxUnread: demoNotifications.filter((n) => !n.read).length,
    tutorReminders,
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
    markNotificationRead: noop, markAllNotificationsRead: noop,
    deleteNotification: noop, clearNotifications: noop,
    createGroup: noop, updateGroup: noop, deleteGroup: noop, endGroup: noop,
    addMember: noop, addMembers: noop, removeMember: noop,
    generateGroupSessions: noop, applyGroupScheduleChange: noop, cancelGroupOccurrence: noop,
    rescheduleGroupOccurrence: noop,
    refresh: async () => {},
  };
}
