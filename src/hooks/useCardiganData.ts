import { useEffect, useState, useCallback, useMemo } from "react";
import { loadCachedData, saveCachedData } from "../lib/dataCache";
import { syncWidgets } from "../lib/widgetSync";
import { supabase } from "../supabaseClient";
import type { Database } from "../types/supabase";
import type {
  PatientRow, SessionRow, PaymentRow, NoteRow, DocumentRow, MeasurementRow,
  ExpenseRow, RecurringExpenseRow, RescheduleRequestRow, TagRow, TagLinkRow,
  NoteAttachmentRow, GroupRow, GroupMemberRow, NotificationRow,
} from "../types/rows";
import { formatShortDate, normalizeShortDate, toISODate } from "../utils/dates";
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
import { createNoteTagActions } from "./useNoteTags";
import { createNoteAttachmentActions } from "./useNoteAttachments";
import { createDocumentActions } from "./useDocuments";
import { createExpenseActions } from "./useExpenses";
import { createMeasurementActions } from "./useMeasurements";
import { createGroupActions } from "./useGroups";
import { createInboxActions } from "./useInbox";
import { getTutorReminders } from "../utils/sessions";
import { computeAutoExtendRows, computeRecurringExpenseRows } from "../utils/recurrence";
import { computeGroupAutoExtendRows } from "../utils/groupRecurrence";
import { computeConsumedByPatient, applyConsumedToPatients, mergeBaseConsumed, sessionEndMoment } from "../utils/accounting";
import { fetchAllPaged } from "../utils/paginate";
import { useFocusRefresh } from "./useFocusRefresh";

// ── Shared shapes ───────────────────────────────────────────────────
/** The optional client-side note-encryption bag threaded through the
    note/tag/attachment factories. Each factory consumes a subset. */
interface NoteCryptoBag {
  encrypt?: (plain: string) => { content: string; encrypted: boolean } | Promise<{ content: string; encrypted: boolean }>;
  decrypt?: (content: string, encrypted: boolean) => Promise<string | null>;
  canEncrypt?: boolean;
  encryptAttachmentBytes?: (bytes: Uint8Array<ArrayBuffer>) => Promise<{ ciphertext: Uint8Array<ArrayBuffer>; iv: string } | null>;
}

/* The coordinator fans out 15 heterogeneous table reads via
   Promise.allSettled, whose result is a union of 15 different
   PostgrestResponse shapes. We unwrap each to this uniform shape — `data`
   stays `unknown` because the union can't be narrowed structurally here;
   each commit site below casts it to the concrete row type (PatientRow[],
   SessionRow[], …) right before it lands in typed state. That keeps the
   per-table typing at the boundary that matters (the state the factories +
   consumers read) without fighting the allSettled union. */
type FetchResult = { data: unknown; error: { message?: string; code?: string } | null };

// The public tables that carry a user_id column — the only ones the
// per-user fetch helper q() can filter on. Constrains q's table param so
// a table without user_id can't be passed (which would silently filter
// on a nonexistent column).
type TableWithUserId = {
  [K in keyof Database["public"]["Tables"]]:
    "user_id" extends keyof Database["public"]["Tables"][K]["Row"] ? K : never;
}[keyof Database["public"]["Tables"]];

/** The localStorage snapshot shape hydrated on cold start. */
interface CachedData {
  patients?: PatientRow[];
  upcomingSessions?: SessionRow[];
  payments?: PaymentRow[];
  notes?: NoteRow[];
  documents?: DocumentRow[];
  measurements?: MeasurementRow[];
  expenses?: ExpenseRow[];
  recurringExpenses?: RecurringExpenseRow[];
  rescheduleRequests?: RescheduleRequestRow[];
  tags?: TagRow[];
  tagLinks?: TagLinkRow[];
  noteAttachments?: NoteAttachmentRow[];
  groups?: GroupRow[];
  groupMembers?: GroupMemberRow[];
  notifications?: NotificationRow[];
  /** Windowing consumed base (patient_id → Σ rate of pre-cutoff counting
      sessions). Cached alongside the windowed rows so cold-start
      balances from cache are complete, never understated. */
  sessionsOldConsumed?: Record<string, number> | null;
}

/* ── Session-history windowing (migration 086) ──
   When VITE_SESSION_WINDOW_MONTHS is a positive number, the client stops
   hydrating the patient's ENTIRE session history and instead fetches
   (a) rows created within the window plus (b) still-future scheduled
   rows of any age (Agenda / auto-extend / slot-conflict inputs), via
   public.fetch_sessions_windowed. The excluded history's contribution
   to `consumed` arrives as a per-patient aggregate from
   public.session_consumed_before — same canonical predicate
   (session_counts_at), CI-parity-locked against the JS one. The two
   sets partition the history on ONE cutoff per load, so
   consumed = aggregate + JS-walk(fetched) equals the old full walk.
   Unset / 0 → windowing OFF, byte-for-byte the previous behavior.
   Prime-directive coupling: if the aggregate call fails, the sessions
   fetch is treated as failed too — we NEVER show balances computed
   from a partial history. */
const SESSION_WINDOW_MONTHS = Number(import.meta.env.VITE_SESSION_WINDOW_MONTHS || 0) || 0;

/** Exposed for the expediente's "older history" backfill affordance —
    it only renders when windowing actually trims what's hydrated. */
export const SESSION_WINDOWING_ACTIVE = SESSION_WINDOW_MONTHS > 0;

/** The same cutoff instant the windowed fetch/aggregate use, recomputed
    at call time. Backfill readers query `created_at < cutoff`; a row
    created between load and click lands in both sets, so display
    merges must dedupe by id. */
export function sessionWindowCutoffIso(): string | null {
  if (SESSION_WINDOW_MONTHS <= 0) return null;
  const c = new Date();
  c.setMonth(c.getMonth() - SESSION_WINDOW_MONTHS);
  return c.toISOString();
}

// Module-level lock to prevent concurrent auto-extend from duplicating sessions.
let _extending = false;
// Sibling lock for group session auto-extend (same rationale as _extending).
let _extendingGroups = false;
// Sibling lock for recurring-expense generation. The DB-side partial unique
// index `uniq_expenses_recurring_period` is the cross-device truth; this
// flag just prevents within-tab races (e.g. fast re-renders or a refresh
// triggered before the previous insert resolves).
let _generatingExpenses = false;

