import { useEffect, useState, useCallback, useMemo } from "react";
import { loadCachedData, saveCachedData } from "../lib/dataCache";
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
import { enrichPatientsWithBalance } from "../utils/accounting";
import { useFocusRefresh } from "./useFocusRefresh";

// Module-level lock to prevent concurrent auto-extend from duplicating sessions.
let _extending = false;
// Sibling lock for group session auto-extend (same rationale as _extending).
let _extendingGroups = false;
// Sibling lock for recurring-expense generation. The DB-side partial unique
// index `uniq_expenses_recurring_period` is the cross-device truth; this
// flag just prevents within-tab races (e.g. fast re-renders or a refresh
// triggered before the previous insert resolves).
let _generatingExpenses = false;

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

// Test-only surface. `mapRows` is the read-path normalizer documented in
// CLAUDE.md (date "D-MMM" canonicalization, color_idx→colorIdx, modality
// default) — a landmine the rest of the app trusts implicitly, so it gets
// pinned by unit tests via this handle. Mirrors the `_internals` pattern in
// api/_calendar.js. Not part of the public hook surface.
export const _internals = { mapRows };

export async function fetchAllAccounts() {
  // Three indexed reads run in parallel — sequential awaits added a
  // visible "page is loading" delay on the admin Users tab even on
  // a fast connection because each round-trip waited for the prior
  // one. Promise.allSettled keeps the partial-failure semantics
  // (panel still renders if subscriptions read fails, etc.).
  const [pRes, profRes, subRes] = await Promise.allSettled([
    supabase.from("patients").select("user_id, name, created_at").order("created_at"),
    supabase.rpc("get_user_profiles"),
    supabase.from("user_subscriptions")
      .select("user_id, status, current_period_end, cancel_at_period_end, cancel_at, comp_granted, comp_granted_at, comp_reason, referral_rewards_count, default_payment_method, trial_extension_days"),
  ]);
  let pData = [], profileData = [], subscriptionData = [];
  if (pRes.status === "fulfilled") pData = pRes.value.data || [];
  else console.error("fetchAllAccounts: patients query failed", pRes.reason);
  if (profRes.status === "fulfilled") profileData = profRes.value.data || [];
  else console.error("fetchAllAccounts: get_user_profiles RPC failed", profRes.reason);
  if (subRes.status === "fulfilled") subscriptionData = subRes.value.data || [];
  else console.error("fetchAllAccounts: user_subscriptions query failed", subRes.reason);

  // Start from auth.users so accounts with zero patients still appear —
  // otherwise the admin can't block/delete a freshly-created empty
  // account. Patient counts are joined in afterwards.
  //
  // accountType is the role-detection result the admin sees:
  //   - "therapist" — has a user_profiles.profession
  //   - "patient"   — no profession, but is_patient=true (linked via
  //                   patients.patient_user_id; mirrors the patient
  //                   shell in useRoleDetection)
  //   - "orphan"    — neither (rare; usually a stale signup)
  // Profession defaulting was removed in migration 058 so a missing
  // profile row no longer masquerades as a "psychologist" therapist.
  const now = Date.now();
  const accounts = new Map();
  profileData.forEach(prof => {
    const bannedUntilMs = prof.banned_until ? new Date(prof.banned_until).getTime() : 0;
    const isPatient = !!prof.is_patient;
    const profession = prof.profession || null;
    const accountType = profession ? "therapist" : (isPatient ? "patient" : "orphan");
    accounts.set(prof.id, {
      userId: prof.id,
      fullName: prof.full_name || "",
      email: prof.email || "",
      patientCount: 0,
      firstSeen: prof.created_at || null,
      blocked: bannedUntilMs > now,
      bannedUntil: prof.banned_until || null,
      profession,
      isPatient,
      accountType,
    });
  });
  pData.forEach(p => {
    if (!accounts.has(p.user_id)) {
      // Profile fetch failed (e.g. RLS blocked) but we still see the
      // user via their patient rows. Render with what we have. Treat
      // as a therapist by default — they own a patients row, which is
      // the therapist-side relationship — but flag accountType
      // "unknown" so the UI doesn't make claims it can't back up.
      accounts.set(p.user_id, {
        userId: p.user_id,
        fullName: "",
        email: "",
        patientCount: 0,
        firstSeen: p.created_at,
        blocked: false,
        bannedUntil: null,
        profession: null,
        isPatient: false,
        accountType: "therapist",
      });
    }
    accounts.get(p.user_id).patientCount++;
  });
  subscriptionData.forEach(sub => {
    const acct = accounts.get(sub.user_id);
    if (!acct) return; // sub for an auth user we didn't list — skip
    acct.subscriptionStatus = sub.status || null;
    acct.subscriptionPeriodEnd = sub.current_period_end || null;
    acct.subscriptionCancelAt = sub.cancel_at || null;
    acct.subscriptionCancelAtPeriodEnd = !!sub.cancel_at_period_end;
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
    // Patient users don't subscribe (the therapist pays). Skip the
    // tier computation entirely so the admin Users list renders no
    // tier badge for them — a "Vencida"/"Prueba" pill on a patient
    // account would be wrong.
    if (acct.accountType === "patient") {
      acct.tier = null;
      acct.daysLeftInTrial = null;
      continue;
    }
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

// Admin → in-app inbox: send a 'system' notification to one user or
// broadcast to all. Backs the AdminMessages compose UI.
export async function adminNotify({ title, body, url, userId, broadcast }) {
  const headers = await authHeaders();
  const res = await fetch("/api/admin-notify", {
    method: "POST",
    headers,
    body: JSON.stringify({ title, body, url, userId, broadcast }),
  });
  if (!res.ok) {
    let msg = "Send failed";
    try { const j = await res.json(); msg = j.error || msg; } catch { /* default msg */ }
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

/* Saved-views CRUD — admin-only filter presets shared across the
   admin team. Backed by the admin_saved_views table (mig 063). */
export async function fetchAdminSavedViews(screen) {
  const headers = await authHeaders();
  const url = screen
    ? `/api/admin-saved-views?screen=${encodeURIComponent(screen)}`
    : "/api/admin-saved-views";
  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) {
    let msg = "Fetch failed";
    try { const j = await res.json(); msg = j.error || msg; } catch { /* fall through */ }
    throw new Error(msg);
  }
  const j = await res.json();
  return j.views || [];
}

export async function createAdminSavedView({ screen, name, filterState }) {
  const headers = await authHeaders();
  const res = await fetch("/api/admin-saved-views", {
    method: "POST",
    headers,
    body: JSON.stringify({ screen, name, filterState }),
  });
  if (!res.ok) {
    let msg = "Create failed";
    try { const j = await res.json(); msg = j.error || msg; } catch { /* fall through */ }
    throw new Error(msg);
  }
  const j = await res.json();
  return j.view;
}

export async function updateAdminSavedView({ id, name, filterState }) {
  const headers = await authHeaders();
  const body = { id };
  if (name !== undefined) body.name = name;
  if (filterState !== undefined) body.filterState = filterState;
  const res = await fetch("/api/admin-saved-views", {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = "Update failed";
    try { const j = await res.json(); msg = j.error || msg; } catch { /* fall through */ }
    throw new Error(msg);
  }
  const j = await res.json();
  return j.view;
}

export async function deleteAdminSavedView(id) {
  const headers = await authHeaders();
  const res = await fetch("/api/admin-saved-views", {
    method: "DELETE",
    headers,
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    let msg = "Delete failed";
    try { const j = await res.json(); msg = j.error || msg; } catch { /* fall through */ }
    throw new Error(msg);
  }
  return res.json();
}

/* Recover a target user's encryption master key. Admin-gated. The
   server decrypts recovery_wrap with the private key and returns the
   master-key bytes as base64 — the admin then sends this out-of-band
   so the user can reset their passphrase. Logged in audit_log as
   "recover_encryption". */
export async function adminRecoverEncryption(userId) {
  const headers = await authHeaders();
  const res = await fetch("/api/admin-recover-encryption", {
    method: "POST",
    headers,
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) {
    let msg = "Recover failed";
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

/* Influencer codes — admin-only CRUD. List returns each code with
   signup_count + paid_count joined from user_subscriptions so the
   tab can show conversion rates without a second round-trip. */
export async function fetchInfluencerCodes() {
  const headers = await authHeaders();
  const res = await fetch("/api/admin-influencer-codes", { method: "GET", headers });
  if (!res.ok) {
    let msg = "Fetch failed";
    try { const j = await res.json(); msg = j.error || msg; } catch { /* default */ }
    throw new Error(msg);
  }
  const j = await res.json();
  return j.codes || [];
}

export async function createInfluencerCode(payload) {
  const headers = await authHeaders();
  const res = await fetch("/api/admin-influencer-codes", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Create failed");
  return j.code;
}

export async function toggleInfluencerCode(id, active) {
  const headers = await authHeaders();
  const res = await fetch("/api/admin-influencer-codes", {
    method: "PATCH",
    headers,
    body: JSON.stringify({ id, active }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Toggle failed");
  return j;
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
  const [ovRes, dailyRes, sourcesRes] = await Promise.all([
    supabase.rpc("admin_analytics_overview"),
    supabase.rpc("admin_analytics_daily", { days }),
    fetchSignupSources(),
  ]);
  if (ovRes.error) throw ovRes.error;
  if (dailyRes.error) throw dailyRes.error;
  return {
    overview: ovRes.data,
    daily: dailyRes.data || [],
    signupSources: sourcesRes,
  };
}

/* Acquisition source breakdown across ALL signups that completed
   the source step. Admin-only by virtue of the user_profiles RLS
   policy ("admin reads all"). Aggregated client-side because the
   row count is per-user (small) and sorting/percentage math is
   trivial; saves us another RPC migration. */
export async function fetchSignupSources() {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("signup_source, signup_source_detail, signup_source_recorded_at")
    .not("signup_source_recorded_at", "is", null);
  if (error) throw error;
  const rows = data || [];
  const counts = {};
  const otherDetails = [];
  for (const r of rows) {
    counts[r.signup_source] = (counts[r.signup_source] || 0) + 1;
    if (r.signup_source === "other" && r.signup_source_detail) {
      otherDetails.push({
        text: r.signup_source_detail,
        at: r.signup_source_recorded_at,
      });
    }
  }
  const total = rows.length;
  const breakdown = Object.entries(counts)
    .map(([source, count]) => ({
      source,
      count,
      pct: total > 0 ? count / total : 0,
    }))
    .sort((a, b) => b.count - a.count);
  otherDetails.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  return { breakdown, otherDetails, total };
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

/* ── Admin Dashboard v2 — composed reads ──
   These three helpers feed the dedicated `#admin/...` dashboard.
   Each is admin-gated server-side (RPC via is_admin() RLS or
   requireAdmin in the Vercel function). */
export async function fetchUserDetail(uid) {
  const headers = await authHeaders();
  const res = await fetch(`/api/admin-user-detail?uid=${encodeURIComponent(uid)}`, { method: "GET", headers });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Fetch failed");
  return j;
}

export async function fetchAuditLog({ targetUserId = null, action = null, actorId = null, limit = 200 } = {}) {
  let q = supabase
    .from("admin_audit_log")
    .select("id, actor_id, target_user_id, action, payload, ip, ua, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (targetUserId) q = q.eq("target_user_id", targetUserId);
  if (action) q = q.eq("action", action);
  if (actorId) q = q.eq("actor_id", actorId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function fetchRevenueOverview() {
  const { data, error } = await supabase.rpc("admin_revenue_overview");
  if (error) throw error;
  return data;
}

/* Recent invoices for the Revenue page. Caps at 50 — admin can
   drill into Stripe for the full ledger. Filters out $0 invoices
   (trial-start, prorated price-change, etc.) since they're noise
   for the admin who actually wants to see real money flowing. */
export async function fetchRecentInvoices({ limit = 50 } = {}) {
  const { data, error } = await supabase
    .from("stripe_invoices")
    .select("id, user_id, amount_cents, currency, paid_at, hosted_invoice_url, created_at")
    .gt("amount_cents", 0)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/* Admin-only read of a user's rating history. RLS lets is_admin()
   SELECT all rows from user_ratings, so this is a direct query —
   no /api hop needed. Returns the most recent first. */
export async function fetchUserRatings(uid, { limit = 20 } = {}) {
  const { data, error } = await supabase
    .from("user_ratings")
    .select("prompt_kind, stars, comment, created_at")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/* Client-initiated audit log entry. Used by "Ver como" since the
   impersonation flow is a state flip in the React app, not a server
   round-trip — without this the audit log would have a gap on every
   view-as event. */
export async function logAdminViewAs(targetUserId) {
  const headers = await authHeaders();
  await fetch("/api/admin-audit", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "view_as", targetUserId, payload: null }),
  }).catch(() => { /* best-effort, never block view-as on logging */ });
}

export function useCardiganData(user, viewAsUserId, options = {}) {
  const userId = viewAsUserId || user?.id;
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
  const initialCache = useMemo(() => loadCachedData(userId), [userId]);
  const [patients, setPatients] = useState(initialCache?.patients || []);
  const [upcomingSessions, setUpcomingSessions] = useState(initialCache?.upcomingSessions || []);
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
    // Expenses share the payments window — a 12-month rolling view is
    // plenty for the Gastos / Resumen tabs. Older years are still
    // queryable via the CSV export endpoint when the contador needs them.
    const expensesSince = paymentsSince;
    let pRes, sRes, pmRes, nRes, dRes, mRes, eRes, reRes, rrRes;
    let tRes, tlRes, naRes, gRes, gmRes, nfRes;
    try {
      [pRes, sRes, pmRes, nRes, dRes, mRes, eRes, reRes, rrRes, tRes, tlRes, naRes, gRes, gmRes, nfRes] = await Promise.all([
        q("patients").order("name"),
        q("sessions", 10000).order("created_at"),
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
        q("note_tag_links", 5000),
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
      ]);
    } catch (err) {
      setFetchError(err.message || "Error al cargar datos");
      setLoading(false);
      return;
    }

    // Surface individual table errors
    const tableErr = [pRes, sRes, pmRes, nRes, dRes, mRes, eRes, reRes, rrRes, gRes, gmRes].find(r => r?.error);
    if (tableErr) setFetchError(tableErr.error.message);

    let pData = mapRows(pRes.data);
    let sData = mapRows(sRes.data);
    let gData = mapRows(gRes?.data);
    const gmData = gmRes?.data || [];

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
          // Episodic patients have no perpetual slot — the practitioner
          // schedules the next visit at the end of each consult. Skip
          // auto-extend entirely. (computeAutoExtendRows would no-op
          // anyway since they own zero is_recurring=true rows; this is
          // the explicit guard so the intent is visible to readers and
          // a stray recurring row from manual DB edits can't surprise
          // anyone.)
          if (patient.scheduling_mode === "episodic") continue;
          const allPSess = sData.filter(s => s.patient_id === patient.id);
          const rows = computeAutoExtendRows({ patient, allPSess, today, threshold, extendEnd, userId });
          if (rows.length === 0) continue;

          const { data, error } = await supabase.from("sessions").insert(rows).select();
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

    // ── Group session auto-extend ──
    // Analogue of the per-patient pass above, for group occurrences. Each
    // group owns an explicit (day, time) template, so computeGroupAutoExtendRows
    // reads the slot straight off the group row. Fan-out rows are ordinary
    // session rows (one per active member), so the counter trigger maintains
    // each member's billed/sessions server-side just like the patient path.
    // Same phantom-prevention rules (future-only, clamp-at-today) apply.
    if (userId && !readOnly && !_extendingGroups && gData.length > 0) {
      _extendingGroups = true;
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const threshold = new Date(today);
        threshold.setDate(today.getDate() + RECURRENCE_EXTEND_THRESHOLD_DAYS);
        const extendEnd = toISODate(new Date(today.getTime() + RECURRENCE_WINDOW_WEEKS * 7 * 86400000));
        const patientsById = new Map(pData.map(p => [p.id, p]));

        const insertedRows = [];
        const patientUpdates = new Map();
        for (const group of gData) {
          const members = gmData.filter(m => m.group_id === group.id);
          const groupSessions = sData.filter(s => s.group_id === group.id);
          const rows = computeGroupAutoExtendRows({ group, members, patientsById, groupSessions, today, threshold, extendEnd, userId });
          if (rows.length === 0) continue;
          const { data, error } = await supabase.from("sessions").insert(rows).select();
          if (!error && data) {
            insertedRows.push(...data);
            data.forEach(r => {
              if (r.patient_id) patientUpdates.set(r.patient_id, (patientUpdates.get(r.patient_id) || 0) + 1);
            });
          }
        }
        if (insertedRows.length > 0) sData = [...sData, ...mapRows(insertedRows)];
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
    let eData = eRes?.data || [];
    const reData = reRes?.data || [];
    if (userId && !readOnly && !_generatingExpenses && reData.length > 0) {
      _generatingExpenses = true;
      try {
        const { auto } = computeRecurringExpenseRows(reData, eData, new Date(), userId);
        if (auto.length > 0) {
          const { data: insertedExpenses, error: insertErr } = await supabase
            .from("expenses")
            .upsert(auto, {
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
    // Decrypt tag labels (same envelope as notes). For non-encrypted
    // rows the ciphertext column already holds the plaintext, so we
    // pass it through unchanged. For encrypted rows we run the same
    // decrypt the notes path uses.
    let tagsData = tRes?.data || [];
    if (noteCrypto?.decrypt) {
      tagsData = await Promise.all(tagsData.map(async (t) => {
        const plain = await noteCrypto.decrypt(t.label_ciphertext, /* encrypted= */ true).catch(() => null);
        return { ...t, label: plain ?? t.label_ciphertext };
      }));
    } else {
      tagsData = tagsData.map(t => ({ ...t, label: t.label_ciphertext }));
    }
    setTags(tagsData);
    setTagLinks(tlRes?.data || []);
    setDocuments(dRes.data || []);
    setMeasurements(mRes.data || []);
    setExpenses(eData);
    setRecurringExpenses(reData);
    setRescheduleRequests(rrRes?.data || []);
    setNoteAttachments(naRes?.data || []);
    setGroups(gData);
    setGroupMembers(gmData);
    setNotifications(nfRes?.data || []);
    setLoading(false);

    /* Persist the fresh snapshot for next cold start. We do this
       AFTER all the in-memory setters fire so the cache and the
       React state are always in sync — if a render aborted
       mid-update we'd still be writing the canonical fetched data,
       not a partial state. Mutations after this point flow through
       in-memory state only; the next refresh () writes the
       up-to-date cache. */
    saveCachedData(userId, {
      patients: pData,
      upcomingSessions: sData,
      payments: mapRows(pmRes.data),
      notes: notesData,
      documents: dRes.data || [],
      measurements: mRes.data || [],
      expenses: eData,
      recurringExpenses: reData,
      rescheduleRequests: rrRes?.data || [],
      noteAttachments: naRes?.data || [],
      groups: gData,
      groupMembers: gmData,
      notifications: nfRes?.data || [],
    });
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
      const d = parseShortDate(s.date);
      if (s.time) {
        const [h, m] = s.time.split(":");
        d.setHours(parseInt(h) || 0, parseInt(m) || 0);
      }
      d.setTime(d.getTime() + 60 * 60 * 1000);
      if (now >= d) {
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
  // Same closing-the-gap rationale as createPatientWithRefresh above —
  // a fresh potential ships an interview session row alongside the
  // patient, and the optimistic setters can race the next pull. The
  // post-create refresh ensures the new row reflects in any open
  // detail sheet without forcing the user to pull-to-refresh.
  const createPotentialWithRefresh = async (args) => {
    const ok = await createPotential(args);
    if (ok) refresh().catch(() => {});
    return ok;
  };
  const convertPotentialWithRefresh = async (id, args) => {
    const ok = await convertPotentialToActive(id, args);
    if (ok) refresh().catch(() => {});
    return ok;
  };
  // Creating a group fans out a window of member session rows; a member
  // add backfills future occurrences. Both can race the next pull, so
  // refresh after success (same gap-closing rationale as patients above).
  const createGroupWithRefresh = async (args) => {
    const res = await createGroup(args);
    if (res) refresh().catch(() => {});
    return res;
  };
  const addMembersWithRefresh = async (groupId, ids) => {
    const ok = await addMembers(groupId, ids);
    if (ok) refresh().catch(() => {});
    return ok;
  };
  const addMemberWithRefresh = async (groupId, id) => addMembersWithRefresh(groupId, [id]);

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
