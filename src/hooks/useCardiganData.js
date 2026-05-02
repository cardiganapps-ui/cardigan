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
import { createMeasurementActions } from "./useMeasurements";
import { recalcPatientCounters } from "../utils/patients";
import { getTutorReminders } from "../utils/sessions";
import { computeAutoExtendRows } from "../utils/recurrence";
import { enrichPatientsWithBalance } from "../utils/accounting";

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
  } catch (e) {
    // Admin-tooling diagnostic — keeps the failure visible in devtools
    // so a "why is the admin list empty?" trace has a starting point.
    // Not user-facing; the admin sees a graceful empty list either way.
    console.error("fetchAllAccounts: patients query failed", e);
  }
  try {
    const { data } = await supabase.rpc("get_user_profiles");
    profileData = data || [];
  } catch (e) {
    console.error("fetchAllAccounts: get_user_profiles RPC failed", e);
  }
  // Subscription/comp/referral state per user. Admin RLS allows
  // SELECT across all rows. A failure here is non-fatal — the panel
  // still works without comp badges.
  let subscriptionData = [];
  try {
    const { data } = await supabase.from("user_subscriptions")
      .select("user_id, status, current_period_end, comp_granted, comp_granted_at, comp_reason, referral_rewards_count, default_payment_method, trial_extension_days");
    subscriptionData = data || [];
  } catch (e) {
    console.error("fetchAllAccounts: user_subscriptions query failed", e);
  }

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
      profession: prof.profession || "psychologist",
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
        profession: "psychologist",
      });
    }
    accounts.get(p.user_id).patientCount++;
  });
  subscriptionData.forEach(sub => {
    const acct = accounts.get(sub.user_id);
    if (!acct) return; // sub for an auth user we didn't list — skip
    acct.subscriptionStatus = sub.status || null;
    acct.subscriptionPeriodEnd = sub.current_period_end || null;
    acct.compGranted = !!sub.comp_granted;
    acct.compReason = sub.comp_reason || null;
    acct.compGrantedAt = sub.comp_granted_at || null;
    acct.referralRewardsCount = sub.referral_rewards_count || 0;
    acct.defaultPaymentMethod = sub.default_payment_method || null;
    acct.trialExtensionDays = sub.trial_extension_days || 0;
  });

  // Compute access tier per account so AdminPanel can render a
  // single accurate badge per row instead of guessing from the raw
  // status field. Mirrors the gate logic in
  // src/hooks/useSubscription.js so admin + user views agree:
  //   - "pro"     paid sub with a card on file
  //   - "comp"    admin-granted complimentary access
  //   - "trial"   inside the 30-day window (+any earned extension)
  //   - "expired" trial lapsed, no active sub
  const TRIAL_DAYS = 30;
  const PAID = new Set(["active", "past_due"]);
  for (const acct of accounts.values()) {
    if (acct.compGranted) {
      acct.tier = "comp";
      acct.daysLeftInTrial = null;
      continue;
    }
    const status = acct.subscriptionStatus;
    const paid = status && (
      PAID.has(status)
      || (status === "trialing" && !!acct.defaultPaymentMethod)
    );
    if (paid) {
      acct.tier = "pro";
      acct.daysLeftInTrial = null;
      continue;
    }
    // No paid sub: is the trial window still open?
    const created = acct.firstSeen ? new Date(acct.firstSeen).getTime() : null;
    if (!created || Number.isNaN(created)) {
      // Missing created_at — treat as expired so we don't accidentally
      // grant write access to a row we can't verify.
      acct.tier = "expired";
      acct.daysLeftInTrial = null;
      continue;
    }
    const totalDays = TRIAL_DAYS + (acct.trialExtensionDays || 0);
    const trialEndMs = created + totalDays * 86_400_000;
    const daysLeft = Math.max(0, Math.ceil((trialEndMs - now) / 86_400_000));
    if (now < trialEndMs) {
      acct.tier = "trial";
      acct.daysLeftInTrial = daysLeft;
    } else {
      acct.tier = "expired";
      acct.daysLeftInTrial = 0;
    }
  }
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
    try { const j = await res.json(); msg = j.error || msg; } catch { /* fall through to default msg */ }
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
    try { const j = await res.json(); msg = j.error || msg; } catch { /* fall through to default msg */ }
    throw new Error(msg);
  }
  return res.json();
}

export async function adminUpdateProfession(userId, profession) {
  const headers = await authHeaders();
  const res = await fetch("/api/admin-update-profession", {
    method: "POST",
    headers,
    body: JSON.stringify({ userId, profession }),
  });
  if (!res.ok) {
    let msg = "Update failed";
    try { const j = await res.json(); msg = j.error || msg; } catch { /* fall through to default msg */ }
    throw new Error(msg);
  }
  return res.json();
}

/* Toggle complimentary (always-free) access on a user's
   user_subscriptions row. Admin-gated server-side. */
