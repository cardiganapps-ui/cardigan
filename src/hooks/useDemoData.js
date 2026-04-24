import { useState, useMemo } from "react";
import { generateDemoData } from "../data/demoData";
import { parseShortDate } from "../utils/dates";
import { getTutorReminders } from "../utils/sessions";

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

  // Enrich patients with amountDue — derived from session rows so the
  // visible balance always matches consumed sessions minus payments,
  // mirroring useCardiganData.
  const enrichedPatients = useMemo(() => {
    const now = new Date();
    const consumedByPatient = new Map();
    for (const s of enrichedSessions) {
      if (!s.patient_id) continue;
      if (s.status !== "completed" && s.status !== "charged") continue;
      // Skip future-dated completed/charged sessions — they inflate
      // amountDue for events that haven't happened yet. See the matching
      // guard in useCardiganData.js::enrichedPatients.
      const d = parseShortDate(s.date);
      if (s.time) {
        const [h, m] = s.time.split(":");
        d.setHours(parseInt(h) || 0, parseInt(m) || 0);
      }
      if (d > now) continue;
      const rate = s.rate != null ? s.rate : 0;
      consumedByPatient.set(s.patient_id, (consumedByPatient.get(s.patient_id) || 0) + rate);
    }
    return data.patients.map(p => {
      const consumed = consumedByPatient.get(p.id) || 0;
      const delta = consumed - (p.paid || 0);
      return {
        ...p,
        amountDue: Math.max(0, delta),
        credit:    Math.max(0, -delta),
      };
    });
  }, [data.patients, enrichedSessions]);

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
