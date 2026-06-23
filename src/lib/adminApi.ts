import { supabase } from "../supabaseClient";

/* ── Admin API ────────────────────────────────────────────────────────
   The admin-only data fetchers + mutations (user management, saved
   views, influencer codes, analytics, audit log, revenue/invoices,
   ratings, bug reports). Extracted verbatim from useCardiganData so the
   prime-directive per-user data coordinator stays focused on the
   fetch → normalize → enrich path. These are plain functions (no hook
   state); each admin endpoint verifies the caller server-side, and the
   reads run under the admin RLS read-all policies. Imported directly by
   the admin screens, and re-exported from useCardiganData for back-compat
   with existing call sites. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin rows are loosely typed (mirrors the coordinator's Row bridge)
type Row = any;

export interface AdminAccount {
  userId: string;
  fullName: string;
  email: string;
  patientCount: number;
  firstSeen: string | null;
  blocked: boolean;
  bannedUntil: string | null;
  profession: string | null;
  isPatient: boolean;
  accountType: string;
  subscriptionStatus?: string | null;
  subscriptionPeriodEnd?: string | null;
  subscriptionCancelAt?: string | null;
  subscriptionCancelAtPeriodEnd?: boolean;
  compGranted?: boolean;
  compReason?: string | null;
  compGrantedAt?: string | null;
  referralRewardsCount?: number;
  defaultPaymentMethod?: string | null;
  trialExtensionDays?: number;
  tier?: string | null;
  daysLeftInTrial?: number | null;
}

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
  let pData: Row[] = [], profileData: Row[] = [], subscriptionData: Row[] = [];
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
  const accounts = new Map<string, AdminAccount>();
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
    accounts.get(p.user_id)!.patientCount++;
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

export async function adminBlockUser(userId: string, block: boolean) {
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
export async function adminNotify({ title, body, url, userId, broadcast }: { title?: string; body?: string; url?: string | null; userId?: string | null; broadcast?: boolean }) {
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

export async function adminDeleteUser(userId: string) {
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

export async function adminUpdateProfession(userId: string, profession: string) {
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
export async function fetchAdminSavedViews(screen?: string) {
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

export async function createAdminSavedView({ screen, name, filterState }: { screen?: string; name?: string; filterState?: unknown }) {
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

export async function updateAdminSavedView({ id, name, filterState }: { id: string; name?: string; filterState?: unknown }) {
  const headers = await authHeaders();
  const body: Record<string, unknown> = { id };
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

export async function deleteAdminSavedView(id: string) {
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
export async function adminRecoverEncryption(userId: string) {
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
export async function adminGrantComp(userId: string, granted: boolean, reason?: string | null) {
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

export async function createInfluencerCode(payload: unknown) {
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

export async function toggleInfluencerCode(id: string, active: boolean) {
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
export async function fetchAdminAnalytics({ days = 30 }: { days?: number } = {}) {
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
  const counts: Record<string, number> = {};
  const otherDetails: { text: string; at: string }[] = [];
  for (const r of rows) {
    counts[r.signup_source as string] = (counts[r.signup_source as string] || 0) + 1;
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

export async function fetchBugReports({ archived = false }: { archived?: boolean } = {}) {
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

export async function archiveBugReports(ids: string[]) {
  const { error } = await supabase.rpc("archive_bug_reports", { report_ids: ids });
  if (error) throw error;
}

export async function deleteBugReport(id: string) {
  const { error } = await supabase.from("bug_reports").delete().eq("id", id);
  if (error) throw error;
}

/* ── Admin Dashboard v2 — composed reads ──
   These three helpers feed the dedicated `#admin/...` dashboard.
   Each is admin-gated server-side (RPC via is_admin() RLS or
   requireAdmin in the Vercel function). */
export async function fetchUserDetail(uid: string) {
  const headers = await authHeaders();
  const res = await fetch(`/api/admin-user-detail?uid=${encodeURIComponent(uid)}`, { method: "GET", headers });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || "Fetch failed");
  return j;
}

export async function fetchAuditLog({ targetUserId = null, action = null, actorId = null, limit = 200 }: { targetUserId?: string | null; action?: string | null; actorId?: string | null; limit?: number } = {}) {
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
export async function fetchRecentInvoices({ limit = 50 }: { limit?: number } = {}) {
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
export async function fetchUserRatings(uid: string, { limit = 20 }: { limit?: number } = {}) {
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
export async function logAdminViewAs(targetUserId: string) {
  const headers = await authHeaders();
  await fetch("/api/admin-audit", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "view_as", targetUserId, payload: null }),
  }).catch(() => { /* best-effort, never block view-as on logging */ });
}
