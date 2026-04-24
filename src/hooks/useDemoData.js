import { useState, useMemo } from "react";
import { generateDemoData } from "../data/demoData";
import { parseShortDate } from "../utils/dates";
import { getTutorReminders } from "../utils/sessions";
import { enrichPatientsWithBalance } from "../utils/accounting";

const noop = async () => false;
const noopNote = async () => null;

export function useDemoData() {
  const [data] = useState(() => generateDemoData());

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

  return {
    patients: enrichedPatients,
    upcomingSessions: enrichedSessions,
    payments: data.payments,
    notes: data.notes,
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
    createPatient: noop, updatePatient: noop, deletePatient: noop,
    createSession: noop, updateSessionStatus: noop, deleteSession: noop,
    rescheduleSession: noop, generateRecurringSessions: noop, applyScheduleChange: noop, finalizePatient: noop,
    updateSessionModality: noop, updateSessionRate: noop, updateCancelReason: noop,
    createPayment: noop, deletePayment: noop, updatePayment: noop,
    createNote: noopNote, updateNote: noop, updateNoteLink: noop, togglePinNote: noop, deleteNote: noop, deleteNotes: noop,
    documents: [], uploadDocument: noop, renameDocument: noop, tagDocumentSession: noop, deleteDocument: noop, getDocumentUrl: () => null,
    refresh: async () => {},
  };
}
