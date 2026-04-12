import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "../supabaseClient";
import { formatShortDate, parseShortDate, toISODate } from "../utils/dates";
import {
  ADMIN_EMAIL,
  PATIENT_STATUS,
  RECURRENCE_EXTEND_THRESHOLD_DAYS,
  RECURRENCE_WINDOW_WEEKS,
  SESSION_STATUS,
} from "../data/constants";
import { createPatientActions } from "./usePatients";
import { createSessionActions, getRecurringDates } from "./useSessions";
import { createPaymentActions } from "./usePayments";
import { createNoteActions } from "./useNotes";
import { createDocumentActions } from "./useDocuments";

function mapRows(rows) {
  return (rows || []).map(r => ({ ...r, colorIdx: r.color_idx }));
}

export function isAdmin(user) {
  return user?.email === ADMIN_EMAIL;
}

export async function fetchAllAccounts() {
  let pData = [], profileData = [];
  try {
    const { data } = await supabase.from("patients").select("user_id, name, created_at").order("created_at");
    pData = data || [];
  } catch (e) { /* ignore */ }
  try {
    const { data } = await supabase.rpc("get_user_profiles");
    profileData = data || [];
  } catch (e) { /* ignore */ }

  if (pData.length === 0) return [];
  const profiles = new Map();
  profileData.forEach(p => profiles.set(p.id, p));

  const accounts = new Map();
  pData.forEach(p => {
    if (!accounts.has(p.user_id)) {
      const prof = profiles.get(p.user_id);
      accounts.set(p.user_id, {
        userId: p.user_id,
        fullName: prof?.full_name || "",
        email: prof?.email || "",
        patientCount: 0,
        firstSeen: p.created_at,
      });
    }
    accounts.get(p.user_id).patientCount++;
  });
  return [...accounts.values()];
}

