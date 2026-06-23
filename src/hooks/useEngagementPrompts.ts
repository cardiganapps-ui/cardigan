import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { passkeysAvailable, passkeyPlatformAuthenticatorAvailable } from "../config/passkeys";
import { shouldShowDay14Prompt } from "../utils/ratingPrompt";
import { shouldShowTrialReminder, shouldPromptPasskey, todayDateKey, PASSKEY_PROMPT_MAX_ASKS } from "../utils/modalGates";

/* ── useEngagementPrompts ──────────────────────────────────────────────
   The five lifecycle / engagement prompts that used to live inline in
   App.tsx's AppShell, extracted verbatim so the shell stops owning ~210
   lines of localStorage-dedup + setTimeout + setState orchestration:

     1. In-app rating sheet  (#rating deep-link + organic day-14 trigger)
     2. Welcome-to-Pro modal (first trial session)
     3. Trial-reminder prompt (15/10/5/3/2/1 days left, once per day)
     4. Post-login passkey enrollment nudge (capped, cooldown'd)
     5. Subscription-success celebration (first non-active → active)

   The PURE eligibility/dedup decisions stay where they were and stay
   unit-tested — `shouldShowDay14Prompt` (utils/ratingPrompt),
   `shouldShowTrialReminder` / `shouldPromptPasskey` (utils/modalGates).
   This hook only fires the side effects (localStorage read/write,
   setTimeout, setState, the passkey hardware/credential checks). Every
   effect's guard set and dependency array is preserved exactly, so the
   gating (demo / view-as / read-only / not-signed-in) is unchanged.

   Inputs are the shell-level signals each prompt branches on; the return
   is the open-flags + close/subscribe handlers the shell threads into
   its render + the StripePaymentSheet onSuccess paths. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export interface EngagementPromptsDeps {
  demo?: boolean;
  viewAsUserId?: string | null;
  user: Row;
  readOnly?: boolean;
  subscription: Row;
  tutorialState?: string;
  upcomingSessions?: Row[];
  patients?: Row[];
  showSuccess: (msg: string) => void;
  showToast: (msg: string, type?: string, opts?: Row) => unknown;
  t: (key: string) => string;
}

export function useEngagementPrompts({
  demo, viewAsUserId, user, readOnly,
  subscription, tutorialState,
  upcomingSessions, patients,
  showSuccess, showToast, t,
}: EngagementPromptsDeps) {
  // In-app rating sheet (day14_v1 / day30_v1). Triggered either by
  // the day-14 lifecycle email's deep link (#rating hash) or by the
  // organic shouldShowDay14Prompt eligibility check below.
  const [ratingSheetOpen, setRatingSheetOpen] = useState(false);
  // App.jsx mount timestamp — the rating-sheet gate uses this as a
  // "settle in" cooldown so a fresh sign-in / TestFlight-first-launch
  // doesn't trigger the ask before the user has done anything in the
  // current session. Lives in a ref-equivalent useState so its value
  // is stable across renders without re-firing effects.
  const [sessionStartedAt] = useState(() => Date.now());

  // ── Rating sheet deep-link (#rating) ──
  // The day-14 lifecycle email's CTA links here — opening the
  // rating sheet directly. Strip the hash so a refresh doesn't
  // re-open it. Skipped in demo + read-only flows.
  useEffect(() => {
    if (demo || readOnly) return;
    if (!user) return;
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#rating") return;
    history.replaceState({}, "", window.location.pathname + window.location.search);
    setRatingSheetOpen(true);
  // run only on mount; the early returns gate non-eligible states.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Organic day-14 trigger: when the user has hit the eligibility
  // bar (≥14d signup, ≥1 session OR ≥2 patients), open the sheet
  // automatically the first time the user lands on Home in that
  // window. Dedupe via the same dismiss-key the sheet writes when
  // closed without submission.
  useEffect(() => {
    if (demo || readOnly) return;
    if (!user) return;
    if (ratingSheetOpen) return;
    const promptKind = "day14_v1";
    let hasDismissed = false;
    let hasSubmitted = false;
    try {
      hasDismissed = localStorage.getItem(`cardigan.rating.${promptKind}.dismissed.${user.id}`) === "1";
      hasSubmitted = localStorage.getItem(`cardigan.rating.${promptKind}.submitted.${user.id}`) === "1";
    } catch { /* ignore */ }
    // Compute days since signup from auth.users.created_at — same
    // signal the cron uses on the email side. NaN-safe.
    const created = user?.created_at ? new Date(user.created_at).getTime() : NaN;
    const daysSinceSignup = Number.isFinite(created)
      ? Math.floor((Date.now() - created) / 86_400_000)
      : 0;
    const eligible = shouldShowDay14Prompt({
      accessState: subscription.accessState,
      daysSinceSignup,
      sessionsCount: (upcomingSessions || []).length,
      patientsCount: (patients || []).length,
      hasSubmitted,
      hasDismissed,
      // Seconds since this App.jsx instance mounted — see ratingPrompt's
      // per-session cooldown rationale. Stops the ask from firing on
      // first home open for users who satisfy the time/usage gate but
      // haven't actually engaged with the app in the current session.
      secondsSinceSessionStart: (Date.now() - sessionStartedAt) / 1000,
    });
    if (eligible) setRatingSheetOpen(true);
  }, [demo, readOnly, user, subscription.accessState, upcomingSessions, patients, ratingSheetOpen, sessionStartedAt]);

  // Welcome-to-Pro prompt: fires once for real trial users (not
  // subscribed, not comp, not admin). Persistent dismissal lives in
  // localStorage so a refresh doesn't replay the modal.
  //
  // Timing: previously gated strictly on `tutorial.state === "done"`,
  // which meant users who never engaged with the tutorial welcome at
  // all (closed the tab, backgrounded the PWA, refreshed mid-onboard)
  // never saw the trial prompt EVER. Now we have two paths:
  //   • Tutorial reached "done" → fire after 600ms hand-off grace
  //   • Tutorial sits in idle/welcome past a 10s ceiling → fire anyway
  //   • Tutorial actively "running" → wait (don't interrupt)
  // The effect re-runs on tutorial.state transitions, so a user who
  // starts the tutorial 9s in still gets clean handoff at "done".
  const [welcomeProOpen, setWelcomeProOpen] = useState(false);
  useEffect(() => {
    if (demo || viewAsUserId) return;
    if (!user?.id) return;
    if (subscription.accessState !== "trial") return;
    if (tutorialState === "running") return;
    let stored = null;
    try { stored = localStorage.getItem(`cardigan.welcomePro.shown.v1.${user.id}`); }
    catch { /* private mode — fall through and show; worst case it shows twice */ }
    if (stored) return;
    const delay = tutorialState === "done" ? 600 : 10000;
    const id = setTimeout(() => setWelcomeProOpen(true), delay);
    return () => clearTimeout(id);
  }, [demo, viewAsUserId, user?.id, subscription.accessState, tutorialState]);

  const persistWelcomeProSeen = useCallback(() => {
    if (!user?.id) return;
    try { localStorage.setItem(`cardigan.welcomePro.shown.v1.${user.id}`, "1"); }
    catch { /* private mode — best effort */ }
  }, [user?.id]);

  const closeWelcomePro = useCallback(() => {
    persistWelcomeProSeen();
    setWelcomeProOpen(false);
  }, [persistWelcomeProSeen]);

  // Welcome-modal "Subscribe now" → close the modal and pop the native
  // payment sheet inline. We keep a separate paymentSheet state on App
  // so the sheet survives the modal closing (and so the same component
  // doesn't end up double-mounted from Settings if the user lands there
  // while the welcome modal flow is still active).
  const [welcomePaymentOpen, setWelcomePaymentOpen] = useState(false);
  const subscribeFromWelcomePro = useCallback(() => {
    persistWelcomeProSeen();
    setWelcomeProOpen(false);
    setWelcomePaymentOpen(true);
  }, [persistWelcomeProSeen]);

  // ── Trial reminder prompt (15 / 10 / 5 / 3 / 2 / 1 days left) ──
  // Fires at most once per (user, day) combination so the user isn't
  // pestered if they reload mid-day, and doesn't fire at all once
  // they've subscribed or been comp'd. Dedupe key encodes the YYYY-MM-DD
  // local date — a fresh login the next morning re-evaluates.
  const [trialReminderOpen, setTrialReminderOpen] = useState(false);
  const [trialReminderDays, setTrialReminderDays] = useState<number | null>(null);
  const [trialReminderPaymentOpen, setTrialReminderPaymentOpen] = useState(false);

  // ── Post-login passkey enrollment nudge ──
  // FIDO best practice: the post-login auto-prompt drives ~75% of all
  // passkey enrollments. Cadence is "respectful but persistent" — re-ask
  // on a LATER session (never the same one), after a cooldown, capped at
  // a few asks, then stop forever. Enrolling (here or anywhere) silences
  // it permanently. We only prompt on devices with a real platform
  // authenticator (Face ID / Touch ID), and defer ~1.6s so it doesn't
  // collide with first paint or stack on the trial reminder.
  //
  // State is a per-user JSON blob `{ n, t, enrolled }`:
  //   n = times shown, t = last-shown ms, enrolled = done forever.
  const [passkeyPromptOpen, setPasskeyPromptOpen] = useState(false);
  const [passkeyCreating, setPasskeyCreating] = useState(false);
  const passkeyPromptKey = user?.id ? `cardigan.passkeyPrompt.v2.${user.id}` : null;
  useEffect(() => {
    if (demo || viewAsUserId) return;
    if (!user?.id || !passkeyPromptKey) return;
    if (!passkeysAvailable()) return;
    let state;
    try { state = JSON.parse(localStorage.getItem(passkeyPromptKey) || "null"); } catch { state = null; }
    state = state || { n: 0, t: 0, enrolled: false };
    // Synchronous cadence gate (enrolled / cap / cooldown) — see
    // utils/modalGates. The async hardware + credential-list checks below
    // still decide whether the device can actually create a passkey.
    if (!shouldPromptPasskey(state, { now: Date.now() })) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      try {
        // Only nudge devices that can actually create a passkey.
        const hw = await passkeyPlatformAuthenticatorAvailable();
        if (cancelled || !hw) return;
        const { data, error } = await supabase.auth.passkey.list();
        if (cancelled || error) return;
        const list = Array.isArray(data) ? data : ((data as Row)?.passkeys || []);
        if (list.length > 0) {
          // Already enrolled (another device) — never prompt again.
          try { localStorage.setItem(passkeyPromptKey, JSON.stringify({ ...state, enrolled: true })); } catch { /* private mode */ }
          return;
        }
        timer = setTimeout(() => {
          if (cancelled) return;
          setPasskeyPromptOpen(true);
          // Count the ask the moment it's actually shown.
          try { localStorage.setItem(passkeyPromptKey, JSON.stringify({ ...state, n: (state.n || 0) + 1, t: Date.now() })); } catch { /* private mode */ }
        }, 1600);
      } catch { /* beta API hiccup — just skip the nudge */ }
    })();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [user?.id, demo, viewAsUserId, passkeyPromptKey]);

  const dismissPasskeyPrompt = useCallback(() => {
    // The ask was already recorded when shown; the cooldown + cap handle
    // re-prompting on a later session, so just close here.
    setPasskeyPromptOpen(false);
  }, []);

  const createPasskeyFromPrompt = useCallback(async () => {
    if (passkeyCreating) return;
    setPasskeyCreating(true);
    try {
      const { error } = await supabase.auth.registerPasskey();
      if (!error) {
        showSuccess(t("settings.passkeyPromptDone"));
        setPasskeyPromptOpen(false);
        try { if (passkeyPromptKey) localStorage.setItem(passkeyPromptKey, JSON.stringify({ enrolled: true, n: PASSKEY_PROMPT_MAX_ASKS, t: Date.now() })); } catch { /* private mode */ }
      } else if (!/NotAllowed|AbortError|cancel/i.test(error.name || error.message || "")) {
        // Real failure (not a user cancel) — surface a toast but keep the
        // prompt open so they can retry.
        showToast(t("settings.passkeyAddError"), "error");
      }
    } catch (e: Row) {
      if (!/NotAllowed|AbortError|cancel/i.test(e?.name || e?.message || "")) {
        showToast(t("settings.passkeyAddError"), "error");
      }
    } finally {
      setPasskeyCreating(false);
    }
  }, [passkeyCreating, passkeyPromptKey, showSuccess, showToast, t]);

  useEffect(() => {
    // Read the side-effect inputs (plan-sheet grace stamp + last-shown
    // day) from localStorage; the pure eligibility decision lives in
    // shouldShowTrialReminder (utils/modalGates). The plan sheet stamps
    // `cardigan.planSheetSeen.<userId>` on open (Settings activeSheet ===
    // "plan"); we skip the nudge within its grace window.
    const uid = user?.id;
    const days = subscription.daysLeftInTrial;
    const dateKey = todayDateKey();
    const lsKey = uid ? `cardigan.trialReminder.lastShown.${uid}` : "";
    let planSheetSeenAt = 0;
    let last: string | null = null;
    if (uid) {
      try { const seen = localStorage.getItem(`cardigan.planSheetSeen.${uid}`); planSheetSeenAt = seen ? Number(seen) : 0; }
      catch { /* private mode — fall through */ }
      try { last = localStorage.getItem(lsKey); }
      catch { /* private mode — show anyway */ }
    }
    if (!shouldShowTrialReminder({
      demo: !!demo, viewingAsUser: !!viewAsUserId, hasUser: !!uid,
      accessState: subscription.accessState, daysLeft: days,
      planSheetSeenAt, lastShownDateKey: last, todayKey: dateKey, now: Date.now(),
    })) return;

    // Defer slightly so the modal doesn't compete with the welcome-to-
    // Pro modal on a brand-new user's first session — and so it lands
    // a beat after auth/loading settles. Anything earlier feels jumpy.
    const timer = setTimeout(() => {
      setTrialReminderDays(days as number);
      setTrialReminderOpen(true);
      try { localStorage.setItem(lsKey, dateKey); }
      catch { /* fall through */ }
    }, 1200);
    return () => clearTimeout(timer);
  }, [demo, viewAsUserId, user?.id, subscription.accessState, subscription.daysLeftInTrial]);

  const subscribeFromTrialReminder = useCallback(() => {
    setTrialReminderOpen(false);
    setTrialReminderPaymentOpen(true);
  }, []);

  // ── "Welcome to Pro" celebration ──
  // Fires once per user on the first transition from non-active →
  // active (paid sub or comp). Persisted via localStorage so a refresh
  // won't replay it. Comp-granted accounts get the same celebration —
  // the moment is "you have Pro now" regardless of whether money
  // changed hands.
  const [subscriptionSuccessOpen, setSubscriptionSuccessOpen] = useState(false);
  const prevSubActiveRef = useRef(false);
  useEffect(() => {
    if (demo || viewAsUserId) return;
    if (!user?.id) return;
    const isActiveNow = !!(subscription.subscribedActive || subscription.compGranted);
    const wasActive = prevSubActiveRef.current;
    prevSubActiveRef.current = isActiveNow;
    if (!isActiveNow || wasActive) return;
    let shown = null;
    try { shown = localStorage.getItem(`cardigan.welcomedPro.${user.id}`); }
    catch { /* private mode — fall through and show; one extra modal isn't a big deal */ }
    if (shown) return;
    setSubscriptionSuccessOpen(true);
  }, [demo, viewAsUserId, user?.id, subscription.subscribedActive, subscription.compGranted]);

  const closeSubscriptionSuccess = useCallback(() => {
    if (user?.id) {
      try { localStorage.setItem(`cardigan.welcomedPro.${user.id}`, "1"); }
      catch { /* private mode — fine */ }
    }
    setSubscriptionSuccessOpen(false);
  }, [user?.id]);

  return {
    // Rating sheet
    ratingSheetOpen, setRatingSheetOpen,
    // Welcome-to-Pro
    welcomeProOpen, closeWelcomePro, subscribeFromWelcomePro,
    welcomePaymentOpen, setWelcomePaymentOpen,
    // Trial reminder
    trialReminderOpen, setTrialReminderOpen, trialReminderDays,
    trialReminderPaymentOpen, setTrialReminderPaymentOpen, subscribeFromTrialReminder,
    // Passkey enroll nudge
    passkeyPromptOpen, passkeyCreating, dismissPasskeyPrompt, createPasskeyFromPrompt,
    // Subscription-success celebration
    subscriptionSuccessOpen, closeSubscriptionSuccess,
  };
}
