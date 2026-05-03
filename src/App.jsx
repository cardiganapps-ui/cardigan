import { useEffect, useState, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { useAuth } from "./hooks/useAuth";
import { useNoteCrypto } from "./hooks/useNoteCrypto";
import EncryptionUnlockGate from "./components/EncryptionUnlockGate.jsx";
import SubscriptionWelcome from "./components/SubscriptionWelcome.jsx";
import { MilestoneCelebration } from "./components/MilestoneCelebration.jsx";
// Lazy-loaded — Stripe.js + the PaymentElement chunk only ship when a
// user actually opens the welcome-modal subscribe flow.
const StripePaymentSheet = lazy(() => import("./components/StripePaymentSheet.jsx"));
const ProUpgradeSheet = lazy(() => import("./components/ProUpgradeSheet.jsx").then(m => ({ default: m.ProUpgradeSheet })));
const TrialReminderPrompt = lazy(() => import("./components/TrialReminderPrompt.jsx"));
// Lazy because it pulls a small confetti renderer + a celebration
// modal that 99% of users see once or never. No reason to bundle it
// in the main chunk.
const SubscriptionSuccess = lazy(() => import("./components/SubscriptionSuccess.jsx").then(m => ({ default: m.SubscriptionSuccess })));
import { useAvatarUrl } from "./hooks/useAvatarUrl";
import { AvatarContent } from "./components/Avatar";
import { useCardiganData, isAdmin } from "./hooks/useCardiganData";
import { haptic } from "./utils/haptics";
import { useDemoData } from "./hooks/useDemoData";
import { useNavigation } from "./hooks/useNavigation";
import { CardiganProvider } from "./context/CardiganContext";
import { I18nProvider, useT } from "./i18n/index";
import { Drawer } from "./components/Drawer";
import { PaymentModal } from "./components/PaymentModal";
import { QuickActions } from "./components/QuickActions";
import TopbarActions from "./components/TopbarActions";
import CommandPalette from "./components/CommandPalette";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useViewport } from "./hooks/useViewport";
import { DRAWER_EDGE_BAND, release as releaseSwipe, tryClaim as trySwipeClaim } from "./hooks/swipeCoordinator";
import { PullToRefresh } from "./components/PullToRefresh";
import { BottomTabs } from "./components/BottomTabs";
import { LogoIcon } from "./components/LogoMark";
import { HelpTip } from "./components/HelpTip";
import { IconRefresh } from "./components/Icons";
import Tooltip from "./components/Tooltip";
import { InstallPrompt } from "./components/InstallPrompt";
// Tutorial only runs on first sign-in (and on user-triggered replay
// from Settings). Lazy so the ~30 KB tutorial chunk doesn't sit in
// the main bundle for users who already finished it.
const Tutorial = lazy(() => import("./components/Tutorial/Tutorial").then(m => ({ default: m.Tutorial })));
import { STEP_IDS_REQUIRING_FAB } from "./components/Tutorial/tutorialSteps";
import { useTutorial } from "./hooks/useTutorial";
import { ToastStack } from "./components/Toast";
import { QuickScheduleSheet } from "./components/sheets/QuickScheduleSheet";
import { isEpisodic } from "./data/constants";
import { shortDateToISO, todayISO as todayISOFn } from "./utils/dates";
import { Home } from "./screens/Home";
import { Agenda } from "./screens/Agenda";
import { Patients } from "./screens/Patients";
import { Finances } from "./screens/Finances";
import { Archivo } from "./screens/Archivo";
import { Settings } from "./screens/Settings";
import { PrivacyPolicy } from "./screens/PrivacyPolicy";
import { AuthScreen } from "./screens/AuthScreen";
// AdminPanel is only mounted when the admin opens it from the
// topbar (one user across the whole platform). Lazy so the ~40 KB
// admin chunk doesn't ship to every regular user.
const AdminPanel = lazy(() => import("./screens/AdminPanel").then(m => ({ default: m.AdminPanel })));
import { ProfessionOnboarding } from "./screens/ProfessionOnboarding";
import { useUserProfile } from "./hooks/useUserProfile";
import { useAccentTheme } from "./hooks/useAccentTheme";
import { DEFAULT_PROFESSION } from "./data/constants";
import { setSentryProfession } from "./lib/sentry";
import { identify as analyticsIdentify, track as analyticsTrack, reset as analyticsReset } from "./lib/analytics";
import ConsentBanner from "./components/ConsentBanner";
import MfaChallengeGate from "./components/MfaChallengeGate";
import { PasswordRecoveryScreen } from "./components/PasswordRecoveryScreen";
import { BugReportSheet } from "./components/BugReportFab";
import { UpdatePrompt, consumePostUpdateToast } from "./components/UpdatePrompt";
import { useTheme } from "./hooks/useTheme";
import { useNotifications } from "./hooks/useNotifications";
import { useSubscription } from "./hooks/useSubscription";
import "./utils/logBuffer";
import "./styles/index.css";

// Days-remaining thresholds at which we surface the trial reminder
// modal. Module-level so the dependency array of the gating effect
// stays stable across renders. Cadence is intentionally light — three
// nudges across the 30-day window respects the user's attention much
// more than a daily-during-the-final-week barrage. Each modal is also
// suppressed if the user opened the plan sheet within the last 3 days
// (see PLAN_SHEET_GRACE_MS below).
const TRIAL_REMINDER_THRESHOLDS = [15, 7, 1];
// If the user opened Settings → plan within this window, skip the
// reminder modal — they're clearly aware of the trial and we don't
// need to interrupt them again.
const PLAN_SHEET_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

