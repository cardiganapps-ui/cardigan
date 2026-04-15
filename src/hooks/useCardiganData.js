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
import { recalcPatientCounters } from "../utils/patients";
import { getTutorReminders } from "../utils/sessions";

// Module-level lock to prevent concurrent auto-extend from duplicating sessions.
let _extending = false;

function mapRows(rows) {
  return (rows || []).map(r => ({ ...r, colorIdx: r.color_idx, modality: r.modality || "presencial" }));
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

  // Start from auth.users so accounts with zero patients still appear —
  // otherwise the admin can't block/delete a freshly-created empty
  // account. Patient counts are joined in afterwards.
  const now = Date.now();
  const accounts = new Map();
  profileData.forEach(prof => {
    const bannedUntilMs = prof.banned_until ? new Date(prof.banned_until).getTime() : 0;
    accounts.set(prof.id, {
      userId: prof.id,
      fullName: prof.full_name || "",
      email: prof.email || "",
      patientCount: 0,
      firstSeen: prof.created_at || null,
      blocked: bannedUntilMs > now,
      bannedUntil: prof.banned_until || null,
    });
  });
  pData.forEach(p => {
    if (!accounts.has(p.user_id)) {
      // Profile fetch failed (e.g. RLS blocked) but we still see the
      // user via their patient rows. Render with what we have.
      accounts.set(p.user_id, {
        userId: p.user_id,
        fullName: "",
        email: "",
        patientCount: 0,
        firstSeen: p.created_at,
        blocked: false,
        bannedUntil: null,
      });
    }
    accounts.get(p.user_id).patientCount++;
  });
  return [...accounts.values()];
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    "Authorization": `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };
}

export async function adminBlockUser(userId, block) {
  const headers = await authHeaders();
  const res = await fetch("/api/admin-block-user", {
    method: "POST",
    headers,
    body: JSON.stringify({ userId, block }),
  });
  if (!res.ok) {
    let msg = "Block failed";
    try { const j = await res.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export async function adminDeleteUser(userId) {
  const headers = await authHeaders();
  const res = await fetch("/api/admin-delete-user", {
    method: "POST",
    headers,
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    let msg = "Delete failed";
    try { const j = await res.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
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
  const { error } = await supabase.rpc("archive_bug_reports", { report_ids: ids });
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
  const [fetchError, setFetchError] = useState("");
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState("");

  /* ── DATA FETCH + AUTO-EXTEND ── */
  const refresh = useCallback(async () => {
    setLoading(true);
    setFetchError("");
    const q = (table) => supabase.from(table).select("*").eq("user_id", userId);
    let pRes, sRes, pmRes, nRes, dRes;
    try {
      [pRes, sRes, pmRes, nRes, dRes] = await Promise.all([
        q("patients").order("name"),
        q("sessions").order("created_at"),
        q("payments").order("created_at", { ascending: false }),
        q("notes").order("updated_at", { ascending: false }),
        q("documents").order("created_at", { ascending: false }),
      ]);
    } catch (err) {
      setFetchError(err.message || "Error al cargar datos");
      setLoading(false);
      return;
    }

    // Surface individual table errors
    const tableErr = [pRes, sRes, pmRes, nRes, dRes].find(r => r.error);
    if (tableErr) setFetchError(tableErr.error.message);

    let pData = mapRows(pRes.data);
    let sData = mapRows(sRes.data);

    // Auto-extend recurring sessions (skip in read-only or if already extending)
    if (userId && !readOnly && !_extending) {
      _extending = true;
      try {
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
          allPSess.forEach(s => schedMap.set(`${s.day}|${s.time}`, { day: s.day, time: s.time, duration: s.duration || 60, modality: s.modality || "presencial" }));
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
                  date: ds, duration: sched.duration, rate: patient.rate,
                  modality: sched.modality, color_idx: patient.color_idx || 0 });
                existingDates.add(ds);
              }
            });
          }
          if (rows.length > 0) {
            const { data, error } = await supabase.from("sessions").insert(rows).select();
            if (!error && data) {
              const newSessions = patient.sessions + data.length;
              const newBilled = patient.billed + patient.rate * data.length;
              const { error: pErr } = await supabase.from("patients")
                .update({ sessions: newSessions, billed: newBilled })
                .eq("id", patient.id);
              if (pErr) await recalcPatientCounters(patient.id);
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
      } finally {
        _extending = false;
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
    createPatientActions(userId, patients, setPatients, upcomingSessions, setUpcomingSessions, payments, setPayments, documents, setDocuments, setMutating, setMutationError, helpers);
  const { createSession, updateSessionStatus, deleteSession, rescheduleSession, generateRecurringSessions, applyScheduleChange, finalizePatient, updateSessionModality, updateSessionRate } =
    createSessionActions(userId, patients, setPatients, upcomingSessions, setUpcomingSessions, setMutating, setMutationError);
  const { createPayment, deletePayment, updatePayment } =
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
    // Pre-group sessions by patient_id to avoid O(patients * sessions) scan
    const sessionsByPatient = new Map();
    for (const s of enrichedSessions) {
      if (s.status !== SESSION_STATUS.COMPLETED && s.status !== SESSION_STATUS.CHARGED) continue;
      if (!s.patient_id) continue;
      if (!sessionsByPatient.has(s.patient_id)) sessionsByPatient.set(s.patient_id, []);
      sessionsByPatient.get(s.patient_id).push(s);
    }
    return patients.map(p => {
      let pastBilled = 0;
      const pSessions = sessionsByPatient.get(p.id) || [];
      for (const s of pSessions) {
        const d = parseShortDate(s.date);
        if (s.time) {
          const [h, m] = s.time.split(":");
          d.setHours(parseInt(h) || 0, parseInt(m) || 0);
        }
        if (d <= now) pastBilled += (s.rate != null ? s.rate : p.rate);
      }
      return { ...p, amountDue: Math.max(0, pastBilled - p.paid) };
    });
  }, [patients, enrichedSessions]);

  const tutorReminders = useMemo(() =>
    getTutorReminders(enrichedPatients, enrichedSessions),
    [enrichedPatients, enrichedSessions]
  );

  // Defense-in-depth: prevent mutations in read-only mode
  const guard = (fn) => readOnly ? async () => false : fn;

  // After a successful patient create we also refresh from the server.
  // The optimistic setters inside createPatient should be enough, but a
  // user report showed newly-generated recurring sessions occasionally
  // didn't render until the next pull-to-refresh — this closes that
  // gap without blocking the sheet from dismissing.
  const createPatientWithRefresh = async (args) => {
    const ok = await createPatient(args);
    if (ok) refresh().catch(() => {});
    return ok;
  };

  return {
    patients: enrichedPatients, upcomingSessions: enrichedSessions, payments, notes, documents,
    tutorReminders,
    loading, fetchError, mutating, mutationError, readOnly,
    createPatient: guard(createPatientWithRefresh), updatePatient: guard(updatePatient), deletePatient: guard(deletePatient),
    createSession: guard(createSession), updateSessionStatus: guard(updateSessionStatus),
    deleteSession: guard(deleteSession), rescheduleSession: guard(rescheduleSession),
    generateRecurringSessions: guard(generateRecurringSessions), applyScheduleChange: guard(applyScheduleChange),
    finalizePatient: guard(finalizePatient), updateSessionModality: guard(updateSessionModality), updateSessionRate: guard(updateSessionRate),
    createPayment: guard(createPayment), deletePayment: guard(deletePayment), updatePayment: guard(updatePayment),
    createNote: guard(createNote), updateNote: guard(updateNote), updateNoteLink: guard(updateNoteLink),
    togglePinNote: guard(togglePinNote), deleteNote: guard(deleteNote), deleteNotes: guard(deleteNotes),
    uploadDocument: guard(uploadDocument), renameDocument: guard(renameDocument),
    tagDocumentSession: guard(tagDocumentSession), deleteDocument: guard(deleteDocument),
    getDocumentUrl,
    refresh,
  };
}
