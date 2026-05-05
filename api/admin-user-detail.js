/* ── GET /api/admin-user-detail?uid=<> ─────────────────────────────────
   Composes a single JSON snapshot for the AdminUserDetail page.
   Replaces ~10 client-side queries with one server round-trip.

   Returned shape (PII boundary preserved — counts and metadata only,
   no patient names / note bodies / payment line items / filenames):

     {
       profile: { user_id, email, full_name, profession, signup_source,
                  signup_source_detail, signup_source_recorded_at,
                  banned_until, last_sign_in_at, created_at },
       subscription: { stripe_customer_id, stripe_subscription_id,
                       stripe_price_id, status, current_period_end,
                       cancel_at, cancel_at_period_end, trial_end,
                       trial_extension_days, comp_granted, comp_granted_at,
                       comp_reason, default_payment_method,
                       referral_code, referred_by, referral_rewards_count,
                       hosted_invoice_url, latest_invoice_id },
       invoices: [ { id, amount_cents, currency, paid_at, hosted_invoice_url,
                     created_at } ... up to 5 ],
       usage: { patients, sessions_total, sessions_30d, sessions_completed,
                sessions_cancelled, sessions_charged, payments_total,
                payments_30d, notes_total, notes_encrypted, documents_total,
                documents_bytes, measurements_total },
       devices: { push_subscriptions: [ { id, endpoint_host, created_at } ],
                  calendar_token: { issued_at, last_accessed_at } | null },
       privacy: { encryption_enabled, latest_consent_version,
                  latest_consent_at }
     }

   Auth: requireAdmin (the only caller is the admin dashboard). */

import { requireAdmin, getServiceClient, isValidUserId } from "./_admin.js";
import { withSentry } from "./_sentry.js";

async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const uid = String(req.query?.uid || "");
  if (!isValidUserId(uid)) {
    return res.status(400).json({ error: "Invalid uid" });
  }

  const svc = getServiceClient();

  // Fan out every read in parallel — each one is small and indexed.
  // Total wall-clock time is bounded by the slowest single query.
  const [
    authUser,
    profile,
    sub,
    invoices,
    sessionStats,
    paymentStats,
    notesStats,
    notesEncrypted,
    docsStats,
    measurementsCount,
    patientsCount,
    pushSubs,
    calendarToken,
    encKey,
    consents,
  ] = await Promise.all([
    svc.auth.admin.getUserById(uid),
    svc.from("user_profiles").select("*").eq("user_id", uid).maybeSingle(),
    svc.from("user_subscriptions").select("*").eq("user_id", uid).maybeSingle(),
    svc.from("stripe_invoices").select("id, amount_cents, currency, paid_at, hosted_invoice_url, created_at")
      .eq("user_id", uid).order("created_at", { ascending: false }).limit(5),
    // Sessions: total + 30d + by status. We pull just the columns
    // needed for the aggregate; never names, never notes.
    svc.from("sessions").select("status, created_at", { count: "exact" }).eq("user_id", uid),
    svc.from("payments").select("amount, created_at", { count: "exact" }).eq("user_id", uid),
    svc.from("notes").select("id, content", { count: "exact", head: false }).eq("user_id", uid),
    // notes_encrypted: count notes whose content starts with the
    // encryption envelope marker (1-byte version "\x01" base64'd,
    // see CLAUDE.md note encryption section). We can't filter on
    // first byte directly via PostgREST; do it client-side after
    // fetching `encrypted` flag column. Migration 017 added the
    // `encrypted` boolean — guard if missing.
    svc.from("notes").select("encrypted", { count: "exact", head: true })
      .eq("user_id", uid).eq("encrypted", true),
    svc.from("documents").select("file_size", { count: "exact" }).eq("user_id", uid),
    svc.from("measurements").select("id", { count: "exact", head: true }).eq("user_id", uid),
    svc.from("patients").select("id", { count: "exact", head: true }).eq("user_id", uid),
    svc.from("push_subscriptions").select("id, endpoint, created_at").eq("user_id", uid),
    svc.from("user_calendar_tokens").select("created_at, last_accessed_at").eq("user_id", uid).maybeSingle(),
    svc.from("user_encryption_keys").select("created_at, recovery_kid").eq("user_id", uid).maybeSingle(),
    svc.from("user_consents").select("policy_version, accepted_at").eq("user_id", uid)
      .order("accepted_at", { ascending: false }).limit(1),
  ]);

  if (authUser.error || !authUser.data?.user) {
    return res.status(404).json({ error: "User not found" });
  }
  const user = authUser.data.user;

  // Aggregate session counts client-side from the small projection.
  const sessRows = sessionStats.data || [];
  const now = Date.now();
  const ms30d = 30 * 24 * 60 * 60 * 1000;
  const sessions_30d = sessRows.filter((s) => {
    const t = s.created_at ? new Date(s.created_at).getTime() : 0;
    return t > now - ms30d;
  }).length;
  const sessions_completed = sessRows.filter((s) => s.status === "completed").length;
  const sessions_cancelled = sessRows.filter((s) => s.status === "cancelled").length;
  const sessions_charged = sessRows.filter((s) => s.status === "charged").length;

  const payRows = paymentStats.data || [];
  const payments_30d = payRows.filter((p) => {
    const t = p.created_at ? new Date(p.created_at).getTime() : 0;
    return t > now - ms30d;
  }).length;

  // Hostnames only — never the full push endpoint URL (which can
  // contain provider-specific identifiers we don't need to expose).
  const pushList = (pushSubs.data || []).map((p) => {
    let host = null;
    try { host = new URL(p.endpoint).host; } catch { /* malformed, skip */ }
    return { id: p.id, endpoint_host: host, created_at: p.created_at };
  });

  // Document total bytes. file_size is nullable for older rows.
  const docsBytes = (docsStats.data || []).reduce((sum, d) => sum + (d.file_size || 0), 0);

  return res.status(200).json({
    profile: {
      user_id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name || null,
      profession: profile.data?.profession || null,
      signup_source: profile.data?.signup_source || null,
      signup_source_detail: profile.data?.signup_source_detail || null,
      signup_source_recorded_at: profile.data?.signup_source_recorded_at || null,
      banned_until: user.banned_until || null,
      last_sign_in_at: user.last_sign_in_at || null,
      created_at: user.created_at,
    },
    subscription: sub.data || null,
    invoices: invoices.data || [],
    usage: {
      patients: patientsCount.count || 0,
      sessions_total: sessionStats.count || 0,
      sessions_30d,
      sessions_completed,
      sessions_cancelled,
      sessions_charged,
      payments_total: paymentStats.count || 0,
      payments_30d,
      notes_total: notesStats.count || 0,
      notes_encrypted: notesEncrypted.count || 0,
      documents_total: docsStats.count || 0,
      documents_bytes: docsBytes,
      measurements_total: measurementsCount.count || 0,
    },
    devices: {
      push_subscriptions: pushList,
      calendar_token: calendarToken.data
        ? { issued_at: calendarToken.data.created_at, last_accessed_at: calendarToken.data.last_accessed_at }
        : null,
    },
    privacy: {
      encryption_enabled: !!encKey.data,
      encryption_recovery_kid: encKey.data?.recovery_kid || null,
      latest_consent_version: consents.data?.[0]?.policy_version || null,
      latest_consent_at: consents.data?.[0]?.accepted_at || null,
    },
  });
}

export default withSentry(handler, { name: "admin-user-detail" });