export async function fetchBugReports({ archived = false } = {}) {
  let q = supabase
    .from("bug_reports")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  q = archived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function archiveBugReports(ids) {
  const { error } = await supabase
    .from("bug_reports")
    .update({ archived_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw error;
}

export async function deleteBugReport(id) {
  const { error } = await supabase.from("bug_reports").delete().eq("id", id);
  if (error) throw error;
}

export function useCardiganData(user, viewAsUserId) {
  const userId = viewAsUserId || user?.id;
  const readOnly = !!viewAsUserId;
  const [patients, setPatients] = useState([]);
  const [upcomingSessions, setUpcomingSessions] = useState([]);
  const [payments, setPayments] = useState([]);
  const [notes, setNotes] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState("");

  /* ── DATA FETCH + AUTO-EXTEND ── */
  const refresh = useCallback(async () => {
    setLoading(true);
    const q = (table) => supabase.from(table).select("*").eq("user_id", userId);
    const [pRes, sRes, pmRes, nRes, dRes] = await Promise.all([
      q("patients").order("name"),
      q("sessions").order("created_at"),
      q("payments").order("created_at", { ascending: false }),
      q("notes").order("updated_at", { ascending: false }),
      q("documents").order("created_at", { ascending: false }),
    ]);

    let pData = mapRows(pRes.data);
    let sData = mapRows(sRes.data);

    // Auto-extend recurring sessions (skip in read-only)
    if (userId && !readOnly) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const threshold = new Date(today);
      threshold.setDate(today.getDate() + RECURRENCE_EXTEND_THRESHOLD_DAYS);
      const extendEnd = toISODate(
        new Date(today.getTime() + RECURRENCE_WINDOW_WEEKS * 7 * 86400000)
      );
      let didExtend = false;

      for (const patient of pData) {
        if (patient.status !== PATIENT_STATUS.ACTIVE) continue;
        const allPSess = sData.filter(s => s.patient_id === patient.id);
        if (allPSess.length === 0) continue;
        const activePSess = allPSess.filter(
          s => s.status !== SESSION_STATUS.CANCELLED && s.status !== SESSION_STATUS.CHARGED
        );
        const schedMap = new Map();
        allPSess.forEach(s => schedMap.set(`${s.day}|${s.time}`, { day: s.day, time: s.time }));
        const existingDates = new Set(allPSess.map(s => s.date));
        let latest = null;
        activePSess.forEach(s => {
          const d = parseShortDate(s.date);
          if (!latest || d > latest) latest = d;
        });
        if (!latest || latest > threshold) continue;
        const nextDay = new Date(latest);
        nextDay.setDate(nextDay.getDate() + 1);
        const rows = [];
        for (const sched of schedMap.values()) {
          getRecurringDates(sched.day, toISODate(nextDay), extendEnd).forEach(d => {
            const ds = formatShortDate(d);
            if (!existingDates.has(ds)) {
              rows.push({ user_id: userId, patient_id: patient.id, patient: patient.name,
                initials: patient.initials, time: sched.time, day: sched.day,
                date: ds, rate: patient.rate, color_idx: patient.color_idx || 0 });
              existingDates.add(ds);
            }
          });
        }
        if (rows.length > 0) {
          const { data, error } = await supabase.from("sessions").insert(rows).select();
          if (!error && data) {
            await supabase.from("patients")
              .update({ sessions: patient.sessions + data.length, billed: patient.billed + patient.rate * data.length })
              .eq("id", patient.id);
            didExtend = true;
          }
        }
      }

      if (didExtend) {
        const [pRes2, sRes2] = await Promise.all([
          q("patients").order("name"),
          q("sessions").order("created_at"),
        ]);
        pData = mapRows(pRes2.data);
        sData = mapRows(sRes2.data);
      }
    }

    setPatients(pData);
    setUpcomingSessions(sData);
    setPayments(mapRows(pmRes.data));
    setNotes(nRes.data || []);
    setDocuments(dRes.data || []);
    setLoading(false);
  }, [userId, readOnly]);

  useEffect(() => { refresh(); }, [refresh]);

  /* ── DOMAIN ACTIONS (delegated to focused modules) ── */
  const helpers = { formatShortDate, getRecurringDates };
  const { createPatient, updatePatient, deletePatient } =
    createPatientActions(userId, patients, setPatients, upcomingSessions, setUpcomingSessions, setMutating, setMutationError, helpers);
  const { createSession, updateSessionStatus, deleteSession, rescheduleSession, generateRecurringSessions, applyScheduleChange, finalizePatient } =
    createSessionActions(userId, patients, setPatients, upcomingSessions, setUpcomingSessions, setMutating, setMutationError);
  const { createPayment, deletePayment } =
    createPaymentActions(userId, patients, setPatients, payments, setPayments, setMutating, setMutationError);
  const { createNote, updateNote, updateNoteLink, togglePinNote, deleteNote, deleteNotes } =
    createNoteActions(userId, notes, setNotes, setMutating, setMutationError);
  const { uploadDocument, renameDocument, tagDocumentSession, deleteDocument, getDocumentUrl } =
    createDocumentActions(userId, documents, setDocuments, setMutating, setMutationError);

  /* ── ENRICHMENT ── */
  // Auto-complete is display-only — shows past scheduled sessions as "completed"
  // but does NOT persist to DB. User can override any session status.
  const enrichedSessions = useMemo(() => {
    const now = new Date();
    return upcomingSessions.map(s => {
      if (s.status !== SESSION_STATUS.SCHEDULED) return s;
      const d = parseShortDate(s.date);
      if (s.time) {
        const [h, m] = s.time.split(":");
        d.setHours(parseInt(h) || 0, parseInt(m) || 0);
      }
      d.setTime(d.getTime() + 60 * 60 * 1000);
      if (now >= d) return { ...s, status: SESSION_STATUS.COMPLETED, _autoCompleted: true };
      return s;
    });
  }, [upcomingSessions]);

  const enrichedPatients = useMemo(() => {
    const now = new Date();
    return patients.map(p => {
      let futureBilled = 0;
      enrichedSessions.forEach(s => {
        if (s.patient_id !== p.id) return;
        if (s.status === SESSION_STATUS.CANCELLED || s.status === SESSION_STATUS.CHARGED) return;
        const d = parseShortDate(s.date);
        if (s.time) {
          const [h, m] = s.time.split(":");
          d.setHours(parseInt(h) || 0, parseInt(m) || 0);
        }
        if (d > now) futureBilled += (s.rate != null ? s.rate : p.rate);
      });
      const pastBilled = p.billed - futureBilled;
      return { ...p, amountDue: Math.max(0, pastBilled - p.paid) };
    });
  }, [patients, enrichedSessions]);

  return {
    patients: enrichedPatients, upcomingSessions: enrichedSessions, payments, notes, documents,
    loading, mutating, mutationError, readOnly,
    createPatient, updatePatient, deletePatient,
    createSession, updateSessionStatus, deleteSession, rescheduleSession,
    generateRecurringSessions, applyScheduleChange, finalizePatient,
    createPayment, deletePayment,
    createNote, updateNote, updateNoteLink, togglePinNote, deleteNote, deleteNotes,
    uploadDocument, renameDocument, tagDocumentSession, deleteDocument, getDocumentUrl,
    refresh,
  };
}