function mapRows<T extends Record<string, unknown>>(rows: T[] | null | undefined): T[] {
  // Normalize `date` to the canonical "D-MMM" form so the UI doesn't have to
  // care whether historical rows were saved with a space separator. New
  // writes already go through formatShortDate (which emits "D-MMM"); this
  // covers any rows that predate migration 008_date_format_hyphens.sql.
  return (rows || []).map(r => ({
    ...r,
    date: r.date ? normalizeShortDate(r.date as string) : r.date,
    colorIdx: r.color_idx,
    modality: r.modality || "presencial",
  })) as T[];
}

export function isAdmin(user?: { email?: string | null; [key: string]: unknown } | null) {
  return user?.email === ADMIN_EMAIL;
}

// Test-only surface. `mapRows` is the read-path normalizer documented in
// CLAUDE.md (date "D-MMM" canonicalization, color_idx→colorIdx, modality
// default) — a landmine the rest of the app trusts implicitly, so it gets
// pinned by unit tests via this handle. Mirrors the `_internals` pattern in
// api/_calendar.js. Not part of the public hook surface.
export const _internals = { mapRows };

// ── Admin API (moved to ../lib/adminApi) ──
// These admin-only fetchers/mutations used to live here but have nothing
// to do with the per-user data path; they were extracted to keep this
// prime-directive coordinator lean. Re-exported so the ~17 existing
// importers don't churn.
export type { AdminAccount } from "../lib/adminApi";
export {
  fetchAllAccounts, adminBlockUser, adminNotify, adminDeleteUser,
  adminUpdateProfession, fetchAdminSavedViews, createAdminSavedView,
  updateAdminSavedView, deleteAdminSavedView, adminRecoverEncryption,
  adminGrantComp, fetchInfluencerCodes, createInfluencerCode,
  toggleInfluencerCode, fetchAdminAnalytics, fetchSignupSources,
  fetchBugReports, archiveBugReports, deleteBugReport, fetchUserDetail,
  fetchAuditLog, fetchRevenueOverview, fetchRecentInvoices,
  fetchUserRatings, logAdminViewAs,
} from "../lib/adminApi";