function CardiganApp() {
  const { user, loading: authLoading, signUp, signIn, signOut, refreshUser, recoveryMode, inviteMode, setNewPassword } = useAuth();
  const [demoMode, setDemoMode] = useState(false);
  // When set, AuthScreen mounts directly into the signup sheet — used by the
  // demo banner's "Crear cuenta" button AND by the ?ref=<code> referral-link
  // capture below, so a visitor arriving from a friend's invite link skips
  // the landing page entirely.
  const [authIntent, setAuthIntent] = useState(() => {
    // Capture ?ref=<code> at module/component initial render — runs
    // BEFORE the auth gate so an unauthenticated visitor lands
    // straight on the signup sheet instead of having to find
    // "Comenzar gratis" themselves. The code is stashed in
    // sessionStorage so it survives the email-verify roundtrip and
    // the eventual checkout pulls it from there. URL is stripped
    // so a refresh + screenshot doesn't leak the parameter.
    if (typeof window === "undefined") return null;
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref");
      if (!ref) return null;
      const sanitized = ref.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
      if (!sanitized) return null;
      try { sessionStorage.setItem("cardigan.referralFromUrl", sanitized); }
      catch { /* private mode — fine, the URL is gone after this anyway */ }
      params.delete("ref");
      const newUrl = window.location.pathname
        + (params.toString() ? `?${params.toString()}` : "")
        + window.location.hash;
      window.history.replaceState({}, "", newUrl);
      // Auto-jump to signup. Returning "signup" here seeds authIntent
      // so AuthScreen renders the signup sheet on its first render.
      return "signup";
    } catch { return null; }
  });
  // MFA gate state — `mfaResolved` flips true once MfaChallengeGate
  // determines no challenge is needed OR a challenge succeeds. Reset
  // whenever the user changes (sign-out / sign-in) so we re-check.
  const [mfaResolved, setMfaResolved] = useState(false);
  const theme = useTheme();
  // Reset the gate when the user identity changes (sign-out → sign-in,
  // or a different account). Synchronous setState in this effect is
  // intentional — we MUST gate the next render before any of AppShell's
  // data fetches kick off. Same pattern as useUserProfile's userId reset.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMfaResolved(false); }, [user?.id]);

  if (authLoading && !demoMode) {
    return (
      <div className="shell" style={{ justifyContent:"center", alignItems:"center", gap:12 }}>
        <LogoIcon size={48} color="var(--teal)" />
        <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--charcoal)", letterSpacing:"-0.3px" }}>cardigan</div>
      </div>
    );
  }

  if (demoMode) {
    return <AppShell user={null} signOut={() => { setAuthIntent("signup"); setDemoMode(false); }} demo theme={theme} />;
  }

  // Password recovery takes priority over every other gate. Supabase
  // auto-signs the user in via the recovery token, so `user` is set —
  // but they need to set a new password before doing anything else.
  // setNewPassword signs them out on success, dropping them into
  // AuthScreen with the freshly-set credential.
  // Recovery + invite both gate the user behind a "set your password"
  // screen before letting them into AppShell. Same component, mode
  // switches the title/body copy.
  if (recoveryMode || inviteMode) {
    return <PasswordRecoveryScreen
      onSubmit={setNewPassword}
      onSignOut={signOut}
      mode={inviteMode ? "invite" : "recovery"}
    />;
  }

  if (!user) {
    return <AuthScreen onSignIn={signIn} onSignUp={signUp} onDemo={() => { setAuthIntent(null); setDemoMode(true); }} autoOpen={authIntent} />;
  }

  // Block the main shell behind the MFA gate. Self-resolves to no-op
  // when the user has no MFA factor enrolled — see MfaChallengeGate.
  if (!mfaResolved) {
    return <MfaChallengeGate onResolved={() => setMfaResolved(true)} onSignOut={signOut} />;
  }

  return <AppShell user={user} signOut={signOut} refreshUser={refreshUser} theme={theme} />;
}

export default function Cardigan() {
  return (
    <I18nProvider>
      <CardiganApp />
      {/* Mount UpdatePrompt outside CardiganApp so the "Actualización
          disponible" toast shows even on the auth screen / demo mode. */}
      <UpdatePrompt />
    </I18nProvider>
  );
}

/* ── SkeletonCrossfade ──
   Wraps the first-load swap from LoadingSkeleton → real content with
   a 250ms crossfade so the transition doesn't read as a hard cut.
   When `showContent` flips true, both layers remain mounted for the
   fade duration: content fades in from 0 while the skeleton fades out
   on top, giving the eye a continuous handoff. */
function SkeletonCrossfade({ showContent, skeletonScreen, children }) {
  const [keepSkeleton, setKeepSkeleton] = useState(!showContent);
  useEffect(() => {
    if (showContent && keepSkeleton) {
      const id = setTimeout(() => setKeepSkeleton(false), 260);
      return () => clearTimeout(id);
    }
    // Re-raise the skeleton when the app transitions back to loading
    // (rare — pull-to-refresh while the patient list is empty). The
    // set is synchronous in the effect on purpose: the skeleton needs
    // to be visible in the same frame we lose the content.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!showContent && !keepSkeleton) setKeepSkeleton(true);
  }, [showContent, keepSkeleton]);

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {showContent && (
        <div style={{
          flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
          animation: keepSkeleton ? "fadeIn 0.25s ease" : undefined,
        }}>
          {children}
        </div>
      )}
      {keepSkeleton && (
        <div style={{
          position: showContent ? "absolute" : "static",
          inset: 0,
          flex: showContent ? undefined : 1,
          minHeight: 0,
          display: "flex", flexDirection: "column",
          animation: showContent ? "fadeOut 0.25s ease forwards" : undefined,
          pointerEvents: showContent ? "none" : undefined,
        }}>
          <LoadingSkeleton screen={skeletonScreen} />
        </div>
      )}
    </div>
  );
}

/* ── LoadingSkeleton ──
   Shown on first load (before any data has been fetched) instead of a
   blank screen or a bare "Cargando..." line. Five layout-matched
   variants — home / agenda / patients / finances / documents — so
   the skeleton's shape lines up with where the real content will
   land. The skeleton-to-content swap then reads as "the same screen
   filling in" rather than "two different screens cross-fading".
   Falls back to a generic "header + list" skeleton for any screen
   not yet specialised (Settings, AdminPanel, etc.). */
