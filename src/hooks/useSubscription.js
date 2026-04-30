import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { isAdmin } from "./useCardiganData";

/* ── useSubscription ──────────────────────────────────────────────────
   Tracks the SaaS billing state for the current Cardigan user.

   Access policy (the single source of truth — `accessState`):

     - admin   → unrestricted (admins never get locked out, ever).
     - trial   → still inside the 30-day post-signup window, and the
                 user has NOT yet started a Stripe subscription that
                 went past `active`/`trialing`/`past_due`. The default
                 for every brand-new account.
     - active  → the user has a subscription whose status is one of
                 `active` | `trialing` | `past_due`. We treat past_due
                 as a soft grace window — Stripe retries the card a few
                 times, and yanking access on the first failed attempt
                 reads as hostile. When Stripe gives up, the status
                 transitions to `canceled` (or `unpaid`) and we drop to
                 `expired`.
     - expired → trial window has passed AND no active Stripe sub.
                 Triggers read-only mode app-wide.
     - loading → still fetching the user_subscriptions row; the caller
                 should wait before deciding to gate the UI.

   The 30-day trial is a Cardigan-side concept and starts at
   auth.users.created_at. We deliberately don't add a Stripe-side
   `trial_period_days` to the Checkout Session — that would let a
   user effectively double-dip (30 days in-app + 7 days on Stripe).

   Writes never go through this hook. The user_subscriptions row is
   maintained by api/stripe-webhook.js (server-side, service-role
   client). The hook only ever does SELECT. */

const TRIAL_DAYS = 30;
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

function trialEndDate(user) {
  if (!user?.created_at) return null;
  const created = new Date(user.created_at);
  if (Number.isNaN(created.getTime())) return null;
  return new Date(created.getTime() + TRIAL_DAYS * 86_400_000);
}

function daysBetween(now, then) {
  if (!then) return null;
  return Math.ceil((then.getTime() - now.getTime()) / 86_400_000);
}

export function useSubscription(user) {
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState(null);
  // Tick the clock every 5 minutes so an open tab can transition from
  // "trial" to "expired" without a refresh. Not a hot loop — five
  // minutes is plenty of granularity for a daily-ticking trial.
  const [now, setNow] = useState(() => new Date());
  // Prevent state updates after unmount or after the user changes
  // (sign-out → sign-in to a different account in the same tab).
  const reqIdRef = useRef(0);

  const userId = user?.id || null;

  const refresh = useCallback(async () => {
    if (!userId) {
      setSubscription(null);
      setLoading(false);
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    const { data, error } = await supabase
      .from("user_subscriptions")
      .select("stripe_customer_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end, trial_end, hosted_invoice_url, latest_invoice_id, comp_granted, comp_granted_at, comp_reason, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (reqId !== reqIdRef.current) return;
    if (error && error.code !== "PGRST116") {
      // PGRST116 = "row not found" via maybeSingle; everything else is
      // a real error. Don't crash the app — leave subscription as null
      // so the trial window still applies.
      console.warn("useSubscription:", error.message);
    }
    setSubscription(data || null);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Listen for billing-return events from the Stripe redirect URLs.
  // App.jsx parses `?billing=success|cancel|return` on mount and
  // dispatches a window event so this hook can refetch without a full
  // page reload. Webhook latency is usually ~1-2s; we also schedule a
  // delayed re-fetch to cover the rare longer tail.
  useEffect(() => {
    const onReturn = () => {
      refresh();
      const t = setTimeout(refresh, 4000);
      return () => clearTimeout(t);
    };
    window.addEventListener("cardigan-billing-return", onReturn);
    return () => window.removeEventListener("cardigan-billing-return", onReturn);
  }, [refresh]);

  const trialEnd = useMemo(() => trialEndDate(user), [user]);
  const daysLeftInTrial = useMemo(() => daysBetween(now, trialEnd), [now, trialEnd]);
  const trialActive = useMemo(
    () => trialEnd ? now < trialEnd : false,
    [now, trialEnd]
  );

  const subscribedActive = !!subscription?.status && ACTIVE_STATUSES.has(subscription.status);
  // Admin-granted complimentary access — set via the AdminPanel.
  // Treated identically to an active paid sub for gating purposes.
  const compGranted = !!subscription?.comp_granted;

  const accessState = useMemo(() => {
    if (isAdmin(user)) return "active"; // admin shortcut — never gated
    if (loading) return "loading";
    if (compGranted) return "active";
    if (subscribedActive) return "active";
    if (trialActive) return "trial";
    return "expired";
  }, [user, loading, compGranted, subscribedActive, trialActive]);

  // `isPro` is the gate for premium-only features (document uploads,
  // note encryption, calendar sync). Stricter than `accessState`:
  // trial users have full app access for their 30-day window but DO
  // NOT get premium features unless they've subscribed or been comp'd.
  // Admins always pass.
  const isPro = useMemo(() => {
    if (isAdmin(user)) return true;
    if (compGranted) return true;
    if (subscribedActive) return true;
    return false;
  }, [user, compGranted, subscribedActive]);

  // Convenience flags for callers — derived once here so consumers
  // don't recompute equality strings inline.
  const accessExpired = accessState === "expired";
  const accessLoading = accessState === "loading";

  const startCheckout = useCallback(async ({ referralCode } = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return { ok: false, error: "Not signed in" };
    const res = await fetch("/api/stripe-checkout", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(referralCode ? { referral_code: referralCode } : {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Stripe-checkout returns { error, action } when there's already
      // an active sub — surface that so the UI can swap to "open
      // portal" without re-prompting.
      return { ok: false, error: json.error || "Checkout failed", action: json.action };
    }
    return { ok: true, url: json.url };
  }, []);

  // Lazy-fetched on first request from the Settings panel — mints the
  // user's referral_code if they don't have one. Cached on the hook
  // state so subsequent reads are zero-roundtrip.
  const [referralInfo, setReferralInfo] = useState(null);
  const [referralLoading, setReferralLoading] = useState(false);
  const fetchReferralInfo = useCallback(async () => {
    setReferralLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return null;
      const res = await fetch("/api/referral-code", {
        method: "GET",
        headers: { "Authorization": `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return null;
      const info = {
        code: json.code,
        rewardsCount: json.rewardsCount || 0,
        pendingCreditCents: json.pendingCreditCents || 0,
      };
      setReferralInfo(info);
      return info;
    } finally {
      setReferralLoading(false);
    }
  }, []);

  const openPortal = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return { ok: false, error: "Not signed in" };
    const res = await fetch("/api/stripe-portal", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json.error || "Portal failed" };
    return { ok: true, url: json.url };
  }, []);

  return {
    loading: accessLoading,
    subscription,
    accessState,
    accessExpired,
    trialActive,
    trialEnd,
    daysLeftInTrial,
    subscribedActive,
    compGranted,
    isPro,
    referralInfo,
    referralLoading,
    fetchReferralInfo,
    refresh,
    startCheckout,
    openPortal,
  };
}