export function useCardiganData(
  user?: { id?: string; email?: string | null } | null,
  viewAsUserId?: string | null,
  options: { noteCrypto?: NoteCryptoBag } = {},
) {
  const userId = viewAsUserId || user?.id || "";
  const readOnly = !!viewAsUserId;
  const noteCrypto = options.noteCrypto;
  /* Stale-while-revalidate hydration: read the user's last-seen
     snapshot before useState so the initial render uses cached rows
     instead of empty arrays + a skeleton. The fetch still runs (in
     refresh below) — when it finishes it overwrites this with fresh
     data. Result: cold-start time-to-first-meaningful-paint drops
     from "supabase round-trip" to "localStorage read" (microseconds).
     For viewAsUserId (admin "view as") the cache key is the target
     user's id, not the admin's — separate cache per identity, no
     leak. Logged-out / pre-auth render gets null and falls through
     to empty arrays + the loading skeleton, same as before. */
  const initialCache = useMemo(() => loadCachedData(userId) as CachedData | null, [userId]);
  const [patients, setPatients] = useState(initialCache?.patients || []);
  const [upcomingSessions, setUpcomingSessions] = useState(initialCache?.upcomingSessions || []);
  // Windowed-history consumed base (see SESSION_WINDOW_MONTHS above).
  // null when windowing is off. Committed ATOMICALLY with
  // upcomingSessions — the pair must always describe the same cutoff.
  const [oldConsumed, setOldConsumed] = useState<Record<string, number> | null>(initialCache?.sessionsOldConsumed || null);
  const [payments, setPayments] = useState(initialCache?.payments || []);
  const [notes, setNotes] = useState(initialCache?.notes || []);
  const [documents, setDocuments] = useState(initialCache?.documents || []);
  const [measurements, setMeasurements] = useState(initialCache?.measurements || []);
  const [expenses, setExpenses] = useState(initialCache?.expenses || []);
  const [recurringExpenses, setRecurringExpenses] = useState(initialCache?.recurringExpenses || []);
  // Patient-submitted reschedule requests waiting on this therapist's
  // accept/reject. Only `pending` rows hydrate into state — resolved
  // history surfaces only when the admin / audit script asks for it.
  const [rescheduleRequests, setRescheduleRequests] = useState(initialCache?.rescheduleRequests || []);
  // Note tags (Phase 1.3). `tags` holds the per-user tag catalog
  // with the label field already decrypted for in-memory render;
  // `tagLinks` is the many-to-many join (note_id, tag_id).
  const [tags, setTags] = useState(initialCache?.tags || []);
  const [tagLinks, setTagLinks] = useState(initialCache?.tagLinks || []);
  // Note attachments (Phase 5). Image rows keyed by note_id; the
  // editor strip filters down to attachments for the open note.
  // Soft-deleted rows are filtered out at fetch time so the live
  // state is always the user-visible set.
  const [noteAttachments, setNoteAttachments] = useState(initialCache?.noteAttachments || []);
  // Groups (Grupos): the recurring schedule template + roster. Group
  // occurrences live in `upcomingSessions` as ordinary rows tagged with
  // group_id — these two arrays are just the template + membership.
  const [groups, setGroups] = useState(initialCache?.groups || []);
  const [groupMembers, setGroupMembers] = useState(initialCache?.groupMembers || []);
  const [notifications, setNotifications] = useState(initialCache?.notifications || []);
  // Skeleton stays hidden when we hydrated from cache — the user
  // sees their data immediately. Skeleton fires only on a true cold
  // start (no cache, fresh login, or after the cache aged out).
  const [loading, setLoading] = useState(!initialCache);
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
    // Generic over the table name so `.from(table)` validates the table
    // exists and `.eq("user_id", …)` / `.select("*")` are checked against
    // that table's columns at compile time. Avoid reassigning `query`
    // (the limit() result is a different builder type) — branch instead.
    const q = <T extends TableWithUserId>(table: T, limit?: number) => {
      // Table name is validated at the call site (T is constrained to
      // tables that HAVE user_id). The .eq column is cast because TS
      // can't prove a column on an abstract generic body — safe here by
      // that very constraint.
      const base = supabase.from(table).select("*").eq("user_id" as never, userId as never);
      return limit ? base.limit(limit) : base;
    };
    // Sessions are special: accounting sums over the patient's ENTIRE
    // history (every completed / charged / past-scheduled row), so unlike
    // the windowed tables they CANNOT be capped. The PostgREST server
    // enforces max_rows = 1000 per request, so the old `.limit(10000)` was
    // never honored past 1000 — a practice with >1000 lifetime sessions
    // (a few years of weekly recurring slots) would silently drop the
    // overflow from `consumed` and understate every balance. Page through
    // the full set with .range() via the pure fetchAllPaged helper. The id
    // tiebreaker keeps paging stable when a batch of rows shares one
    // created_at (the auto-extend insert writes many at the same instant).
    // Returns the same { data, error } shape as `q(...)`.
    // Windowing cutoff — ONE value per load, shared verbatim by the
    // windowed fetch and the consumed aggregate so the two sets
    // partition the history exactly (no double count, no gap).
    const sessionCutoffIso = SESSION_WINDOW_MONTHS > 0
      ? (() => { const c = new Date(); c.setMonth(c.getMonth() - SESSION_WINDOW_MONTHS); return c.toISOString(); })()
      : null;
    const fetchAllSessions = () => fetchAllPaged(
      async (from, to) => {
        // Windowed: recent rows + still-future scheduled rows of any age
        // (the RPC is `returns setof sessions`, so ordering/paging apply
        // the same as the table read). The rpc name/args casts bridge
        // until the generated types include migration 086.
        const base = sessionCutoffIso
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types until 086 lands in supabase gen
          ? (supabase.rpc as any)("fetch_sessions_windowed", { p_cutoff: sessionCutoffIso })
          : supabase.from("sessions").select("*").eq("user_id", userId);
        const res = await base
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        return { data: res.data, error: res.error };
      },
      { pageSize: 1000 }
    );
    // Scaling windows: most daily use (Home, Agenda, Finances current view)
    // only touches recent rows, so we don't hydrate years of history on
    // every login. Older rows become visible via per-screen "load more"
    // (expediente, Finances filter) — not implemented yet but the data
    // model and shape stay compatible.
    const now = new Date();
    const paymentsSince = new Date(now); paymentsSince.setMonth(now.getMonth() - 12);
    // Sessions: full history when windowing is off. When windowing is ON
    // (SESSION_WINDOW_MONTHS), a bare created_at window would silently
    // drop pre-cutoff counting sessions from `consumed` (the historical
    // inflated/understated-balance bug class) — which is exactly why the
    // windowed path pairs the fetch with session_consumed_before and
    // treats the pair as one atomic read (see coupling below).
    // Expenses share the payments window — a 12-month rolling view is
    // plenty for the Gastos / Resumen tabs. Older years are still
    // queryable via the CSV export endpoint when the contador needs them.
    const expensesSince = paymentsSince;
    let pRes: FetchResult, sRes: FetchResult, pmRes: FetchResult, nRes: FetchResult, dRes: FetchResult, mRes: FetchResult, eRes: FetchResult, reRes: FetchResult, rrRes: FetchResult;
    let tRes: FetchResult, tlRes: FetchResult, naRes: FetchResult, gRes: FetchResult, gmRes: FetchResult, nfRes: FetchResult, aggRes: FetchResult;
    try {
      const settled = await Promise.allSettled([
        q("patients").order("name"),
        fetchAllSessions(),
        q("payments", 2000).gte("created_at", paymentsSince.toISOString()).order("created_at", { ascending: false }),
        q("notes", 500).order("updated_at", { ascending: false }),
        q("documents", 500).order("created_at", { ascending: false }),
        // Measurements are tiny (one row per nutri/trainer visit) so we
        // pull a generous window. Most accounts won't have any.
        q("measurements", 2000).order("taken_at", { ascending: false }),
        q("expenses", 2000).gte("created_at", expensesSince.toISOString()).order("date", { ascending: false }),
        q("recurring_expenses", 200).order("created_at", { ascending: false }),
        // Pending reschedule requests only — resolved history surfaces
        // via the admin/audit paths, not the live UI.
        q("session_reschedule_requests", 200).eq("status", "pending").order("created_at", { ascending: false }),
        // Note tags (Phase 1.3). The label_ciphertext column needs a
        // decrypt pass on the client; the noteCrypto bag below does
        // the work. Caps roughly match what a user can sanely create
        // (1000 tags × hundreds of links is plenty headroom).
        q("note_tags", 1000).order("created_at", { ascending: false }),
        // note_tag_links has NO user_id column — it's scoped by RLS via
        // the tag relationship (note_tags.user_id = auth.uid()). The old
        // q("note_tag_links") added .eq("user_id", …) on a nonexistent
        // column, so PostgREST errored and tag links loaded EMPTY. Query
        // it directly; RLS does the scoping. (Bug surfaced by typing the
        // client against the generated schema.)
        supabase.from("note_tag_links").select("*").limit(5000),
        // Note attachments (Phase 5). Live rows only — the
        // `deleted_at is null` partial index makes this filter cheap.
        q("note_attachments", 2000).is("deleted_at", null).order("created_at", { ascending: false }),
        // Groups (Grupos) — recurring schedule templates + roster. Both are
        // small (a handful of groups, a few members each) so no window.
        q("groups", 500).order("created_at"),
        q("group_members", 5000),
        // In-app notification inbox (migration 077). Newest-first; a
        // generous window since rows are small and the inbox shows recent
        // activity. Read/cleared via the inbox actions below.
        q("notifications", 200).order("created_at", { ascending: false }),
        // Windowing consumed aggregate — pre-cutoff Σ(rate) per patient.
        // Resolved stub when windowing is off so the positional unwrap
        // below stays uniform.
        sessionCutoffIso
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types until 086 lands in supabase gen
          ? (supabase.rpc as any)("session_consumed_before", { p_cutoff: sessionCutoffIso })
          : Promise.resolve({ data: null, error: null }),
      ]);
      // allSettled (not all): a single REJECTED query — a connection
      // dropped mid-flight, say — must not blank the entire hydration.
      // The other 14 tables still load and the failure surfaces via
      // tableErr below. Map a rejection to the same { data, error } shape
      // a resolved-with-error query produces so the read path stays
      // uniform (mapRows(null) → [], etc.).
      // Unwrap to a uniform { data, error } shape. data is intentionally
      // loose here (the read path normalizes every row through mapRows and
      // treats them dynamically); the typed-client value is concentrated at
      // the .from(table) table check above and the .insert/.update shape
      // checks in the domain hooks, plus the per-table casts at each commit
      // site below. Per-table read typing would fight the allSettled union.
      [pRes, sRes, pmRes, nRes, dRes, mRes, eRes, reRes, rrRes, tRes, tlRes, naRes, gRes, gmRes, nfRes, aggRes] =
        settled.map((r): FetchResult => r.status === "fulfilled"
          ? (r.value as FetchResult)
          : { data: null, error: { message: (r.reason as Error)?.message || "Error de red" } });
      // PRIME-DIRECTIVE COUPLING: windowed sessions + the consumed
      // aggregate are one logical read. If the aggregate failed, treat
      // the sessions read as failed too — last-known-good state holds,
      // auto-extend skips (its !sRes.error gate), cache isn't persisted.
      // Balances computed from a partial history must never render.
      if (sessionCutoffIso && aggRes?.error && !sRes.error) {
        sRes = { data: null, error: aggRes.error };
      }
    } catch (err) {
      // Defensive — allSettled itself never rejects; this only catches a
      // synchronous throw while building the queries.
      setFetchError((err as Error)?.message || "Error al cargar datos");
      setLoading(false);
      return;
    }

    // Surface individual table errors
    const tableErr = [pRes, sRes, pmRes, nRes, dRes, mRes, eRes, reRes, rrRes, gRes, gmRes].find(r => r?.error);
    if (tableErr) setFetchError(tableErr.error?.message || "Error al cargar datos");

    // Per-table narrowing cast (the allSettled unwrap left `.data` as
    // `unknown`): from here down these are the concrete row types the
    // factories + consumers read. mapRows normalizes each (date / colorIdx /
    // modality) and preserves the row type.
    let pData = mapRows(pRes.data as PatientRow[]);
    let sData = mapRows(sRes.data as SessionRow[]);
    const gData = mapRows(gRes?.data as GroupRow[] | undefined);
    const gmData = (gmRes?.data as GroupMemberRow[]) || [];

    // Auto-extend recurring sessions (skip in read-only or if already extending).
    // The decision logic — which dates to insert for which schedule —
    // lives in utils/recurrence.js as a pure function so it can be
    // unit-tested without supabase. This module is responsible only
    // for the side effects (insert + counter update).
    //
    // PRIME DIRECTIVE: never make schedule-insert decisions off a FAILED
    // read. If the patients or sessions fetch errored (allSettled mapped
    // it to { data: null }), pData/sData are empty and computing
    // auto-extend rows against that incomplete history risks regenerating
    // phantom slots. Skip entirely until a clean read lands.
    if (userId && !readOnly && !_extending && !pRes.error && !sRes.error) {
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
        const insertedRows: Record<string, unknown>[] = [];
        const patientUpdates = new Map<string, { sessions: number }>();

        // User-level occupied-slot set, scoped to match the DB index
        // `uniq_sessions_user_slot (user_id, date, time) WHERE
        // status='scheduled' AND group_id IS NULL`. computeAutoExtendRows
        // only dedups against the patient's OWN rows, so a generated row
        // for patient B landing on a (date,time) already held by patient A
        // would pass that check and then trip 23505 — which, because the
        // insert is one atomic statement, killed patient B's ENTIRE batch
        // and re-failed on every load. We reserve slots here (across
        // patients within this pass too) so we never attempt a colliding
        // insert. (bug-hunt #7)
        const occupiedUserSlots = new Set(
          sData
            .filter(s => s.status === SESSION_STATUS.SCHEDULED && !s.group_id)
            .map(s => `${s.date}|${s.time}`)
        );

        for (const patient of pData) {
          // Episodic patients have no perpetual slot — the practitioner
          // schedules the next visit at the end of each consult. Skip
          // auto-extend entirely. (computeAutoExtendRows would no-op
          // anyway since they own zero is_recurring=true rows; this is
          // the explicit guard so the intent is visible to readers and
          // a stray recurring row from manual DB edits can't surprise
          // anyone.)
          if (patient.scheduling_mode === "episodic") continue;
          const allPSess = sData.filter(s => s.patient_id === patient.id);
          const rows = computeAutoExtendRows({ patient, allPSess, today, threshold, extendEnd, userId })
            .filter(r => {
              const slot = `${r.date}|${r.time}`;
              if (occupiedUserSlots.has(slot)) return false; // slot taken → would 23505
              occupiedUserSlots.add(slot);                   // reserve for later patients
              return true;
            });
          if (rows.length === 0) continue;

          const { data, error } = await supabase.from("sessions").insert(rows as Database["public"]["Tables"]["sessions"]["Insert"][]).select();
          if (!error && data) {
            insertedRows.push(...data);
            // patient.sessions and patient.billed are maintained by the
            // trigger (migration 069) that fires on the bulk insert.
            // Locally, sessions counter grows by data.length; billed
            // grows by zero because auto-extend rows are all future-
            // dated (predicate doesn't count them yet).
            const newSessions = patient.sessions + data.length;
            patientUpdates.set(patient.id, { sessions: newSessions });
          }
        }

        if (insertedRows.length > 0) {
          sData = [...sData, ...mapRows(insertedRows as SessionRow[])];
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

    // ── Group session auto-extend ──
    // Analogue of the per-patient pass above, for group occurrences. Each
    // group owns an explicit (day, time) template, so computeGroupAutoExtendRows
    // reads the slot straight off the group row. Fan-out rows are ordinary
    // session rows (one per active member), so the counter trigger maintains
    // each member's billed/sessions server-side just like the patient path.
    // Same phantom-prevention rules (future-only, clamp-at-today) apply.
    // Same failed-read guard as the per-patient pass: a group/member/
    // session fetch error leaves these arrays empty, so don't fan out
    // occurrences off incomplete data.
    if (userId && !readOnly && !_extendingGroups && gData.length > 0
        && !gRes.error && !gmRes.error && !sRes.error && !pRes.error) {
      _extendingGroups = true;
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const threshold = new Date(today);
        threshold.setDate(today.getDate() + RECURRENCE_EXTEND_THRESHOLD_DAYS);
        const extendEnd = toISODate(new Date(today.getTime() + RECURRENCE_WINDOW_WEEKS * 7 * 86400000));
        const patientsById = new Map(pData.map(p => [p.id, p]));

        const insertedRows: Record<string, unknown>[] = [];
        const patientUpdates = new Map<string, number>();
        // Group fan-out rows carry group_id (so uniq_sessions_user_slot,
        // which is group_id IS NULL, doesn't apply) but they DO hit
        // uniq_sessions_patient_date_time (patient_id, date, time). A
        // member who also has an individual session — or a slot from
        // another group — at the same (date,time) would 23505 and, being
        // one atomic insert, sink the whole group's batch on every load.
        // computeGroupAutoExtendRows only dedups within the group's own
        // rows, so reserve slots at the (patient,date,time) grain across
        // ALL fetched rows here. (bug-hunt #7, group half)
        const occupiedPatientSlots = new Set(
          sData
            .filter(s => s.patient_id)
            .map(s => `${s.patient_id}|${normalizeShortDate(s.date)}|${s.time}`)
        );
        for (const group of gData) {
          const members = gmData.filter(m => m.group_id === group.id);
          const groupSessions = sData.filter(s => s.group_id === group.id);
          const rows = computeGroupAutoExtendRows({ group, members, patientsById, groupSessions, today, threshold, extendEnd, userId })
            .filter(r => {
              const slot = `${r.patient_id}|${normalizeShortDate(r.date)}|${r.time}`;
              if (occupiedPatientSlots.has(slot)) return false;
              occupiedPatientSlots.add(slot);
              return true;
            });
          if (rows.length === 0) continue;
          const { data, error } = await supabase.from("sessions").insert(rows as Database["public"]["Tables"]["sessions"]["Insert"][]).select();
          if (!error && data) {
            insertedRows.push(...data);
            data.forEach(r => {
              if (r.patient_id) patientUpdates.set(r.patient_id, (patientUpdates.get(r.patient_id) || 0) + 1);
            });
          }
        }
        if (insertedRows.length > 0) sData = [...sData, ...mapRows(insertedRows as SessionRow[])];
        if (patientUpdates.size > 0) {
          pData = pData.map(p => {
            const inc = patientUpdates.get(p.id);
            return inc ? { ...p, sessions: (p.sessions || 0) + inc } : p;
          });
        }
      } finally {
        _extendingGroups = false;
      }
    }

    // ── Recurring expense auto-generation ──
    // Only the slots within RECURRING_EXPENSE_AUTO_BACKFILL_MONTHS are
    // inserted automatically. Older slots become a "Generar N gastos
    // pendientes" prompt on the Gastos tab, surfaced via the `pending`
    // count returned alongside the data. Per CLAUDE.md prime directive:
    // never silently insert money rows beyond the documented cap.
    let eData = (eRes?.data as ExpenseRow[]) || [];
    const reData = (reRes?.data as RecurringExpenseRow[]) || [];
    // Failed-read guard (money write path): only generate recurring
    // expense rows when BOTH the expenses and recurring_expenses reads
    // succeeded — otherwise computeRecurringExpenseRows could re-create
    // an already-existing slot it just couldn't see.
    if (userId && !readOnly && !_generatingExpenses && reData.length > 0
        && !eRes?.error && !reRes?.error) {
      _generatingExpenses = true;
      try {
        const { auto } = computeRecurringExpenseRows(reData, eData, new Date(), userId);
        if (auto.length > 0) {
          const { data: insertedExpenses, error: insertErr } = await supabase
            .from("expenses")
            .upsert(auto as Database["public"]["Tables"]["expenses"]["Insert"][], {
              onConflict: "recurring_id,period_year,period_month",
              ignoreDuplicates: true,
            })
            .select();
          if (!insertErr && insertedExpenses) {
            const known = new Set(eData.map(e => e.id));
            eData = [...insertedExpenses.filter(r => !known.has(r.id)), ...eData];
          }
          // 23505 / other errors are non-fatal here — the user still
          // sees the Gastos tab populate from existing rows; the next
          // app load retries.
        }
      } finally {
        _generatingExpenses = false;
      }
    }

    // ── Commit per-domain, keeping last-known-good on a per-table error ──
    // A transient failure of ONE table during a background refresh must
    // not wipe that domain to []. allSettled mapped a rejected query to
    // { data: null, error }; committing that would blank the domain — and
    // for patients/sessions/payments would flash a WRONG $0 balance with
    // real money on screen. On error we leave the prior state untouched
    // (the failure still surfaces via the fetch-error toast above); only a
    // clean read replaces the data.
    if (!pRes.error) setPatients(pData);
    // Build the windowing consumed base from the aggregate rows. Committed
    // in the SAME branch as upcomingSessions so the pair always describes
    // one cutoff. Windowing off → explicit null (clears a stale cached
    // base if the flag was just turned off).
    let oldConsumedNext: Record<string, number> | null = null;
    if (sessionCutoffIso && !sRes.error) {
      oldConsumedNext = {};
      for (const r of (aggRes?.data as { patient_id: string; consumed: number }[] | null) || []) {
        if (r?.patient_id) oldConsumedNext[r.patient_id] = Number(r.consumed) || 0;
      }
    }
    if (!sRes.error) {
      setUpcomingSessions(sData);
      setOldConsumed(sessionCutoffIso ? oldConsumedNext : null);
    }
    if (!pmRes.error) setPayments(mapRows(pmRes.data as PaymentRow[]));
    // Decrypt any encrypted notes inline if the user is unlocked.
    // Locked rows keep their ciphertext + encrypted=true flag and are
    // displayed as "[cifrado]" by the consumer until unlock triggers
    // a re-fetch.
    let notesData = (nRes.data as NoteRow[]) || [];
    if (!nRes.error) {
      if (noteCrypto?.decrypt) {
        const decrypt = noteCrypto.decrypt;
        notesData = await Promise.all(notesData.map(async (n) => {
          if (!n.encrypted) return n;
          const plain = await decrypt(n.content ?? "", true);
          return plain == null ? n : { ...n, content: plain };
        }));
      }
      setNotes(notesData);
    }
    // Decrypt tag labels (same envelope as notes). For non-encrypted
    // rows the ciphertext column already holds the plaintext, so we
    // pass it through unchanged. For encrypted rows we run the same
    // decrypt the notes path uses.
    let tagsData = (tRes?.data as TagRow[]) || [];
    if (!tRes?.error) {
      if (noteCrypto?.decrypt) {
        const decrypt = noteCrypto.decrypt;
        tagsData = await Promise.all(tagsData.map(async (t) => {
          const plain = await decrypt(t.label_ciphertext, /* encrypted= */ true).catch(() => null);
          return { ...t, label: plain ?? t.label_ciphertext };
        }));
      } else {
        tagsData = tagsData.map((t) => ({ ...t, label: t.label_ciphertext }));
      }
      setTags(tagsData);
    }
    if (!tlRes?.error) setTagLinks((tlRes?.data as TagLinkRow[]) || []);
    if (!dRes.error) setDocuments((dRes.data as DocumentRow[]) || []);
    if (!mRes.error) setMeasurements((mRes.data as MeasurementRow[]) || []);
    if (!eRes?.error) setExpenses(eData);
    if (!reRes?.error) setRecurringExpenses(reData);
    if (!rrRes?.error) setRescheduleRequests((rrRes?.data as RescheduleRequestRow[]) || []);
    if (!naRes?.error) setNoteAttachments((naRes?.data as NoteAttachmentRow[]) || []);
    if (!gRes?.error) setGroups(gData);
    if (!gmRes?.error) setGroupMembers(gmData);
    if (!nfRes?.error) setNotifications((nfRes?.data as NotificationRow[]) || []);
    setLoading(false);

    /* Persist the fresh snapshot for next cold start. We do this
       AFTER all the in-memory setters fire so the cache and the
       React state are always in sync — if a render aborted
       mid-update we'd still be writing the canonical fetched data,
       not a partial state. Mutations after this point flow through
       in-memory state only; the next refresh () writes the
       up-to-date cache. */
    // Only refresh the cold-start cache when the WHOLE fetch succeeded.
    // Writing a partial snapshot (with the failed domains blanked) would
    // poison the next cold start — the cache would show empty patients /
    // sessions / payments until a full success overwrote it. On any
    // per-table error, keep the last full snapshot instead.
    const anyFetchError = [pRes, sRes, pmRes, nRes, dRes, mRes, eRes, reRes, rrRes, tRes, tlRes, naRes, gRes, gmRes, nfRes, aggRes]
      .some(r => r?.error);
    if (!anyFetchError) {
      saveCachedData(userId, {
        patients: pData,
        upcomingSessions: sData,
        payments: mapRows(pmRes.data as PaymentRow[]),
        notes: notesData,
        documents: (dRes.data as DocumentRow[]) || [],
        measurements: (mRes.data as MeasurementRow[]) || [],
        expenses: eData,
        recurringExpenses: reData,
        rescheduleRequests: (rrRes?.data as RescheduleRequestRow[]) || [],
        noteAttachments: (naRes?.data as NoteAttachmentRow[]) || [],
        groups: gData,
        groupMembers: gmData,
        notifications: (nfRes?.data as NotificationRow[]) || [],
        sessionsOldConsumed: sessionCutoffIso ? oldConsumedNext : null,
      });
      // iOS widgets ride the same coherence point as the cold-start
      // cache: full-success data only, raw (un-enriched) rows. Skipped
      // in readOnly (admin "view as user") so another user's data never
      // lands in the admin's own home-screen widgets. Fire-and-forget —
      // a bridge failure means stale widgets, never a broken refresh.
      if (!readOnly) {
        void syncWidgets({
          patients: pData,
          sessions: sData,
          payments: mapRows(pmRes.data as PaymentRow[]),
          groups: gData,
          // Windowing: widget balances need the pre-cutoff consumed base
          // too, or the home-screen amountDue would understate.
          baseConsumed: sessionCutoffIso ? oldConsumedNext : null,
        });
      }
    }
    // Re-run when the crypto status flips so encrypted notes get
    // re-fetched + decrypted right after the user unlocks. We can't
    // include the encrypt/decrypt fns in deps directly because they
    // change identity on every status transition; the boolean is the
    // correct invariant to depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, readOnly, noteCrypto?.canEncrypt]);

  useEffect(() => { refresh(); }, [refresh]);

  // Multi-device sync: when the tab regains visibility after being
  // hidden for ≥ 10s, pull fresh data so an edit made on another
  // device shows up without a manual reload. Suppressed while a
  // mutation is in flight to avoid clobbering optimistic state.
  useFocusRefresh(refresh, { mutating });

  /* ── DOMAIN ACTIONS (delegated to focused modules) ── */
  const helpers = { formatShortDate, getRecurringDates, setGroupMembers };
  const { createPatient, updatePatient, deletePatient, createPotential, discardPotential, convertPotentialToActive } =
    createPatientActions(userId, patients, setPatients, upcomingSessions, setUpcomingSessions, payments, setPayments, documents, setDocuments, setMutating, setMutationError, helpers);
  const { createSession, updateSessionStatus, deleteSession, softDeleteSession, rescheduleSession, generateRecurringSessions, applyScheduleChange, finalizePatient, updateSessionModality, updateSessionRate, updateSessionVisitType, updateCancelReason } =
    createSessionActions(userId, patients, setPatients, upcomingSessions, setUpcomingSessions, setMutating, setMutationError);
  const { createPayment, deletePayment, softDeletePayment, updatePayment } =
    createPaymentActions(userId, patients, setPatients, payments, setPayments, setMutating, setMutationError);
  const { createNote, updateNote, updateNoteLink, togglePinNote, deleteNote, deleteNotes, softDeleteNote, setNoteCover } =
    createNoteActions(userId, notes, setNotes, setMutating, setMutationError, noteCrypto);
  const { upsertTag, deleteTag, linkTag, unlinkTag } =
    createNoteTagActions(userId, tags, setTags, tagLinks, setTagLinks, setMutationError, noteCrypto);
  const { uploadNoteAttachment, deleteNoteAttachment } =
    createNoteAttachmentActions(userId, noteAttachments, setNoteAttachments, setMutating, setMutationError, noteCrypto, setNotes);
  const { uploadDocument, renameDocument, tagDocumentSession, deleteDocument, getDocumentUrl } =
    createDocumentActions(userId, documents, setDocuments, setMutating, setMutationError);
  const { createMeasurement, updateMeasurement, deleteMeasurement, bulkCreateMeasurements } =
    createMeasurementActions(userId, measurements, setMeasurements, setMutating, setMutationError);
  const {
    createGroup, updateGroup, deleteGroup, endGroup,
    addMembers, removeMember,
    generateGroupSessions, applyGroupScheduleChange, cancelGroupOccurrence,
    rescheduleGroupOccurrence,
  } = createGroupActions(
    userId, patients, setPatients,
    groups, setGroups, groupMembers, setGroupMembers,
    upcomingSessions, setUpcomingSessions,
    setMutating, setMutationError,
  );
  const {
    createExpense, updateExpense, deleteExpense, softDeleteExpense,
    createRecurringTemplate, updateRecurringTemplate, deleteRecurringTemplate,
    generateRecurringExpenses, generatePendingRecurringExpenses,
  } = createExpenseActions({
    userId,
    expenses, setExpenses,
    recurringExpenses, setRecurringExpenses,
    deleteDocument,
    setMutating, setMutationError,
  });
  const { markNotificationRead, markAllNotificationsRead, deleteNotification, clearNotifications } =
    createInboxActions(userId, notifications, setNotifications, setMutationError);

  /* ── ENRICHMENT ── */
  // Auto-complete is display-only — shows past scheduled sessions as "completed"
  // but does NOT persist to DB. User can override any session status.
  const enrichedSessions = useMemo(() => {
    const now = new Date();
    return upcomingSessions.map(s => {
      if (s.status !== SESSION_STATUS.SCHEDULED) return s;
      // Use the SAME moment function the accounting predicate uses
      // (anchors the yearless date's year on created_at, not today), so
      // a session that renders "Completada" here is exactly the one that
      // counts toward amountDue. The prior inline parse used today-
      // anchoring and drifted from accounting for rows >6 months old —
      // the UI would show a status the balance disagreed with.
      if (now >= sessionEndMoment(s, now)) {
        const display = { ...s, status: SESSION_STATUS.COMPLETED, _autoCompleted: true };
        // Non-enumerable dev marker so utils/accounting.js can assert it
        // never receives a display-enriched row. Non-enumerable = invisible
        // to {...spread}, JSON, and the localStorage cache writer; the
        // import.meta.env.DEV gate dead-code-eliminates it in production.
        if (import.meta.env.DEV) {
          Object.defineProperty(display, "_displayOnly", { value: true, enumerable: false });
        }
        return display;
      }
      return s;
    });
  }, [upcomingSessions]);

  // amountDue / credit follow the canonical formula in CLAUDE.md — and
  // CRITICALLY iterate the raw DB sessions (upcomingSessions), not the
  // display-enriched ones. The auto-complete in enrichedSessions is a UI
  // affordance; feeding it into accounting would make every past
  // un-maintained scheduled session silently count as "consumed" and
  // inflate balances by months of phantom activity.
  //
  // Split into two memos so the O(sessions) consumed walk and the cheap
  // O(patients) balance map invalidate on different inputs. Without this,
  // every optimistic `patient.paid` update (after a payment) re-walked the
  // entire session history even though sessions hadn't changed.
  //
  //  • rateSig — the only patient-derived input to the consumed walk is the
  //    per-patient FALLBACK rate (used for legacy sessions missing s.rate).
  //    We capture just that slice as a value-equal string so a paid/opening
  //    change (which leaves ids+rates untouched) yields an === signature and
  //    the consumed memo's cache holds.
  const rateSig = useMemo(
    () => patients.map(p => `${p.id}:${p.rate || 0}`).join("|"),
    [patients]
  );
  //  • consumedByPatient — the expensive Σ(rate) walk over every raw
  //    session. Keyed on the sessions plus rateSig ONLY; `patients` is read
  //    to build the rate-fallback map but deliberately not a dep, so a
  //    paid-counter update doesn't re-walk the history (rateSig is unchanged
  //    → cache holds). This is the perf win.
  const consumedByPatient = useMemo(
    () => {
      const rateById = new Map(patients.map(p => [p.id, p.rate || 0]));
      // Windowing (086): fold the server-side pre-cutoff consumed base
      // onto the JS walk over the fetched rows. oldConsumed is null when
      // windowing is off → mergeBaseConsumed returns the walk unchanged.
      return mergeBaseConsumed(
        computeConsumedByPatient(upcomingSessions, rateById),
        oldConsumed,
      );
    },
    // `patients` is read above only through its id+rate slice, captured by
    // value in rateSig. Depending on the patients reference would defeat the
    // whole split — every paid/opening optimistic update would re-walk the
    // full session history. rateSig is value-equal when rates are unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [upcomingSessions, rateSig, oldConsumed]
  );
  //  • enrichedPatients — the cheap O(patients) delta map. Reuses the SAME
  //    pure formula helper as enrichPatientsWithBalance (no inline copy).
  const enrichedPatients = useMemo(
    () => applyConsumedToPatients(patients, consumedByPatient),
    [patients, consumedByPatient]
  );

  const tutorReminders = useMemo(() =>
    getTutorReminders(enrichedPatients, enrichedSessions),
    [enrichedPatients, enrichedSessions]
  );

  // Defense-in-depth: prevent mutations in read-only mode. Signature-
  // preserving: in read-only mode the real fn is swapped for a no-op that
  // resolves falsy, but the returned type stays `T` so callers keep the
  // action's real call signature (the no-op ignores args at runtime — the
  // cast asserts that shape match, which holds for every guarded action).
  const guard = <T,>(fn: T): T => readOnly ? (((async () => false) as unknown) as T) : fn;

  // After a successful patient create we also refresh from the server.
  // The optimistic setters inside createPatient should be enough, but a
  // user report showed newly-generated recurring sessions occasionally
  // didn't render until the next pull-to-refresh — this closes that
  // gap without blocking the sheet from dismissing.
  const createPatientWithRefresh = async (args: Parameters<typeof createPatient>[0]) => {
    const ok = await createPatient(args);
    if (ok) refresh().catch(() => {});
    return ok;
  };
  // Same closing-the-gap rationale as createPatientWithRefresh above —
  // a fresh potential ships an interview session row alongside the
  // patient, and the optimistic setters can race the next pull. The
  // post-create refresh ensures the new row reflects in any open
  // detail sheet without forcing the user to pull-to-refresh.
  const createPotentialWithRefresh = async (args: Parameters<typeof createPotential>[0]) => {
    const ok = await createPotential(args);
    if (ok) refresh().catch(() => {});
    return ok;
  };
  const convertPotentialWithRefresh = async (id: string, args: Parameters<typeof convertPotentialToActive>[1]) => {
    const ok = await convertPotentialToActive(id, args);
    if (ok) refresh().catch(() => {});
    return ok;
  };
  // Creating a group fans out a window of member session rows; a member
  // add backfills future occurrences. Both can race the next pull, so
  // refresh after success (same gap-closing rationale as patients above).
  const createGroupWithRefresh = async (args: Parameters<typeof createGroup>[0]) => {
    const res = await createGroup(args);
    if (res) refresh().catch(() => {});
    return res;
  };
  const addMembersWithRefresh = async (groupId: string, ids: string[]) => {
    const ok = await addMembers(groupId, ids);
    if (ok) refresh().catch(() => {});
    return ok;
  };
  const addMemberWithRefresh = async (groupId: string, id: string) => addMembersWithRefresh(groupId, [id]);

  return {
    patients: enrichedPatients, upcomingSessions: enrichedSessions, payments, notes, documents, measurements,
    expenses, recurringExpenses,
    rescheduleRequests, setRescheduleRequests,
    tags, tagLinks,
    noteAttachments,
    groups, groupMembers,
    // Inbox key is deliberately `inbox` (not `notifications`) — App.jsx
    // already exposes a `notifications` object (the PUSH subscription hook)
    // in context, which would shadow this array.
    inbox: notifications,
    inboxUnread: notifications.reduce((n, x) => n + (x.read ? 0 : 1), 0),
    tutorReminders,
    loading, fetchError, mutating, mutationError, readOnly,
    clearMutationError: () => setMutationError(""),
    createGroup: guard(createGroupWithRefresh), updateGroup: guard(updateGroup),
    deleteGroup: guard(deleteGroup), endGroup: guard(endGroup),
    addMember: guard(addMemberWithRefresh), addMembers: guard(addMembersWithRefresh), removeMember: guard(removeMember),
    generateGroupSessions: guard(generateGroupSessions),
    applyGroupScheduleChange: guard(applyGroupScheduleChange),
    cancelGroupOccurrence: guard(cancelGroupOccurrence),
    rescheduleGroupOccurrence: guard(rescheduleGroupOccurrence),
    createPatient: guard(createPatientWithRefresh), updatePatient: guard(updatePatient), deletePatient: guard(deletePatient),
    createPotential: guard(createPotentialWithRefresh), discardPotential: guard(discardPotential), convertPotentialToActive: guard(convertPotentialWithRefresh),
    createSession: guard(createSession), updateSessionStatus: guard(updateSessionStatus),
    deleteSession: guard(deleteSession), softDeleteSession,
    rescheduleSession: guard(rescheduleSession),
    generateRecurringSessions: guard(generateRecurringSessions), applyScheduleChange: guard(applyScheduleChange),
    finalizePatient: guard(finalizePatient), updateSessionModality: guard(updateSessionModality), updateSessionRate: guard(updateSessionRate),
    updateSessionVisitType: guard(updateSessionVisitType),
    updateCancelReason: guard(updateCancelReason),
    createPayment: guard(createPayment), deletePayment: guard(deletePayment), softDeletePayment, updatePayment: guard(updatePayment),
    createNote: guard(createNote), updateNote: guard(updateNote), updateNoteLink: guard(updateNoteLink),
    togglePinNote: guard(togglePinNote), deleteNote: guard(deleteNote), softDeleteNote, deleteNotes: guard(deleteNotes),
    setNoteCover: guard(setNoteCover),
    upsertTag: guard(upsertTag), deleteTag: guard(deleteTag),
    linkTag: guard(linkTag), unlinkTag: guard(unlinkTag),
    uploadNoteAttachment: guard(uploadNoteAttachment),
    deleteNoteAttachment: guard(deleteNoteAttachment),
    uploadDocument: guard(uploadDocument), renameDocument: guard(renameDocument),
    tagDocumentSession: guard(tagDocumentSession), deleteDocument: guard(deleteDocument),
    getDocumentUrl,
    createMeasurement: guard(createMeasurement),
    updateMeasurement: guard(updateMeasurement),
    deleteMeasurement: guard(deleteMeasurement),
    bulkCreateMeasurements: guard(bulkCreateMeasurements),
    createExpense: guard(createExpense), updateExpense: guard(updateExpense), deleteExpense: guard(deleteExpense), softDeleteExpense,
    createRecurringTemplate: guard(createRecurringTemplate),
    updateRecurringTemplate: guard(updateRecurringTemplate),
    deleteRecurringTemplate: guard(deleteRecurringTemplate),
    generateRecurringExpenses: guard(generateRecurringExpenses),
    generatePendingRecurringExpenses: guard(generatePendingRecurringExpenses),
    markNotificationRead: guard(markNotificationRead),
    markAllNotificationsRead: guard(markAllNotificationsRead),
    deleteNotification: guard(deleteNotification),
    clearNotifications: guard(clearNotifications),
    refresh,
  };
}

/** The full data-layer value the coordinator returns: typed data arrays
    (enriched patients/sessions), the guarded mutation actions, and the
    fetch/mutation status. The context assembler spreads this and the
    CardiganContext value is built on it. */
export type CardiganData = ReturnType<typeof useCardiganData>;