function LoadingSkeleton({ screen = "home" }) {
  const skeletonAvatarRow = (key, idx) => (
    <div key={key} className="row-item" style={{ cursor:"default" }}>
      <div className="sk-circle" />
      <div className="row-content">
        <div className="sk-bar sk-bar-md" style={{ width:`${45 + (idx * 7) % 35}%`, marginBottom:6 }} />
        <div className="sk-bar sk-bar-xs" style={{ width:`${25 + (idx * 11) % 25}%` }} />
      </div>
    </div>
  );

  if (screen === "agenda") {
    // Agenda's primary view is the day list — a header strip with
    // weekday tiles, then a list of session rows. Skeleton matches
    // both so the day-strip → session-list handoff is seamless.
    return (
      <div className="page" aria-hidden>
        <div style={{ padding:"16px 16px 8px" }}>
          <div className="sk-bar sk-bar-md" style={{ width:"35%", marginBottom:14 }} />
          <div style={{ display:"flex", gap:8 }}>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} style={{ flex:1, padding:"10px 4px", borderRadius:"var(--radius)", background:"var(--white)", border:"1px solid var(--border)", textAlign:"center" }}>
                <div className="sk-bar sk-bar-xs" style={{ width:"60%", margin:"0 auto 6px" }} />
                <div className="sk-bar sk-bar-md" style={{ width:"40%", margin:"0 auto" }} />
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding:"12px 16px 0" }}>
          <div className="card">
            {Array.from({ length: 5 }).map((_, i) => skeletonAvatarRow(i, i))}
          </div>
        </div>
      </div>
    );
  }

  if (screen === "finances") {
    // Finances has the same KPI-tiles-then-list shape as Home, just
    // 4-up always. Mirror that so the swap doesn't reflow the page.
    return (
      <div className="page" aria-hidden>
        <div style={{ padding:"16px 16px 4px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="kpi-card">
              <div className="sk-bar sk-bar-sm" style={{ width:"55%", marginBottom:10 }} />
              <div className="sk-bar sk-bar-lg" style={{ width:"70%", marginBottom:6 }} />
              <div className="sk-bar sk-bar-xs" style={{ width:"40%" }} />
            </div>
          ))}
        </div>
        <div style={{ padding:"16px 16px 0" }}>
          <div className="sk-bar sk-bar-md" style={{ width:"40%", marginBottom:12 }} />
          <div className="card">
            {Array.from({ length: 5 }).map((_, i) => skeletonAvatarRow(i, i))}
          </div>
        </div>
      </div>
    );
  }

  if (screen === "documents" || screen === "archivo") {
    // Documents — filter chip strip, then a card with file rows. The
    // file rows have a square thumb + name + meta, so the skeleton
    // mirrors that instead of the round-avatar shape.
    return (
      <div className="page" aria-hidden>
        <div style={{ padding:"16px 16px 12px" }}>
          <div className="sk-bar sk-bar-md" style={{ width:"45%", marginBottom:14 }} />
          <div style={{ display:"flex", gap:8 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="sk-bar sk-bar-md" style={{ width: 70 + i*8, height: 30, borderRadius: 999 }} />
            ))}
          </div>
        </div>
        <div style={{ padding:"0 16px" }}>
          <div className="card">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="row-item" style={{ cursor:"default" }}>
                <div className="sk-bar" style={{ width:36, height:36, borderRadius:8 }} />
                <div className="row-content" style={{ marginLeft:12 }}>
                  <div className="sk-bar sk-bar-md" style={{ width:`${45 + (i * 9) % 30}%`, marginBottom:6 }} />
                  <div className="sk-bar sk-bar-xs" style={{ width:`${20 + (i * 7) % 20}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (screen !== "home") {
    return (
      <div className="page" aria-hidden>
        <div style={{ padding:"20px 16px 10px" }}>
          <div className="sk-bar sk-bar-lg" style={{ width:"40%", marginBottom:8 }} />
          <div className="sk-bar sk-bar-sm" style={{ width:"60%" }} />
        </div>
        <div style={{ padding:"0 16px" }}>
          <div className="card">
            {Array.from({ length: 6 }).map((_, i) => skeletonAvatarRow(i, i))}
          </div>
        </div>
      </div>
    );
  }
  // Home variant — the only screen with the KPI-tiles + carousel
  // layout, so it gets a bespoke skeleton matching that shape. The
  // generic skeletonAvatarRow above is reused for the list rows.
  const skeletonRow = (key) => skeletonAvatarRow(key, key);
  return (
    <div className="page" aria-hidden>
      {/* Match real Home's classes so the responsive rules kick in —
         kpi-grid-desktop → 4-col on iPad+, home-columns + .home-col-*
         give the right main/side split at each breakpoint. Without
         these the skeleton stayed at 2-col KPIs + single narrow card,
         which read as "too narrow" on iPad landscape. */}
      <div className="kpi-grid-desktop" style={{ padding:"16px 16px 4px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="kpi-card">
            <div className="sk-bar sk-bar-sm" style={{ width:"50%", marginBottom:10 }} />
            <div className="sk-bar sk-bar-lg" style={{ width:"70%", marginBottom:6 }} />
            <div className="sk-bar sk-bar-xs" style={{ width:"40%" }} />
          </div>
        ))}
      </div>
      <div className="home-columns">
        <div className="section home-col-main">
          <div className="section-header home-carousel" style={{ padding:"0 16px 8px" }}>
            <div className="sk-bar sk-bar-sm" style={{ width:"45%" }} />
          </div>
          {/* Mobile/iPad portrait: single card (carousel panel stand-in) */}
          <div className="home-carousel" style={{ padding:"0 16px" }}>
            <div className="card">
              {Array.from({ length: 3 }).map((_, i) => skeletonRow(i))}
            </div>
          </div>
          {/* iPad landscape / desktop: today + tomorrow side-by-side */}
          <div className="home-two-panel-desktop">
            {Array.from({ length: 2 }).map((_, p) => (
              <div key={p}>
                <div className="home-panel-meta">
                  <div className="sk-bar sk-bar-xs" style={{ width:"40%" }} />
                </div>
                <div className="card">
                  {Array.from({ length: 3 }).map((_, i) => skeletonRow(i))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="home-col-side">
          {Array.from({ length: 2 }).map((_, s) => (
            <div key={s} className="section" style={{ padding:"16px 16px 0" }}>
              <div className="section-header">
                <div className="sk-bar sk-bar-sm" style={{ width:"40%" }} />
              </div>
              <div className="card">
                {Array.from({ length: 3 }).map((_, i) => skeletonRow(i))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AppShell({ user, signOut, refreshUser, demo, theme }) {
  const { t, setProfession: setI18nProfession } = useT();
  const { screen, direction, navigate, pushLayer, popLayer, removeLayer } = useNavigation();
  const setScreen = navigate; // alias for compatibility
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { isTablet } = useViewport();
  const [viewAsUserId, setViewAsUserId] = useState(null);
  const [showAdmin, setShowAdmin] = useState(false);
  // `localHideFab` is controlled by non-tutorial callers (e.g. the Patients
  // expediente drawer). The tutorial contributes its own reason to hide
  // the FAB, derived synchronously from `tutorial` state below — that way
  // when the tutorial ends there's no single-frame lag where the tutorial
  // overlay is gone but BottomTabs haven't mounted back yet (which used
  // to show as dark bands on the safe areas in dark mode).
  const [localHideFab, setHideFab] = useState(false);
  const [bugReportOpen, setBugReportOpen] = useState(false);
  // The encryption unlock prompt is dismissable for the current
  // session — closing the tab re-prompts on next visit. Until then,
  // encrypted notes still render as "[cifrado]" since noteCrypto.canEncrypt
  // stays false.
  const [cryptoGateDismissed, setCryptoGateDismissed] = useState(false);
  // Track whether we've already evaluated the welcome-to-Pro prompt
  // for this session. Local-storage handles the persistent "show
  // once" rule; this state controls whether the modal is currently
  // visible. The modal hands itself either dismissal path
  // (continueTrial / startCheckout) and we record the local flag
  // synchronously inside both handlers.
  const [welcomeProOpen, setWelcomeProOpen] = useState(false);
  const admin = !demo && isAdmin(user);

  // Note encryption — opt-in, per-user. The hook self-fetches status
  // on mount and exposes encrypt/decrypt callbacks that the data layer
  // threads through to useNotes + the notes fetch path.
  // Skip in demo mode (no real account) and in admin "view as user"
  // mode (writes are blocked there anyway).
  const noteCrypto = useNoteCrypto({ user: (demo || viewAsUserId) ? null : user });
  // Multi-profession: fetch the active user's profession row. In demo
  // mode this short-circuits to null. In admin "view as user" mode the
  // target user's profession is fetched (RLS allows it via the admin
  // policy) so the labels match what that user actually sees.
  const profileUserId = demo ? null : (viewAsUserId || user?.id || null);
  const userProfile = useUserProfile(profileUserId);
  // Demo mode lets the visitor preview each profession's flavor — the
  // picker lives in the demo banner. Live mode (real user) ignores this
  // and uses the loaded user_profiles row instead.
  const [demoProfession, setDemoProfession] = useState(DEFAULT_PROFESSION);
  const profession = demo
    ? demoProfession
    : (userProfile.profession || DEFAULT_PROFESSION);
  // Push the active profession into the I18nProvider so future
  // {client.s}/{session.p}/etc. placeholders in t() resolve to this
  // profession's vocabulary. Demo and view-as flows both update too.
  useEffect(() => {
    setI18nProfession(profession);
  }, [profession, setI18nProfession]);
  // Accent palette is a per-user preference (Settings → Apariencia),
  // independent of profession — every user defaults to the base teal
  // and can opt into one of the alternate accents from the picker.
  // useAccentTheme hydrates the `data-accent` attribute on <html>;
  // accent-themes.css remaps `--teal*` / `--accent*` via the cascade.
  const accentTheme = useAccentTheme();
  // Tag Sentry events with the active profession + demo flag so
  // profession-specific bugs are easy to triage in the Sentry UI.
  useEffect(() => {
    setSentryProfession(profession, { demo: !!demo });
  }, [profession, demo]);

  // Analytics identify / reset (Vercel Analytics — see src/lib/analytics.js).
  // Demo and admin-view-as both bypass — demo isn't a real user, and
  // view-as is the admin masquerading (we'd pollute the target
  // user's funnel).
  useEffect(() => {
    if (demo || viewAsUserId) return;
    if (!user?.id) {
      analyticsReset();
      return;
    }
    analyticsIdentify(user.id, {
      profession,
      created_at: user.created_at,
    });
  }, [demo, viewAsUserId, user?.id, user?.created_at, profession]);
  const liveData = useCardiganData(demo ? null : user, viewAsUserId, { noteCrypto });
  const demoData = useDemoData(demoProfession);
  const data = demo ? demoData : liveData;
  // SaaS subscription / trial gate. Skipped in demo mode (no real user)
  // and in admin "view as user" mode (the admin's own access state is
  // irrelevant to whether they can inspect another user's data — and
  // the target user's own state is read-only by virtue of viewAsUserId
  // already). When `accessExpired`, every mutation is blocked and the
  // FAB / write affordances hide; the UI surfaces a banner with a
  // "Suscribirme" CTA. Admins are exempt (see useSubscription).
  const subscription = useSubscription(demo || viewAsUserId ? null : user);
  /* Only pull out what App.jsx uses directly — everything else flows
     into context via `...data` spread in ctxValue below. */
  const {
    patients, upcomingSessions,
    loading, mutationError, clearMutationError,
    updateSessionStatus,
    refresh,
  } = data;
  // Compose read-only: native data-layer flag (admin "view as user")
  // OR trial-expired gate. Both block writes and hide the FAB; the UI
  // distinguishes them via banner copy.
  const readOnly = data.readOnly || subscription.accessExpired;
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentDraft, setPaymentDraft] = useState({ patientName:"", amount:"" });
  const [editingPayment, setEditingPayment] = useState(null);

  /* ── Toast queue (single source of truth) ──
     Previously three separate toast slots (success, mutationError,
     uiToast) rendered independently, which meant rapid mutations
     could clobber their own channel and the three channels could also
     collide on screen. Now every surface pushes into one queue; the
     UI renders up to MAX_TOASTS with a stagger, oldest fading out
     first. Persistent toasts (the mutationError) don't auto-dismiss. */
  const [toasts, setToasts] = useState([]);
  const nextToastIdRef = useRef(0);
  const showToast = useCallback((msg, type = "info", opts = {}) => {
    if (!msg) return null;
    const id = ++nextToastIdRef.current;
    setToasts(prev => {
      // Drop an earlier entry with the same key (e.g. reopening the
      // mutation-error channel) before appending, so the user only
      // sees one copy of a recurring message at a time.
      const base = opts.key ? prev.filter(t => t.key !== opts.key) : prev;
      const next = [...base, {
        id, kind: type, message: msg,
        persistent: !!opts.persistent,
        onRetry: opts.onRetry,
        actionLabel: opts.actionLabel,
        key: opts.key,
      }];
      if (next.length <= 5) return next;
      // Over cap: drop oldest non-persistent first.
      const out = [];
      let toDrop = next.length - 5;
      for (const t of next) {
        if (toDrop > 0 && !t.persistent) { toDrop--; continue; }
        out.push(t);
      }
      return out;
    });
    return id;
  }, []);
  // When the user dismisses the mutation-error toast we also clear
  // the underlying data-layer error so a subsequent failure with the
  // same message can re-raise (setMutationError is a no-op when the
  // new value matches the stale one).
  const dismissToast = useCallback((id) => {
    setToasts(prev => {
      const toast = prev.find(t => t.id === id);
      if (toast?.key === "mutation-error") clearMutationError?.();
      return prev.filter(t => t.id !== id);
    });
  }, [clearMutationError]);
  const showSuccess = useCallback((msg) => {
    if (!msg) return;
    showToast(msg, "success");
  }, [showToast]);

  /* QuickScheduleSheet at the App level — renders once, opened from
     anywhere via openQuickSchedule(patient) on the cardigan context.
     The end-of-visit toast (fired below from onMarkCompleted) routes
     into this so the user can schedule the next consult with one tap
     from the toast, regardless of which screen they're on. */
  const [quickScheduleFor, setQuickScheduleFor] = useState(null);
  const openQuickSchedule = useCallback((patient) => {
    if (!patient) return;
    setQuickScheduleFor(patient);
  }, []);
  // Post-reload "Actualizado correctamente" toast — UpdatePrompt
  // stamps localStorage right before the SW reload, and we surface
  // the confirmation once the new build mounts. consumePostUpdateToast
  // returns null when there's no recent apply or the stamp aged
  // out, so this effect is a no-op for organic reloads.
  useEffect(() => {
    const msg = consumePostUpdateToast();
    if (msg) showSuccess(msg);
  // showSuccess is stable. Run once on mount only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Surface mutationError from the data layer as a persistent,
  // keyed entry in the toast queue. The `mutation-error` key makes
  // showToast de-dup: re-raising replaces the existing entry rather
  // than stacking. When mutationError clears, strip any lingering
  // entry with that key.
  // Surface mutation errors as a persistent toast; clear it when the
  // error resolves.
  useEffect(() => {
    if (mutationError) {
      showToast(mutationError, "error", {
        persistent: true,
        onRetry: refresh,
        key: "mutation-error",
      });
    } else {
      // Functional updater returns `prev` unchanged when there's
      // nothing to remove, so React bails out — no cascading render.
      // (set-state-in-effect lint rule no longer flags this pattern;
      // the previous eslint-disable directive was reported as unused.)
      setToasts(prev => prev.some(t => t.key === "mutation-error")
        ? prev.filter(t => t.key !== "mutation-error")
        : prev);
    }
  }, [mutationError, showToast, refresh]);
  // Online/offline indicator — navigator.onLine is imperfect but "good
  // enough" for a surface warning; combined with explicit error toasts
  // for actual request failures it catches the common cases.
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine !== false : true);
  useEffect(() => {
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);
    return () => {
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
    };
  }, []);
  const pendingAgendaViewRef = useRef(null);
  const pendingExpedienteRef = useRef(null);

  // ── Stripe return-from-Checkout / Portal handler ──
  // Stripe sends users back to /?billing=success|cancel|return after
  // the hosted flow. We strip the param immediately (so a refresh
  // doesn't re-fire), broadcast a window event so useSubscription can
  // refetch the row, and surface a one-shot toast on success. The
  // webhook usually beats the redirect, but we delay the refetch
  // inside useSubscription as a fallback.
  useEffect(() => {
    if (demo) return;
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (!billing) return;
    params.delete("billing");
    params.delete("session_id");
    const newUrl = window.location.pathname
      + (params.toString() ? `?${params.toString()}` : "")
      + window.location.hash;
    window.history.replaceState({}, "", newUrl);
    window.dispatchEvent(new CustomEvent("cardigan-billing-return", { detail: { billing } }));
    if (billing === "success") {
      showSuccess(t("subscription.toastSubscribed"));
      analyticsTrack("subscribe_success", { source: "stripe_return" });
    } else if (billing === "cancel") {
      analyticsTrack("checkout_cancelled");
    }
  // showSuccess / t are stable by useCallback / context — only run on
  // first mount when the URL still has the billing param.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Referral-code URL handler (?ref=<CODE>) ──
  // The capture happens earlier in CardiganApp (before the auth
  // gate) so visitors arriving from a referral link land directly
  // on the signup sheet. By the time AppShell renders, the URL has
  // already been stripped and the code is in sessionStorage —
  // Settings → plan reads from there at checkout time. No further
  // work needed at this layer.

  const tutorial = useTutorial({ user, demo, readOnly });
  const tutorialHidesFab = tutorial?.isActive
    && !(tutorial?.step && STEP_IDS_REQUIRING_FAB.has(tutorial.step.id));
  const hideFab = localHideFab || tutorialHidesFab;
  const notifications = useNotifications(demo ? null : user);

  // Welcome-to-Pro prompt: fires once, after the user has finished or
  // skipped the tutorial, IFF they're a real user on the natural trial
  // (not subscribed, not comp, not admin). Persistent dismissal lives
  // in localStorage so a refresh doesn't replay the modal. The eligible
  // window is narrow on purpose — we never want to nag a paying user
  // or someone who's already declined.
  useEffect(() => {
    if (demo || viewAsUserId) return;
    if (!user?.id) return;
    if (subscription.accessState !== "trial") return;
    if (tutorial?.state !== "done") return;
    let stored = null;
    try { stored = localStorage.getItem(`cardigan.welcomePro.shown.v1.${user.id}`); }
    catch { /* private mode — fall through and show; worst case it shows twice */ }
    if (stored) return;
    // Small grace window so the modal doesn't pop the same frame the
    // tutorial confetti dismisses on. 600ms feels like a deliberate
    // hand-off without making the user wait.
    const id = setTimeout(() => setWelcomeProOpen(true), 600);
    return () => clearTimeout(id);
  }, [demo, viewAsUserId, user?.id, subscription.accessState, tutorial?.state]);

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

  // ── Pro feature gating ──
  // Centralized "open the upgrade sheet" so any screen can call
  // requirePro("documents" | "encryption" | "calendar") without
  // mounting its own copy of the sheet. The sheet renders once at App
  // level, far enough below the StripePaymentSheet that subscribing
  // from inside it can stack cleanly.
  const [proSheetOpen, setProSheetOpen] = useState(false);
  const [proSheetFeature, setProSheetFeature] = useState(null);
  const requirePro = useCallback((feature) => {
    // Trial users + expired users land here. Pro users (active sub,
    // comp, admin) should never see this sheet — callers must short-
    // circuit on `subscription.isPro` before invoking.
    setProSheetFeature(feature || "default");
    setProSheetOpen(true);
  }, []);

  // ── Trial reminder prompt (15 / 10 / 5 / 3 / 2 / 1 days left) ──
  // Fires at most once per (user, day) combination so the user isn't
  // pestered if they reload mid-day, and doesn't fire at all once
  // they've subscribed or been comp'd. Dedupe key encodes the YYYY-MM-DD
  // local date — a fresh login the next morning re-evaluates.
  const [trialReminderOpen, setTrialReminderOpen] = useState(false);
  const [trialReminderDays, setTrialReminderDays] = useState(null);
  const [trialReminderPaymentOpen, setTrialReminderPaymentOpen] = useState(false);
  useEffect(() => {
    if (demo || viewAsUserId) return;
    if (!user?.id) return;
    if (subscription.accessState !== "trial") return;
    const days = subscription.daysLeftInTrial;
    if (typeof days !== "number") return;
    if (!TRIAL_REMINDER_THRESHOLDS.includes(days)) return;

    // Skip if the user opened the plan sheet recently — they've already
    // reviewed pricing this week, no need to nudge them again. The
    // Settings sheet stamps `cardigan.planSheetSeen.<userId>` on open;
    // see Settings.jsx::useEffect that watches activeSheet === "plan".
    try {
      const seen = localStorage.getItem(`cardigan.planSheetSeen.${user.id}`);
      const seenAt = seen ? Number(seen) : 0;
      if (seenAt && Date.now() - seenAt < PLAN_SHEET_GRACE_MS) return;
    } catch { /* private mode — fall through */ }

    const today = new Date();
    const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const lsKey = `cardigan.trialReminder.lastShown.${user.id}`;
    let last = null;
    try { last = localStorage.getItem(lsKey); }
    catch { /* private mode — show anyway */ }
    if (last === dateKey) return;

    // Defer slightly so the modal doesn't compete with the welcome-to-
    // Pro modal on a brand-new user's first session — and so it lands
    // a beat after auth/loading settles. Anything earlier feels jumpy.
    const timer = setTimeout(() => {
      setTrialReminderDays(days);
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

  const userName = demo ? "Demo" : (user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuario");
  const userInitial = userName.charAt(0).toUpperCase();
  const { imageUrl: avatarImageUrl } = useAvatarUrl(demo ? null : user?.user_metadata?.avatar);

  const openEditPaymentModal = useCallback((payment) => {
    if (readOnly) return;
    setEditingPayment(payment);
    setPaymentDraft({ patientName: "", amount: "" });
    setPaymentModalOpen(true);
  }, [readOnly]);

  const openRecordPaymentModal = useCallback((patient) => {
    if (readOnly) return;
    setEditingPayment(null);
    setPaymentDraft({
      patientName: patient?.name || "",
      amount: patient ? String(patient.amountDue || 0) : "",
    });
    setPaymentModalOpen(true);
  }, [readOnly]);

  /* ── Edge swipe to open drawer ──
     These handlers are attached via a native addEventListener with
     `passive: false` so that once we detect an intentional horizontal swipe
     from the left edge we can call e.preventDefault() on the touchmove.
     That prevents iOS Safari's native "edge-swipe-back" gesture from racing
     with our drawer open (the combo the user reported as "the drawer opens
     AND the screen goes back"). React's synthetic touch handlers are always
     passive, so this has to go through addEventListener directly.

     Coordination with in-screen horizontal swipes (Agenda day/week/month):
     we claim the global swipeCoordinator lock the moment we commit to a
     horizontal drag and release it on end/cancel. useSwipe() reads the
     lock and bails out, so even a finger that crosses the edge band
     mid-drag can't drive two animations at once. */
  const shellRef = useRef(null);
  const edgeRef = useRef(null);
  const drawerOpenRef = useRef(drawerOpen);
  // Screen-slide animations from bottom-tab nav play for ~500ms. If we
  // let the edge-swipe activate during that window, the user sees the
  // screen still sliding into place AND the drawer sliding in — reads
  // as "other screens are moving". The ref mirrors `direction` so the
  // native handlers (closure-scoped, effect runs once) always see the
  // current value.
  const screenSlidingRef = useRef(false);
  useEffect(() => { drawerOpenRef.current = drawerOpen; }, [drawerOpen]);
  useEffect(() => { screenSlidingRef.current = !!direction; }, [direction]);
  const [swipeProgress, setSwipeProgress] = useState(0);

  useEffect(() => {
    // Skip edge-swipe-to-open entirely once the sidebar is persistent
    // (≥768px). Catching a touchstart on the left edge would be confusing
    // when the drawer is already visible. Mobile (iPhone) keeps the gesture.
    if (isTablet) return;
    const shell = shellRef.current;
    if (!shell) return;

    const EDGE_OWNER_ID = "drawer-edge";

    const onTouchStart = (e) => {
      if (drawerOpenRef.current) return;
      // DRAWER_EDGE_BAND is shared with useSwipe's IN_SCREEN_SWIPE_DEAD_ZONE
      // so the two gesture owners never race at start.
      if (e.touches[0].clientX < DRAWER_EDGE_BAND) {
        edgeRef.current = {
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          time: Date.now(),
          active: false,
          // When the screen is mid-slide we DON'T open the drawer (the
          // double animation reads as glitchy), but we MUST still
          // claim and prevent-default the gesture — otherwise iOS
          // Safari's native edge-swipe-back peek runs unimpeded and
          // paints the previous page next to our sliding content.
          // That was the "two screens side by side with a half-open
          // drawer" glitch reported by a user. We track-but-suppress.
          blockedByAnim: screenSlidingRef.current,
        };
      } else {
        edgeRef.current = null;
      }
    };

    const onTouchMove = (e) => {
      if (!edgeRef.current || drawerOpenRef.current) return;
      const dx = e.touches[0].clientX - edgeRef.current.startX;
      const dy = e.touches[0].clientY - edgeRef.current.startY;
      if (!edgeRef.current.active) {
        if (dx > 10 && Math.abs(dx) > Math.abs(dy)) {
          // Claim exclusive ownership of the horizontal-swipe arbiter.
          // If some other handler already owns it (unlikely at start,
          // but possible during settle animations), back off.
          if (!trySwipeClaim(EDGE_OWNER_ID)) {
            edgeRef.current = null;
            return;
          }
          edgeRef.current.active = true;
        } else if (Math.abs(dy) > 10 || dx < -5) {
          edgeRef.current = null;
          return;
        } else return;
      }
      if (edgeRef.current.active) {
        // Suppress iOS Safari's native back-peek while the user is dragging
        // the drawer in. This is the key to resolving the drawer-vs-back
        // conflict on non-standalone mobile browsers — and it must run
        // even when the screen-slide lockout is active, so Safari can't
        // paint the previous page underneath our animation.
        if (e.cancelable) e.preventDefault();
        if (!edgeRef.current.blockedByAnim) {
          setSwipeProgress(Math.max(0, dx));
        }
      }
    };

    const finishGesture = (e) => {
      if (!edgeRef.current?.active) {
        edgeRef.current = null;
        releaseSwipe(EDGE_OWNER_ID);
        setSwipeProgress(0);
        return;
      }
      const dx = e.changedTouches[0].clientX - edgeRef.current.startX;
      const elapsed = Date.now() - edgeRef.current.time;
      const velocity = dx / elapsed;
      const blocked = edgeRef.current.blockedByAnim;
      edgeRef.current = null;
      if (!blocked && (dx > 100 || velocity > 0.3)) {
        setDrawerOpen(true);
      }
      setSwipeProgress(0);
      // Release AFTER setSwipeProgress so any in-flight render reads
      // "still owned" and won't kick off a competing in-screen swipe.
      releaseSwipe(EDGE_OWNER_ID);
    };

    const onTouchCancel = () => {
      // Cancelled gesture — reset everything without committing.
      edgeRef.current = null;
      setSwipeProgress(0);
      releaseSwipe(EDGE_OWNER_ID);
    };

    shell.addEventListener("touchstart", onTouchStart, { passive: true });
    shell.addEventListener("touchmove", onTouchMove, { passive: false });
    shell.addEventListener("touchend", finishGesture, { passive: true });
    shell.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      shell.removeEventListener("touchstart", onTouchStart);
      shell.removeEventListener("touchmove", onTouchMove);
      shell.removeEventListener("touchend", finishGesture);
      shell.removeEventListener("touchcancel", onTouchCancel);
      releaseSwipe(EDGE_OWNER_ID);
    };
  }, [isTablet]);

  const [pendingFabAction, setPendingFabAction] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useKeyboardShortcuts({
    "meta+k": () => setPaletteOpen(true),
    "ctrl+k": () => setPaletteOpen(true),
    "meta+f": () => setPaletteOpen(true),
    "ctrl+f": () => setPaletteOpen(true),
    "/": () => setPaletteOpen(true),
    "meta+n": () => setPendingFabAction("patient"),
    "ctrl+n": () => setPendingFabAction("patient"),
  }, {
    enabled: !readOnly && !demo,
    leader: "g",
    leaderBindings: {
      h: () => navigate("home"),
      a: () => navigate("agenda"),
      p: () => navigate("patients"),
      f: () => navigate("finances"),
      n: () => navigate("archivo"),
    },
  });
  // Wrap delete actions so we show a success toast on completion. Keeps
  // callers (SessionSheet, Finances, NoteEditor, etc.) unchanged — they
  // still receive a function with the original signature.
  const withSuccess = useCallback((fn, msg) => async (...args) => {
    const ok = await fn(...args);
    if (ok) {
      haptic.tap();
      showSuccess(msg);
    }
    return ok;
  }, [showSuccess]);
  const ctxValue = useMemo(() => ({
    ...data,
    // Override data.readOnly with the composed value (admin view-as
    // OR trial-expired). Order matters \u2014 this MUST come after
    // `...data` so it wins.
    readOnly,
    subscription,
    requirePro,
    // Pro-gated mutation: any caller that bypasses the UI badges (e.g.
    // a direct path inside PatientExpediente) still gets short-circuited
    // here \u2014 we open the upgrade sheet and resolve the call as a no-op
    // so the caller's `await` doesn't throw.
    uploadDocument: subscription?.isPro
      ? data.uploadDocument
      : async () => { requirePro("documents"); return null; },
    deleteSession: withSuccess(data.deleteSession, "Sesi\u00f3n eliminada"),
    deletePayment: withSuccess(data.deletePayment, "Pago eliminado"),
    deleteNote: withSuccess(data.deleteNote, "Nota eliminada"),
    noteCrypto,
    profession,
    accentTheme,
    setProfessionLocal: userProfile.setProfessionLocal,
    user, userName, userInitial, openRecordPaymentModal, openEditPaymentModal, setHideFab, setScreen,
    navigate, pushLayer, popLayer, removeLayer, online,
    screen, drawerOpen, setDrawerOpen, tutorial, theme, notifications, showSuccess, showToast,
    pendingFabAction,
    requestFabAction: setPendingFabAction,
    consumeFabAction: () => setPendingFabAction(null),
    setAgendaView: (v) => { pendingAgendaViewRef.current = v; },
    consumeAgendaView: () => { const v = pendingAgendaViewRef.current; pendingAgendaViewRef.current = null; return v; },
    openExpediente: (patient) => {
      // Remember which screen the user came from so closing the
      // expediente can take them back there instead of stranding them
      // on Pacientes. Only set an origin when the caller isn't already
      // on Pacientes — otherwise closing would navigate to itself.
      pendingExpedienteRef.current = { patient, origin: screen !== "patients" ? screen : null };
      setScreen("patients");
    },
    consumeExpediente: () => {
      const v = pendingExpedienteRef.current;
      pendingExpedienteRef.current = null;
      return v;
    },
    openQuickSchedule,
    onCancelSession: async (s, charge, reason) => !readOnly && await updateSessionStatus(s.id, "cancelled", charge, reason),
    /* onMarkCompleted intercepts the standard updateSessionStatus
       call to layer in the "schedule next?" affordance for episodic
       patients. After the status flip succeeds, if the patient has
       no future scheduled session, fire an actionable toast that
       opens QuickScheduleSheet on tap. Recurring patients see no
       prompt — their schedule already covers the next visit. */
    onMarkCompleted: async (s, overrideStatus) => {
      if (readOnly) return false;
      const ok = await updateSessionStatus(s.id, overrideStatus || "completed");
      if (!ok) return ok;
      const patient = patients.find((p) => p.id === s.patient_id);
      if (!patient || !isEpisodic(patient)) return ok;
      // "Has a future visit already" check: any scheduled session
      // dated today-or-later that isn't this one.
      const todayIso = todayISOFn();
      const hasFuture = (upcomingSessions || []).some((row) => {
        if (row.patient_id !== patient.id) return false;
        if (row.id === s.id) return false;
        if (row.status === "cancelled" || row.status === "charged") return false;
        const iso = shortDateToISO(row.date);
        return iso >= todayIso;
      });
      if (hasFuture) return ok;
      // Fire the prompt toast. Reuses the toast queue's onRetry slot;
      // the new actionLabel prop (added in this round) carries the
      // localized "Programar próxima" label so this isn't mistaken
      // for an error retry.
      showToast(t("scheduling.endOfVisitPrompt"), "success", {
        actionLabel: t("scheduling.scheduleNext"),
        onRetry: () => openQuickSchedule(patient),
      });
      return ok;
    },
  }), [data, noteCrypto, profession, accentTheme, userProfile.setProfessionLocal, user, userName, userInitial, readOnly, subscription, requirePro, updateSessionStatus, patients, upcomingSessions, openQuickSchedule, t, navigate, setScreen, openRecordPaymentModal, openEditPaymentModal, pushLayer, popLayer, removeLayer, screen, drawerOpen, setDrawerOpen, tutorial, theme, notifications, showSuccess, showToast, online, pendingFabAction, withSuccess]);

  // First-time user gate: show ProfessionOnboarding before mounting the
  // main shell when the user has no user_profiles row yet. Demo mode
  // and admin "view as user" mode bypass this — the former never has a
  // user, the latter is read-only and the target user already has a
  // profile. The brief loading window falls through to the main shell
  // (with DEFAULT_PROFESSION); existing users have a backfilled row so
  // they see no flash. New users see splash → maybe one frame of empty
  // shell → onboarding.
  if (
    !demo
    && !viewAsUserId
    && user
    && !userProfile.loading
    && userProfile.profession === null
  ) {
    return (
      <ProfessionOnboarding
        onSelect={(p) => userProfile.createProfile(p)}
        onSignOut={signOut}
      />
    );
  }

  const screenMap = {
    home: <Home setScreen={setScreen} userName={userName} />,
    agenda: <Agenda />,
    patients: <Patients />,
    finances: <Finances />,
    archivo: <Archivo />,
    settings: <Settings user={user} signOut={signOut} refreshUser={refreshUser} />,
    privacy: <PrivacyPolicy />,
  };

  return (
    <CardiganProvider value={ctxValue}>
    <div className="shell" ref={shellRef}>
      {/* LFPDPPP consent gate — blocks the app on first login or after a
          policy version bump. Skipped in demo mode (no real user) and
          in admin "view as user" mode (read-only). */}
      {!demo && !readOnly && user && <ConsentBanner user={user} />}
      {!demo && !readOnly && user && !cryptoGateDismissed && (
        <EncryptionUnlockGate noteCrypto={noteCrypto} onSkip={() => setCryptoGateDismissed(true)} />
      )}
      {welcomeProOpen && (
        <SubscriptionWelcome
          daysLeftInTrial={subscription.daysLeftInTrial}
          onContinue={closeWelcomePro}
          onSubscribe={subscribeFromWelcomePro}
        />
      )}
      <Suspense fallback={null}>
        {welcomePaymentOpen && (
          <StripePaymentSheet
            open={welcomePaymentOpen}
            daysLeftInTrial={subscription.daysLeftInTrial}
            onClose={() => setWelcomePaymentOpen(false)}
            onSuccess={() => {
              setWelcomePaymentOpen(false);
              showSuccess(t("subscription.toastSubscribed"));
            }}
          />
        )}
      </Suspense>
      {/* Pro feature upgrade prompt — opens whenever a non-Pro user
          tries to use a gated feature. Centralized here so any screen
          can trigger via `requirePro(featureKey)` from context. */}
      <Suspense fallback={null}>
        {proSheetOpen && (
          <ProUpgradeSheet
            open={proSheetOpen}
            feature={proSheetFeature}
            onClose={() => setProSheetOpen(false)}
          />
        )}
      </Suspense>
      {/* Trial reminder — fires once per day at 15/10/5/3/2/1 days left.
          The dedicated payment sheet next to it stays mounted so the
          subscribe path keeps working even after the reminder closes. */}
      <Suspense fallback={null}>
        {trialReminderOpen && (
          <TrialReminderPrompt
            open={trialReminderOpen}
            daysLeft={trialReminderDays}
            onSubscribe={subscribeFromTrialReminder}
            onDismiss={() => setTrialReminderOpen(false)}
          />
        )}
        {trialReminderPaymentOpen && (
          <StripePaymentSheet
            open={trialReminderPaymentOpen}
            daysLeftInTrial={subscription.daysLeftInTrial}
            onClose={() => setTrialReminderPaymentOpen(false)}
            onSuccess={() => {
              setTrialReminderPaymentOpen(false);
              showSuccess(t("subscription.toastSubscribed"));
            }}
          />
        )}
        {subscriptionSuccessOpen && (
          <SubscriptionSuccess
            open={subscriptionSuccessOpen}
            onClose={closeSubscriptionSuccess}
          />
        )}
      </Suspense>
      {/* 0→1 first-patient / first-session / first-payment celebration.
          No UI of its own — fires success toasts via context.
          Skipped in demo + admin-view-as flows by passing accessState. */}
      {!demo && !viewAsUserId && user && (
        <MilestoneCelebration
          userId={user.id}
          accessState={subscription.accessState}
        />
      )}
      <Drawer screen={screen} setScreen={setScreen} onClose={() => setDrawerOpen(false)}
        user={user} signOut={signOut} open={drawerOpen} swipeProgress={swipeProgress}
        onReportBug={user && !demo && !readOnly ? () => { setDrawerOpen(false); setBugReportOpen(true); } : null} />

      <div className="main-content">
        <div className="status-bar" />

        {/* iOS Safari-only install nudge. Hidden in PWA mode, demo mode,
            and readonly mode. Dismissed state persists in localStorage. */}
        {!demo && !readOnly && <InstallPrompt />}

        {/* Demo banner */}
        {demo && (
          <div className="app-banner app-banner--demo">
            <span className="app-banner-text">{t("demo.banner")}</span>
            {/* Profession picker — styled pill that wraps a native
                <select> so it inherits accessibility + mobile keyboard
                handling for free, but reads as a Cardigan chip rather
                than an OS dropdown. The chevron is rendered via CSS
                `background-image` on the pill so it stays in-frame on
                iOS where -webkit-appearance:none is partial. */}
            <label className="app-banner-picker" aria-label={t("onboarding.title")}>
              <span className="app-banner-picker-value">
                {t(`onboarding.professions.${demoProfession}.label`)}
              </span>
              <select
                className="app-banner-picker-select"
                value={demoProfession}
                onChange={(e) => setDemoProfession(e.target.value)}>
                <option value="psychologist">
                  {t("onboarding.professions.psychologist.label")}
                </option>
                <option value="nutritionist">
                  {t("onboarding.professions.nutritionist.label")}
                </option>
                <option value="tutor">
                  {t("onboarding.professions.tutor.label")}
                </option>
                <option value="music_teacher">
                  {t("onboarding.professions.music_teacher.label")}
                </option>
                <option value="trainer">
                  {t("onboarding.professions.trainer.label")}
                </option>
              </select>
            </label>
            <button onClick={signOut} className="app-banner-action">
              {t("demo.createAccount")}
            </button>
          </div>
        )}

        {/* Read-only banner when viewing as another user */}
        {viewAsUserId && !demo && (
          <div className="app-banner app-banner--readonly">
            <span className="app-banner-text app-banner-text--muted">{t("admin.readOnly")}</span>
            <button onClick={() => { setViewAsUserId(null); setScreen("home"); }}
              className="app-banner-action app-banner-action--readonly">
              {t("admin.exit")}
            </button>
          </div>
        )}

        {/* Trial-expired banner — only when the trial has lapsed AND
            the user has no active Stripe subscription. Charcoal so it
            visually matches the read-only "view as user" banner — the
            user understands they've lost write access. CTA is the
            single accent-colored button on the strip, drawing the eye
            without screaming. */}
        {!demo && !viewAsUserId && subscription.accessExpired && (
          <div className="app-banner app-banner--expired">
            <span className="app-banner-text">{t("subscription.expiredBanner")}</span>
            <button onClick={() => navigate("settings")} className="app-banner-action">
              {t("subscription.subscribeShort")}
            </button>
          </div>
        )}

        {/* Past-due banner — sub is in Stripe's grace window after a
            failed renewal. We keep Pro access (Stripe is retrying the
            card behind the scenes) but warn the user so they fix it
            before the grace window expires and access drops. */}
        {!demo && !viewAsUserId
          && subscription.subscription?.status === "past_due" && (
          <div className="app-banner app-banner--trial">
            <span className="app-banner-text">{t("subscription.pastDueBanner")}</span>
            <button onClick={() => navigate("settings")} className="app-banner-action">
              {t("subscription.fixPaymentShort")}
            </button>
          </div>
        )}

        {/* Trial-soon-to-expire banner — only when in the last 7 days
            of trial AND no active sub yet. Non-blocking; the user can
            keep using the app. The 7-day threshold matches typical
            SaaS "renewal nudge" cadence. The "Día N de 30" pill makes
            the urgency tangible without being shouty — users register
            "I'm on day 25" much more viscerally than "5 days left". */}
        {!demo && !viewAsUserId
          && subscription.accessState === "trial"
          && subscription.daysLeftInTrial != null
          && subscription.daysLeftInTrial <= 7
          && (
          <div className="app-banner app-banner--trial">
            <span className="app-banner-text" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{
                display: "inline-block",
                padding: "2px 8px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.18)",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.04em",
              }}>
                {t("subscription.trialDayBadge", { n: Math.max(1, 30 - subscription.daysLeftInTrial + 1) })}
              </span>
              <span>
                {subscription.daysLeftInTrial <= 1
                  ? t("subscription.trialEndsTodayBanner")
                  : t("subscription.trialDaysLeftBanner", { n: subscription.daysLeftInTrial })}
              </span>
            </span>
            <button onClick={() => navigate("settings")} className="app-banner-action">
              {t("subscription.subscribeShort")}
            </button>
          </div>
        )}

        {/* Offline indicator — shown whenever the browser reports no
            network connectivity. Mutations will queue in local state but
            fail at the Supabase round-trip, so we warn proactively. */}
        {!online && (
          <div style={{ background:"var(--amber)", padding:"6px 16px", display:"flex", alignItems:"center", justifyContent:"center", gap:8, zIndex:"var(--z-banner)", flexShrink:0 }}>
            <span style={{ width:6, height:6, borderRadius:"50%", background:"var(--white)", display:"inline-block" }} />
            <span style={{ fontSize:"var(--text-xs)", fontWeight:700, color:"var(--white)" }}>{t("offline")}</span>
          </div>
        )}

        <div className="topbar">
          <button className={`hamburger ${drawerOpen?"open":""}`} data-tour="hamburger" onClick={() => setDrawerOpen(o=>!o)} aria-label={t("nav.menu")}>
            <div className="hamburger-line" />
            <div className="hamburger-line" />
            <div className="hamburger-line" />
          </button>
          <button type="button" className="topbar-brand" onClick={() => navigate("home")} aria-label={t("nav.home")} style={{ cursor:"pointer", background:"none", border:"none", padding:0 }}><LogoIcon size={20} color="currentColor" /><span>cardigan</span></button>
          <span className="topbar-screen-name">{t(`nav.${screen}`)}</span>
          <div className="topbar-right">
            {!readOnly && <TopbarActions onOpenPalette={() => setPaletteOpen(true)} />}
            <Tooltip label={t("retry")} placement="bottom">
              <button className="topbar-refresh-btn" onClick={refresh} aria-label={t("retry")}><IconRefresh size={16} /></button>
            </Tooltip>
            {admin && !readOnly && (
              <button className="admin-btn" onClick={() => setShowAdmin(true)}>
                Admin
              </button>
            )}
            {/* Contextual help for the current screen. Lives in the topbar
                so it doesn't eat vertical space on each page. HelpTip
                returns null when the screen's tip array is empty. */}
            <HelpTip tipsKey={`help.${screen}`} />
            <Tooltip label={t("nav.settings")} placement="bottom">
              <button type="button" className="avatar-sm" onClick={() => navigate("settings")} aria-label={t("nav.settings")} style={{ cursor:"pointer", border:"none" }}>
                <span className="avatar-sm-circle">
                  <AvatarContent initials={userInitial} imageUrl={avatarImageUrl} />
                </span>
              </button>
            </Tooltip>
          </div>
        </div>
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
        <PullToRefresh onRefresh={refresh}>
          <div style={{
            flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
            transition: direction ? "none" : undefined,
            animation: direction === "left" ? "screenSlideLeft 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)" :
                       direction === "right" ? "screenSlideRight 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)" : undefined,
          }}>
            <SkeletonCrossfade
              showContent={!(loading && patients.length === 0)}
              skeletonScreen={screen}
            >
              {screenMap[screen]}
            </SkeletonCrossfade>
          </div>
        </PullToRefresh>
        {!readOnly && (
          <PaymentModal open={paymentModalOpen} onClose={(msg) => { setPaymentModalOpen(false); setEditingPayment(null); if (typeof msg === "string" && msg) showSuccess(msg); }}
            initialPatientName={paymentDraft.patientName} initialAmount={paymentDraft.amount} editingPayment={editingPayment} />
        )}
        {!readOnly && !hideFab && <QuickActions />}
        {!hideFab && <BottomTabs />}
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

        {showAdmin && (
          <Suspense fallback={null}>
            <AdminPanel
              onViewAs={(uid) => { setViewAsUserId(uid); setShowAdmin(false); setScreen("home"); }}
              onClose={() => setShowAdmin(false)}
              currentAdminId={user?.id}
            />
          </Suspense>
        )}
        {user && !demo && !readOnly && (
          <BugReportSheet open={bugReportOpen} onClose={() => setBugReportOpen(false)} user={user} screen={screen} />
        )}
        {!demo && !readOnly && (
          <Suspense fallback={null}>
            <Tutorial />
          </Suspense>
        )}
        {/* Global QuickScheduleSheet — opened from the
            end-of-visit toast or any "openQuickSchedule(patient)"
            consumer. Mounted unconditionally; renders null when no
            patient is set so the rest of the shell isn't affected. */}
        {quickScheduleFor && (
          <QuickScheduleSheet
            patient={quickScheduleFor}
            onClose={() => setQuickScheduleFor(null)}
          />
        )}
      </div>
    </div>
    </CardiganProvider>
  );
}
