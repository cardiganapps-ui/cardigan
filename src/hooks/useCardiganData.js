import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "../supabaseClient";
import { formatShortDate, normalizeShortDate, parseShortDate, toISODate } from "../utils/dates";
import {
  ADMIN_EMAIL,
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
import { computeAutoExtendRows } from "../utils/recurrence";

// Module-level lock to prevent concurrent auto-extend from duplicating sessions.
let _extending = false;

function mapRows(rows) {
  // Normalize `date` to the canonical "D-MMM" form so the UI doesn't have to
  // care whether historical rows were saved with a space separator. New
  // writes already go through formatShortDate (which emits "D-MMM"); this
  // covers any rows that predate migration 008_date_format_hyphens.sql.
  return (rows || []).map(r => ({
    ...r,
    date: r.date ? normalizeShortDate(r.date) : r.date,
    colorIdx: r.color_idx,
    modality: r.modality || "presencial",
  }));
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
    // Defense-in-depth: skip fetch if no user. Without this guard, Supabase
    // would return rows for any user_id = null, which is a data-leak smell.
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    setFetchError("");
    const q = (table, limit) => {
      let query = supabase.from(table).select("*").eq("user_id", userId);
      if (limit) query = query.limit(limit);
      return query;
    };
    // Scaling windows: most daily use (Home, Agenda, Finances current view)
    // only touches recent rows, so we don't hydrate years of history on
    // every login. Older rows become visible via per-screen "load more"
    // (expediente, Finances filter) — not implemented yet but the data
    // model and shape stay compatible.
    const now = new Date();
    const paymentsSince = new Date(now); paymentsSince.setMonth(now.getMonth() - 12);
    // Fetch the full session history for accounting. The amountDue
    // calculation iterates every non-cancelled session, so a `created_at`
    // window would silently drop sessions that pre-date it — past
    // completed sessions would vanish from the "consumed" side and old
    // future-scheduled sessions would vanish from the "to-subtract" side,
    // both of which have been reported in the wild as inflated balances.
    let pRes, sRes, pmRes, nRes, dRes;
    try {
      [pRes, sRes, pmRes, nRes, dRes] = await Promise.all([
        q("patients").order("name"),
        q("sessions", 10000).order("created_at"),
        q("payments", 2000).gte("created_at", paymentsSince.toISOString()).order("created_at", { ascending: false }),
        q("notes", 500).order("updated_at", { ascending: false }),
        q("documents", 500).order("created_at", { ascending: false }),
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

    // Auto-extend recurring sessions (skip in read-only or if already extending).
    // The decision logic — which dates to insert for which schedule —
    // lives in utils/recurrence.js as a pure function so it can be
    // unit-tested without supabase. This module is responsible only
    // for the side effects (insert + counter update).
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

        // Accumulate the rows returned by each insert + the fresh
        // patient counter figures. Previously we discarded these and
        // re-ran the top-level fetch to reload canonical state —
        // ~200-400 ms round-trip on every cold start of a user with
        // active recurring patients. The inserted row set + the
        // patient (sessions, billed) targets we just computed are
        // exactly the canonical state, so merge locally instead.
        const insertedRows = [];
        const patientUpdates = new Map();

        for (const patient of pData) {
          const allPSess = sData.filter(s => s.patient_id === patient.id);
          const rows = computeAutoExtendRows({ patient, allPSess, today, threshold, extendEnd, userId });
          if (rows.length === 0) continue;

          const { data, error } = await supabase.from("sessions").insert(rows).select();
          if (!error && data) {
            insertedRows.push(...data);
            const newSessions = patient.sessions + data.length;
            const newBilled = patient.billed + patient.rate * data.length;
            const { error: pErr } = await supabase.from("patients")
              .update({ sessions: newSessions, billed: newBilled })
              .eq("id", patient.id);
            if (pErr) {
              const fixed = await recalcPatientCounters(patient.id);
              if (fixed) patientUpdates.set(patient.id, fixed);
            } else {
              patientUpdates.set(patient.id, { sessions: newSessions, billed: newBilled });
            }
          }
        }

        if (insertedRows.length > 0) {
          sData = [...sData, ...mapRows(insertedRows)];
        }
        if (patientUpdates.size > 0) {
          pData = pData.map(p => {
            const u = patientUpdates.get(p.id);
            return u ? { ...p, ...u } : p;
          });
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
  const { createSession, updateSessionStatus, deleteSession, rescheduleSession, generateRecurringSessions, applyScheduleChange, finalizePatient, updateSessionModality, updateSessionRate, updateCancelReason } =
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
    // amountDue is derived from the actual session rows (via
    // enrichedSessions, which auto-completes past scheduled sessions)
    // rather than the denormalized patient.billed counter. This makes the
    // balance self-healing: any historical drift in patient.billed from
    // past accounting bugs is ignored and the visible number matches the
    // sum of real consumed sessions minus recorded payments.
    const now = new Date();
    const rateById = new Map(patients.map(p => [p.id, p.rate || 0]));
    const consumedByPatient = new Map();
    for (const s of enrichedSessions) {
      if (!s.patient_id) continue;
      // A session counts toward billed once it's been "consumed":
      // completed (real or auto) or cancelled-with-charge. Scheduled
      // future sessions and no-charge cancellations contribute nothing.
      if (s.status !== SESSION_STATUS.COMPLETED && s.status !== SESSION_STATUS.CHARGED) continue;
      // Future-dated completed/charged sessions don't count yet — a
      // cancel-with-charge on a session weeks out, or a future session
      // marked completed ahead of time, would otherwise spike amountDue
      // for an event that hasn't happened. Auto-completed past scheduled
      // sessions always pass this check (they auto-complete *because*
      // their date is past).
      const d = parseShortDate(s.date);
      if (s.time) {
        const [h, m] = s.time.split(":");
        d.setHours(parseInt(h) || 0, parseInt(m) || 0);
      }
      if (d > now) continue;
      const rate = s.rate != null ? s.rate : (rateById.get(s.patient_id) || 0);
      consumedByPatient.set(s.patient_id, (consumedByPatient.get(s.patient_id) || 0) + rate);
    }
    return patients.map(p => {
      const consumed = consumedByPatient.get(p.id) || 0;
      const paid = p.paid || 0;
      const delta = consumed - paid;
      // Mutually exclusive: amountDue > 0 means the patient owes money,
      // credit > 0 means they've prepaid beyond their consumed sessions.
      // UI surfaces amountDue in red and credit in green (as "saldo a
      // favor") wherever the old code showed $0 for at-corriente
      // patients — that hid the fact that prepayers had paid ahead.
      return {
        ...p,
        amountDue: Math.max(0, delta),
        credit:    Math.max(0, -delta),
      };
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
    clearMutationError: () => setMutationError(""),
    createPatient: guard(createPatientWithRefresh), updatePatient: guard(updatePatient), deletePatient: guard(deletePatient),
    createSession: guard(createSession), updateSessionStatus: guard(updateSessionStatus),
    deleteSession: guard(deleteSession), rescheduleSession: guard(rescheduleSession),
    generateRecurringSessions: guard(generateRecurringSessions), applyScheduleChange: guard(applyScheduleChange),
    finalizePatient: guard(finalizePatient), updateSessionModality: guard(updateSessionModality), updateSessionRate: guard(updateSessionRate),
    updateCancelReason: guard(updateCancelReason),
    createPayment: guard(createPayment), deletePayment: guard(deletePayment), updatePayment: guard(updatePayment),
    createNote: guard(createNote), updateNote: guard(updateNote), updateNoteLink: guard(updateNoteLink),
    togglePinNote: guard(togglePinNote), deleteNote: guard(deleteNote), deleteNotes: guard(deleteNotes),
    uploadDocument: guard(uploadDocument), renameDocument: guard(renameDocument),
    tagDocumentSession: guard(tagDocumentSession), deleteDocument: guard(deleteDocument),
    getDocumentUrl,
    refresh,
  };
}