export async function adminGrantComp(userId, granted, reason) {
  const headers = await authHeaders();
  const res = await fetch("/api/admin-grant-comp", {
    method: "POST",
    headers,
    body: JSON.stringify({ user_id: userId, granted, reason: reason || null }),
  });
  if (!res.ok) {
    let msg = "Grant failed";
    try { const j = await res.json(); msg = j.error || msg; } catch { /* fall through to default msg */ }
    throw new Error(msg);
  }
  return res.json();
}

/**
 * Pulls the headline numbers for the AdminPanel "Métricas" tab. Both
 * RPCs are admin-gated server-side via is_admin(); a non-admin caller
 * gets a thrown error.
 *
 * Returned shape:
 *   { overview: {...counts and sums...}, daily: [{ day, signups, active_users, ... }] }
 */
export async function fetchAdminAnalytics({ days = 30 } = {}) {
  const [ovRes, dailyRes] = await Promise.all([
    supabase.rpc("admin_analytics_overview"),
    supabase.rpc("admin_analytics_daily", { days }),
  ]);
  if (ovRes.error) throw ovRes.error;
  if (dailyRes.error) throw dailyRes.error;
  return { overview: ovRes.data, daily: dailyRes.data || [] };
}

/* Run the admin-only accounting drift audit. Heavy server-side scan;
   the API endpoint requireAdmin-gates so a non-admin can never invoke
   it. Throws on transport errors; otherwise returns the JSON shape
   defined in api/admin-audit-accounting.js. */
export async function fetchAdminAccountingAudit() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch("/api/admin-audit-accounting", {
    method: "GET",
    headers: { "Authorization": `Bearer ${token}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
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

export function useCardiganData(user, viewAsUserId, options = {}) {
  const userId = viewAsUserId || user?.id;
  const readOnly = !!viewAsUserId;
  const noteCrypto = options.noteCrypto;
  const [patients, setPatients] = useState([]);
  const [upcomingSessions, setUpcomingSessions] = useState([]);
  const [payments, setPayments] = useState([]);
  const [notes, setNotes] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [measurements, setMeasurements] = useState([]);
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
    let pRes, sRes, pmRes, nRes, dRes, mRes;
    try {
      [pRes, sRes, pmRes, nRes, dRes, mRes] = await Promise.all([
        q("patients").order("name"),
        q("sessions", 10000).order("created_at"),
        q("payments", 2000).gte("created_at", paymentsSince.toISOString()).order("created_at", { ascending: false }),
        q("notes", 500).order("updated_at", { ascending: false }),
        q("documents", 500).order("created_at", { ascending: false }),
        // Measurements are tiny (one row per nutri/trainer visit) so we
        // pull a generous window. Most accounts won't have any.
        q("measurements", 2000).order("taken_at", { ascending: false }),
      ]);
    } catch (err) {
      setFetchError(err.message || "Error al cargar datos");
      setLoading(false);
      return;
    }

    // Surface individual table errors
    const tableErr = [pRes, sRes, pmRes, nRes, dRes, mRes].find(r => r.error);
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
    // Decrypt any encrypted notes inline if the user is unlocked.
    // Locked rows keep their ciphertext + encrypted=true flag and are
    // displayed as "[cifrado]" by the consumer until unlock triggers
    // a re-fetch.
    let notesData = nRes.data || [];
    if (noteCrypto?.decrypt) {
      notesData = await Promise.all(notesData.map(async (n) => {
        if (!n.encrypted) return n;
        const plain = await noteCrypto.decrypt(n.content, true);
        return plain == null ? n : { ...n, content: plain };
      }));
    }
    setNotes(notesData);
    setDocuments(dRes.data || []);
    setMeasurements(mRes.data || []);
    setLoading(false);
    // Re-run when the crypto status flips so encrypted notes get
    // re-fetched + decrypted right after the user unlocks. We can't
    // include the encrypt/decrypt fns in deps directly because they
    // change identity on every status transition; the boolean is the
    // correct invariant to depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, readOnly, noteCrypto?.canEncrypt]);

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
    createNoteActions(userId, notes, setNotes, setMutating, setMutationError, noteCrypto);
  const { uploadDocument, renameDocument, tagDocumentSession, deleteDocument, getDocumentUrl } =
    createDocumentActions(userId, documents, setDocuments, setMutating, setMutationError);
  const { createMeasurement, updateMeasurement, deleteMeasurement } =
    createMeasurementActions(userId, measurements, setMeasurements, setMutating, setMutationError);

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

  // amountDue / credit follow the canonical formula in CLAUDE.md — and
  // CRITICALLY iterate the raw DB sessions (upcomingSessions), not the
  // display-enriched ones. The auto-complete in enrichedSessions is a UI
  // affordance; feeding it into accounting would make every past
  // un-maintained scheduled session silently count as "consumed" and
  // inflate balances by months of phantom activity.
  const enrichedPatients = useMemo(
    () => enrichPatientsWithBalance(patients, upcomingSessions),
    [patients, upcomingSessions]
  );

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
    patients: enrichedPatients, upcomingSessions: enrichedSessions, payments, notes, documents, measurements,
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
    createMeasurement: guard(createMeasurement),
    updateMeasurement: guard(updateMeasurement),
    deleteMeasurement: guard(deleteMeasurement),
    refresh,
  };
}
