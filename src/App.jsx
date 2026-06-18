import { useEffect, useState, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { useAuth } from "./hooks/useAuth";
import { isNative, isIOS } from "./lib/platform";
import { supabase } from "./supabaseClient";
import { passkeysAvailable } from "./config/passkeys";
import { useNoteCrypto } from "./hooks/useNoteCrypto";
// Conditionally rendered after first paint by various gates (one-time
// prompts, encryption unlock, post-subscribe celebration, etc.). Lazy
// shaves them off the cold-start payload.
const EncryptionUnlockGate = lazy(() => import("./components/EncryptionUnlockGate.jsx"));
const SubscriptionWelcome = lazy(() => import("./components/SubscriptionWelcome.jsx"));
const MilestoneCelebration = lazy(() => import("./components/MilestoneCelebration.jsx").then(m => ({ default: m.MilestoneCelebration })));
const ActivationCompleteShareSheet = lazy(() => import("./components/ActivationCompleteShareSheet.jsx").then(m => ({ default: m.ActivationCompleteShareSheet })));
const RatingSheet = lazy(() => import("./components/RatingSheet.jsx").then(m => ({ default: m.RatingSheet })));
// Conditionally rendered by activeSheet === "shareFolder" — lazy
// keeps its (and its date-picker / preview deps') bytes off cold start.
const ShareFolderSheet = lazy(() => import("./components/sheets/ShareFolderSheet.jsx").then(m => ({ default: m.ShareFolderSheet })));
import { shouldShowDay14Prompt } from "./utils/ratingPrompt";
// Lazy-loaded — Stripe.js + the PaymentElement chunk only ship when a
// user actually opens the welcome-modal subscribe flow.
const StripePaymentSheet = lazy(() => import("./components/StripePaymentSheet.jsx"));
const ProUpgradeSheet = lazy(() => import("./components/ProUpgradeSheet.jsx").then(m => ({ default: m.ProUpgradeSheet })));
const CardiSheet = lazy(() => import("./components/sheets/CardiSheet.jsx").then(m => ({ default: m.CardiSheet })));
const InboxSheet = lazy(() => import("./components/sheets/InboxSheet.jsx").then(m => ({ default: m.InboxSheet })));
const TrialReminderPrompt = lazy(() => import("./components/TrialReminderPrompt.jsx"));
const PasskeyEnrollPrompt = lazy(() => import("./components/PasskeyEnrollPrompt.jsx"));
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
// Lazy-load the conditionally-rendered surfaces. Each only mounts in
// response to a user action (open drawer, record payment, open command
// palette, etc.), so deferring them shaves their bytes off the cold-
// start cost. Sub-2KB Suspense fallback={null} is invisible — these
// modules ship in their own chunks and pre-fetch by Vite's link
// preload as soon as the main shell renders.
// Importer factories are extracted so we can both lazy-load AND
// prefetch the chunks. The prefetch path (called from useEffect +
// hamburger hover/focus, see AppShell) imports the module so the
// browser caches it; the lazy wrapper then resolves instantly when
// the user actually opens the surface. Without the prefetch the
// first hamburger tap on a cold load gets a "nothing happens" beat
// while the chunk fetches in the background — Suspense fallback={null}.
const drawerImport = () => import("./components/Drawer");
const paymentModalImport = () => import("./components/PaymentModal");
const expenseSheetImport = () => import("./components/sheets/ExpenseSheet");
const recurringExpenseSheetImport = () => import("./components/sheets/RecurringExpenseSheet");
const commandPaletteImport = () => import("./components/CommandPalette");
const Drawer = lazy(() => drawerImport().then(m => ({ default: m.Drawer })));
const PaymentModal = lazy(() => paymentModalImport().then(m => ({ default: m.PaymentModal })));
const ExpenseSheet = lazy(() => expenseSheetImport().then(m => ({ default: m.ExpenseSheet })));
const RecurringExpenseSheet = lazy(() => recurringExpenseSheetImport().then(m => ({ default: m.RecurringExpenseSheet })));
const CommandPalette = lazy(commandPaletteImport);
import { QuickActions } from "./components/QuickActions";
import TopbarActions from "./components/TopbarActions";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useViewport } from "./hooks/useViewport";
import { DRAWER_EDGE_BAND, release as releaseSwipe, tryClaim as trySwipeClaim } from "./hooks/swipeCoordinator";
import { PullToRefresh } from "./components/PullToRefresh";
import { BottomTabs } from "./components/BottomTabs";
import { OfflineBanner } from "./components/OfflineBanner";
import { InstallPrompt } from "./components/InstallPrompt";
import { useConnectivity } from "./hooks/useConnectivity";
import { LogoIcon } from "./components/LogoMark";
import { AuthSplash } from "./components/AuthSplash";
import { HelpTip } from "./components/HelpTip";
import { IconRefresh, IconSearch, IconBell } from "./components/Icons";
import Tooltip from "./components/Tooltip";
// Tutorial only runs on first sign-in (and on user-triggered replay
// from Settings). Lazy so the ~30 KB tutorial chunk doesn't sit in
// the main bundle for users who already finished it.
const Tutorial = lazy(() => import("./components/Tutorial/Tutorial").then(m => ({ default: m.Tutorial })));
import { useTutorial } from "./hooks/useTutorial";
import { ToastStack } from "./components/Toast";
import { QuickScheduleSheet } from "./components/sheets/QuickScheduleSheet";
import { isEpisodic } from "./data/constants";
import { shortDateToISO, todayISO as todayISOFn } from "./utils/dates";
import { Home } from "./screens/Home";
/* Secondary screens — lazy-loaded so the main bundle drops the
   weight of components a user may never visit in a session.
   Patients pulls in PatientExpediente + the full edit sheet;
   Agenda has Day/Week/Month + drag-drop; Finances has charts,
   PagosTab, Balances; Settings is huge (subscription, encryption,
   calendar token, accent picker). LoadingSkeleton is the Suspense
   fallback (already keyed by screen name for per-screen shapes). */
const Agenda = lazy(() => import("./screens/Agenda").then(m => ({ default: m.Agenda })));
const Patients = lazy(() => import("./screens/Patients").then(m => ({ default: m.Patients })));
const Groups = lazy(() => import("./screens/Groups").then(m => ({ default: m.Groups })));
const Finances = lazy(() => import("./screens/Finances").then(m => ({ default: m.Finances })));
const Archivo = lazy(() => import("./screens/Archivo").then(m => ({ default: m.Archivo })));
const Settings = lazy(() => import("./screens/Settings").then(m => ({ default: m.Settings })));
const PrivacyPolicy = lazy(() => import("./screens/PrivacyPolicy").then(m => ({ default: m.PrivacyPolicy })));
// Patient surface — entire subtree never runs for therapist accounts
// (and vice versa). Lazy so the dominant therapist cold-start doesn't
// pull in the patient portal it'll never render.
const PatientClaimScreen = lazy(() => import("./screens/patient/PatientClaimScreen").then(m => ({ default: m.PatientClaimScreen })));
const PatientClaimGate = lazy(() => import("./screens/patient/PatientClaimGate").then(m => ({ default: m.PatientClaimGate })));
const PatientApp = lazy(() => import("./screens/patient/PatientApp").then(m => ({ default: m.PatientApp })));
// AuthScreen is only mounted pre-login; after first login the import
// stays in the cache and contributes nothing further. Keeping it lazy
// shaves the unauth shell down as well.
const AuthScreen = lazy(() => import("./screens/AuthScreen").then(m => ({ default: m.AuthScreen })));
import { useRoleDetection } from "./hooks/useRoleDetection";
import { setInviteToken, getInviteToken } from "./utils/inviteTokenStorage";
// Admin dashboard is gated by isAdmin(user) and lives on its own
// `#admin/...` route family. Lazy so the chunk only ships when the
// admin (one user platform-wide) actually opens it.
const AdminLayout = lazy(() => import("./screens/admin/AdminLayout").then(m => ({ default: m.AdminLayout })));
// One-time onboarding steps — never re-visited by an established
// account, so lazy with no perceptible Suspense cost (the screens
// are simple and the gating logic above keeps them off the cold
// path for everyone except the user signing up right now).
const ProfessionOnboarding = lazy(() => import("./screens/ProfessionOnboarding").then(m => ({ default: m.ProfessionOnboarding })));
const SignupSourceStep = lazy(() => import("./screens/SignupSourceStep").then(m => ({ default: m.SignupSourceStep })));
import { useUserProfile } from "./hooks/useUserProfile";
import { useAccentTheme } from "./hooks/useAccentTheme";
import { DEFAULT_PROFESSION, SIGNUP_SOURCE_CUTOFF_ISO } from "./data/constants";
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

// AuthSplash is the single brand-loading surface for the entire boot
// sequence (Suspense fallbacks, auth/role gates, and the MFA gate). It
// lives in its own module so MfaChallengeGate can render the exact same
// splash instead of a bare "Cargando" line — see components/AuthSplash.

function CardiganApp() {
  const { user, loading: authLoading, signUp, signIn, signInWithMagicLink, signInWithPasskey, signOut, refreshUser, recoveryMode, inviteMode, setNewPassword } = useAuth();
  const [demoMode, setDemoMode] = useState(false);
  // When set, AuthScreen mounts directly into the signup sheet — used by the
  // demo banner's "Crear cuenta" button AND by the ?ref=<code> referral-link
  // capture below, so a visitor arriving from a friend's invite link skips
  // the landing page entirely.
  const [authIntent, setAuthIntent] = useState(() => {
    // Capture acquisition signals at initial render so they're in
    // place BEFORE the auth gate. Two channels:
    //   ?ref=<code>          — peer referral code (existing user invites
    //                          a friend). Existed before influencer codes.
    //   /c/<CODE>            — influencer / partner discount code. Parsed
    //                          from pathname directly because Vercel
    //                          rewrites preserve the SOURCE URL in the
    //                          browser (window.location.search stays
    //                          empty for the rewritten dest); the only
    //                          way client-side JS sees the code is to
    //                          read pathname. Also accepts ?ic=<code>
    //                          as a manual fallback for testing.
    // Both are stashed in sessionStorage so they survive the email-
    // verify roundtrip and useSubscription.startCheckout can pull them
    // when the user actually subscribes. URL is then cleaned via
    // replaceState so a refresh / screenshot doesn't leak.
    if (typeof window === "undefined") return null;
    try {
      const params = new URLSearchParams(window.location.search);
      let captured = false;
      let pathRewrite = null;

      const ref = params.get("ref");
      if (ref) {
        const sanitized = ref.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
        if (sanitized) {
          try { sessionStorage.setItem("cardigan.referralFromUrl", sanitized); }
          catch { /* private mode — fine, URL gets stripped anyway */ }
          captured = true;
        }
        params.delete("ref");
      }

      // Influencer code via /c/CODE pathname OR ?ic=CODE query.
      // Accept both for robustness (deep-links shared as the canonical
      // /c/ path; manual debugging via ?ic= still works).
      const matchPath = window.location.pathname.match(/^\/c\/([A-Za-z0-9]+)\/?$/);
      const rawIc = matchPath ? matchPath[1] : params.get("ic");
      if (rawIc) {
        const sanitized = rawIc.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
        // Min length matches the influencer_codes.code check constraint
        // (4-20 chars). A 3-char prefix that incidentally matches /c/
        // shouldn't try to apply.
        if (sanitized && sanitized.length >= 4) {
          try { sessionStorage.setItem("cardigan.influencerCodeFromUrl", sanitized); }
          catch { /* ignore */ }
          captured = true;
        }
        if (matchPath) pathRewrite = "/";
        params.delete("ic");
      }

      // Patient invite link via /i/<token> pathname. Vercel rewrites
      // /i/:token → /index.html (vercel.json), preserving the source
      // URL. Pull the token out, stash it (localStorage, not session
      // — see inviteTokenStorage.js for why: the email-verification
      // round-trip opens a NEW tab, and sessionStorage is per-tab),
      // and route the URL back to / so a refresh / screenshot doesn't
      // leak the credential.
      // Unlike the other capture paths, an invite link does NOT seed
      // authIntent — the patient should land on the claim screen
      // (with the therapist's name + a friendly intro) BEFORE
      // choosing signup vs. sign-in. Pre-seeding authIntent="signup"
      // would short-circuit the claim screen and drop them straight
      // on AuthScreen, which is exactly what the prior "click the
      // link → land on the marketing page" bug looked like.
      let inviteCaptured = false;
      const inviteMatch = window.location.pathname.match(/^\/i\/([A-Za-z0-9_-]+)\/?$/);
      if (inviteMatch) {
        const inviteToken = inviteMatch[1];
        if (inviteToken) {
          setInviteToken(inviteToken);
          inviteCaptured = true;
          captured = true;
          pathRewrite = "/";
        }
      }

      if (!captured) return null;
      const newUrl = (pathRewrite || window.location.pathname)
        + (params.toString() ? `?${params.toString()}` : "")
        + window.location.hash;
      window.history.replaceState({}, "", newUrl);
      // Auto-jump to signup ONLY for the marketing-funnel captures
      // (referral / influencer code). For invite captures, return
      // null so the claim screen renders first.
      return inviteCaptured ? null : "signup";
    } catch { return null; }
  });
  // MFA gate state — `mfaResolved` flips true once MfaChallengeGate
  // determines no challenge is needed OR a challenge succeeds. Reset
  // whenever the user changes (sign-out / sign-in) so we re-check.
  const [mfaResolved, setMfaResolved] = useState(false);
  // Bumps every time a patient-invite claim succeeds. Forces the
  // role-detection hook to re-fire so the freshly-linked patient
  // gets routed into PatientApp without a manual reload.
  const [roleVersion, setRoleVersion] = useState(0);
  // Tracks whether a patient-invite token is in storage. Re-read on
  // every render — localStorage access is a synchronous global, so
  // this is effectively free, and PatientClaimGate clears it after
  // success / failure. getInviteToken() also evicts entries past
  // the 30-day TTL on the way out.
  const inviteToken = getInviteToken();
  const role = useRoleDetection(user, roleVersion);
  const theme = useTheme();
  // Reset the gate when the user identity changes (sign-out → sign-in,
  // or a different account). Synchronous setState in this effect is
  // intentional — we MUST gate the next render before any of AppShell's
  // data fetches kick off. Same pattern as useUserProfile's userId reset.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMfaResolved(false); }, [user?.id]);

  if (authLoading && !demoMode) {
    return <AuthSplash />;
  }

  if (demoMode) {
    // Patient-portal demo escape hatch: vite --mode e2e + ?demoRole=patient
    // routes into the patient surface with fixture data instead of the
    // therapist AppShell. Used by the e2e patient-portal smoke test.
    // Production demo users (no MODE=e2e) never hit this branch —
    // import.meta.env.MODE is statically replaced by Vite at build time
    // so the predicate folds to false outside the test build.
    const demoPatientRole = import.meta.env.MODE === "e2e"
      && typeof window !== "undefined"
      && new URLSearchParams(window.location.search).get("demoRole") === "patient";
    if (demoPatientRole) {
      const fakeUser = { id: "demo-patient-user", email: "demo@cardigan.mx", user_metadata: {} };
      return (
        <Suspense fallback={<AuthSplash />}>
          <PatientApp user={fakeUser} signOut={() => setDemoMode(false)} demo />
        </Suspense>
      );
    }
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
    // Patient-invite landing — unauthenticated user clicked the
    // /i/<token> URL. Show the welcome card with the therapist's
    // name + profession and route to AuthScreen on CTA tap. The
    // token persists in sessionStorage through the auth round-trip
    // so PatientClaimGate can fire the claim once they're signed in.
    //
    // The !authIntent guard matters: tapping "Crear cuenta" /
    // "Ya tengo cuenta" calls setAuthIntent(...) to advance to
    // AuthScreen below. Without the guard, we'd stay parked on
    // PatientClaimScreen forever (the inviteToken remains in
    // sessionStorage by design — it's needed for the post-auth
    // claim) and the buttons would appear to do nothing.
    // PatientClaimScreen + AuthScreen are lazy — wrap in Suspense
    // so the lazy fetch doesn't unmount the unauth shell. Fallback
    // is the same splash the role-loading gate below renders, so
    // the user sees uninterrupted brand chrome while the chunk loads.
    if (inviteToken && !authIntent) {
      return (
        <Suspense fallback={<AuthSplash />}>
          <PatientClaimScreen
            token={inviteToken}
            onCreateAccount={() => setAuthIntent("signup")}
            onSignIn={() => setAuthIntent("login")}
          />
        </Suspense>
      );
    }
    return (
      <Suspense fallback={<AuthSplash />}>
        <AuthScreen onSignIn={signIn} onSignUp={signUp} onMagicLink={signInWithMagicLink} onPasskey={signInWithPasskey} onDemo={() => { setAuthIntent(null); setDemoMode(true); }} autoOpen={authIntent} />
      </Suspense>
    );
  }

  // Block the main shell behind the MFA gate. Self-resolves to no-op
  // when the user has no MFA factor enrolled — see MfaChallengeGate.
  if (!mfaResolved) {
    return <MfaChallengeGate onResolved={() => setMfaResolved(true)} onSignOut={signOut} />;
  }

  // Authenticated user just came back from clicking an invite link.
  // Fire the claim, show a brief "Vinculando…" spinner, then bump
  // the role version so role-detection re-runs and routes them
  // into PatientApp.
  if (inviteToken) {
    return (
      <Suspense fallback={<AuthSplash />}>
        <PatientClaimGate
          token={inviteToken}
          user={user}
          onComplete={() => setRoleVersion(v => v + 1)}
          onSignOut={signOut}
        />
      </Suspense>
    );
  }

  // Role detection: which shell does this user belong in? Loading
  // state is brief (one parallel pair of queries); reusing the
  // splash visual the auth gate above also uses.
  if (role.role === "loading") {
    return <AuthSplash />;
  }

  // Patient shell — completely separate surface from the therapist
  // app. Mounts its own data hook, its own (minimal) context.
  if (role.role === "patient") {
    return (
      <Suspense fallback={<AuthSplash />}>
        <PatientApp user={user} signOut={signOut} />
      </Suspense>
    );
  }

  // Orphan — signed in but no profession + no linked patient row.
  // Brand-new account where profession-onboarding hasn't completed
  // yet falls through to the existing AppShell flow which surfaces
  // the onboarding sheet. (The therapist app handles its own
  // first-run profession picker.) For genuine orphans (deleted
  // therapist account, etc) the AppShell shows the existing empty
  // state. Future iteration could surface a "you've been signed
  // out by your therapist" message; v1 reuses what's there.
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
   not yet specialised (Settings, admin dashboard, etc.). */
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
          {/* Tablet/desktop: Hoy + Mañana stacked section cards */}
          <div className="home-schedule-desktop">
            {Array.from({ length: 2 }).map((_, p) => (
              <div key={p} className="section">
                <div className="section-header">
                  <div className="section-headline">
                    <div className="sk-bar sk-bar-sm" style={{ width:80, marginBottom:5 }} />
                    <div className="sk-bar sk-bar-xs" style={{ width:64 }} />
                  </div>
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
            <div key={s} className="section">
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
  // Idle-prefetch the lazy interactive chunks once the shell renders.
  // requestIdleCallback (Chromium/FF) runs after first paint when the
  // main thread is idle; Safari falls back to a 1.5s setTimeout. By
  // the time a therapist taps the hamburger / FAB / command palette
  // these chunks are warm in the browser cache and Suspense resolves
  // instantly — the "fallback={null}" beat we'd otherwise see on cold
  // load disappears.
  useEffect(() => {
    const prefetch = () => {
      drawerImport(); commandPaletteImport();
      paymentModalImport(); expenseSheetImport();
    };
    const ric = typeof window !== "undefined" && window.requestIdleCallback;
    if (ric) {
      const id = ric(prefetch, { timeout: 3000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const id = setTimeout(prefetch, 1500);
    return () => clearTimeout(id);
  }, []);
  const { isTablet } = useViewport();
  const [viewAsUserId, setViewAsUserId] = useState(null);
  // Where the admin came from when they entered "view as user" mode.
  // Captured as the full hash so the exit path can drop them BACK on
  // the exact admin page (Usuarios, the user's detail tab, etc.) they
  // launched from — instead of the previous behavior that always
  // dumped them on Home regardless of origin.
  const viewAsOriginHashRef = useRef(null);
  // `localHideFab` is controlled by non-tutorial callers (e.g. the Patients
  // expediente drawer). The tutorial contributes its own reason to hide
  // the FAB, derived synchronously from `tutorial` state below — that way
  // when the tutorial ends there's no single-frame lag where the tutorial
  // overlay is gone but BottomTabs haven't mounted back yet (which used
  // to show as dark bands on the safe areas in dark mode).
  const [localHideFab, setHideFab] = useState(false);
  // Lets a screen hide the bottom-tab pill (e.g. Agenda bulk-select mode,
  // which puts its own action bar at the bottom). Reset by the screen on exit.
  const [localHideBottomTabs, setHideBottomTabs] = useState(false);
  // Groups feature toggle (Settings → Funciones). Per-user, persisted in
  // localStorage. Default ON. When OFF the entire Groups surface is hidden
  // and the app behaves exactly as it did pre-Groups. Users can only turn it
  // OFF when they have zero groups (enforced in Settings).
  const [groupsEnabled, setGroupsEnabledState] = useState(true);
  useEffect(() => {
    if (!user?.id) { setGroupsEnabledState(true); return; }
    try {
      const v = localStorage.getItem(`cardigan.groupsEnabled.${user.id}`);
      setGroupsEnabledState(v === null ? true : v !== "false");
    } catch { setGroupsEnabledState(true); }
  }, [user?.id]);
  const setGroupsEnabled = useCallback((val) => {
    setGroupsEnabledState(val);
    try { if (user?.id) localStorage.setItem(`cardigan.groupsEnabled.${user.id}`, String(val)); } catch { /* private mode */ }
  }, [user?.id]);
  const [bugReportOpen, setBugReportOpen] = useState(false);
  // Activation-complete share sheet — opens when ActivationChecklist
  // crosses 0→all-done. Reuses the user's referral code so the user
  // can share with a colleague at the moment they feel best about
  // having finished setup.
  const [activationShareOpen, setActivationShareOpen] = useState(false);
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
  // Web Share Target receiver state. When the user shares a folder
  // URL into Cardigan from the OS share sheet, the browser routes
  // to /?share_folder=1&url=…&text=…&title=… — we capture the URL
  // here and open the ShareFolderSheet patient picker.
  const [shareFolderUrl, setShareFolderUrl] = useState(null);
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
    loading, mutationError, clearMutationError, fetchError,
    updateSessionStatus,
    inboxUnread = 0,
    refresh,
  } = data;
  // Compose read-only: native data-layer flag (admin "view as user")
  // OR trial-expired gate. Both block writes and hide the FAB; the UI
  // distinguishes them via banner copy.
  // Escape hatch for the Playwright smoke test (e2e/notes-editor.spec.js):
  // demo mode is read-only AND null-user subscription resolves to
  // "expired", both of which would normally disable typing in the
  // editor. ?testMode=1 unlocks both — only honored in `vite --mode
  // e2e` builds, never in production, so end users can never trigger
  // it. Falls back to the normal compose otherwise.
  const testModeUnlocked = import.meta.env.MODE === "e2e"
    && typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("testMode") === "1";
  const readOnly = testModeUnlocked
    ? false
    : (data.readOnly || subscription.accessExpired);
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
        // Forward `duration` so callers (e.g. withUndoableDelete's 3-second
        // window) can override the 1.4s default. Previously dropped here,
        // which silently made the "Deshacer" toast disappear at 1.4s
        // while the commit timer still ran out to 5s — leaving ~3.6s of
        // ghost-undo state where the row was gone, no toast visible, no
        // way to recover. ToastStack forwards the value through to <Toast>.
        duration: opts.duration,
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

  // Native foreground push: the OS doesn't display the system tray
  // banner when the app is in the foreground (Android suppresses it,
  // iOS requires explicit opt-in via UNUserNotificationCenter delegate).
  // src/lib/nativePush.js relays the FCM payload via a CustomEvent
  // so we can surface it in-app via the existing Toast queue, keeping
  // the foreground reminder reachable without leaving the running app.
  useEffect(() => {
    const handler = (e) => {
      const detail = e?.detail || {};
      const body = detail.body || detail.title || "Recordatorio";
      showToast(body, "info");
    };
    window.addEventListener("cardigan-native-push-received", handler);
    return () => window.removeEventListener("cardigan-native-push-received", handler);
  }, [showToast]);
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
  // Surface a FAILED initial data load (e.g. launched in airplane mode,
  // or the network dropped during the parallel fetch). Without this the
  // app paints empty "no data yet" states with no hint that the load
  // failed and no way to retry — which reads as a broken app (and App
  // Store reviewers test offline launches). Mirrors the mutationError
  // toast: persistent, retry-able, de-duped by key. fetchError resets to
  // "" at the start of each fetch, so a successful refresh clears it.
  useEffect(() => {
    if (fetchError) {
      showToast(t("loadFailed"), "error", {
        persistent: true,
        onRetry: refresh,
        key: "fetch-error",
      });
    } else {
      setToasts(prev => prev.some(entry => entry.key === "fetch-error")
        ? prev.filter(entry => entry.key !== "fetch-error")
        : prev);
    }
  }, [fetchError, showToast, refresh, t]);
  // Online/offline state — useConnectivity is the canonical hook now
  // (also consumed by OfflineBanner). Kept in the App-level context
  // for any consumer that branches on it (e.g. action gating).
  const { online } = useConnectivity();
  const pendingAgendaViewRef = useRef(null);
  const pendingExpedienteRef = useRef(null);
  // Pending note open — set by CommandPalette when a user picks a note
  // from the search results, consumed by Notes screen on mount. Mirrors
  // the pendingExpedienteRef pattern so the palette doesn't need to
  // reach into per-screen state setters.
  const pendingNoteOpenRef = useRef(null);

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

  // ── PWA Web Share Target receiver ──
  // The manifest registers /?share_folder=1 as the action for shared
  // folder URLs. iOS / Android route the OS share sheet here when
  // the user picks Cardigan from a Drive/OneDrive/etc folder share.
  // Different platforms bundle the shared content into different
  // params (Android: url; iOS: text/title; macOS: title+url) — we
  // pull whichever is present and open the picker.
  //
  // The handler is wrapped in a callable so it can also fire on
  // popstate / focus / pageshow events. Without that, a SECOND
  // share-target invocation while the SPA is already running
  // (browser changes the URL but doesn't remount React) wouldn't
  // re-trigger the sheet.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleShareIntent = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("share_folder") !== "1") return;
      const candidate = params.get("url")
        || params.get("text")
        || params.get("title")
        || "";
      // Strip the share_folder bookkeeping from the URL FIRST,
      // unconditionally. Demo / read-only / unauthenticated users
      // should never have stale share params clinging to the URL —
      // a later toggle of those flags would re-fire on a clean
      // mount and surprise the user.
      params.delete("share_folder");
      params.delete("url");
      params.delete("text");
      params.delete("title");
      const newUrl = window.location.pathname
        + (params.toString() ? `?${params.toString()}` : "")
        + window.location.hash;
      window.history.replaceState({}, "", newUrl);
      // Now decide what to do with the candidate:
      //   - demo / read-only: a friendly toast; can't link in those
      //     states, but the user deserves an explanation.
      //   - not signed in: nothing to do; the auth flow takes over
      //     and the share intent is dropped (rare — the OS share
      //     sheet only routes to Cardigan for authenticated users
      //     who installed the PWA).
      //   - empty candidate (rare; user shared a non-URL like a
      //     plain note via the OS share sheet): friendly toast.
      //   - everything else: open the picker.
      if (!user) return;
      if (demo || readOnly) {
        showToast(t("expediente.folder.shareUnavailable"), "info");
        return;
      }
      if (!candidate.trim()) {
        showToast(t("expediente.folder.shareEmpty"), "warning");
        return;
      }
      setShareFolderUrl(candidate);
    };

    // Run on mount.
    handleShareIntent();
    // Re-run when the URL changes within the same SPA instance
    // (Android Chrome reuses the running tab on a second share).
    window.addEventListener("popstate", handleShareIntent);
    // pageshow fires when the PWA is foregrounded (incl. cold
    // restart on iOS) — covers the case where iOS suspends the
    // app and a new share lands while it was backgrounded.
    window.addEventListener("pageshow", handleShareIntent);
    return () => {
      window.removeEventListener("popstate", handleShareIntent);
      window.removeEventListener("pageshow", handleShareIntent);
    };
  // demo / readOnly / user can change at runtime; re-bind the
  // listener so the latest values are captured in the closure.
  // showToast / t are stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, demo, readOnly]);

  // ── Referral-code URL handler (?ref=<CODE>) ──
  // The capture happens earlier in CardiganApp (before the auth
  // gate) so visitors arriving from a referral link land directly
  // on the signup sheet. By the time AppShell renders, the URL has
  // already been stripped and the code is in sessionStorage —
  // Settings → plan reads from there at checkout time. No further
  // work needed at this layer.

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

  const tutorial = useTutorial({ user, demo, readOnly, screen });
  // The carousel is a full-screen overlay with its own scrim, so the FAB
  // just hides while the tutorial (welcome gate or carousel) is up.
  const tutorialHidesFab = tutorial?.isActive || tutorial?.isWelcome;
  // Admin owns its own chrome (sidebar + header) and covers the
  // topbar / FAB / BottomTabs via the fixed `.admin-shell` overlay.
  // Privacy hides the FAB because the page is text-only and a
  // floating "create" action over a legal document is jarring.
  // Settings keeps the FAB — quick access to creating a patient /
  // session / payment from any screen is more convenient than the
  // theoretical noise of a floating button on a preferences page,
  // and the absence used to read as "this screen is broken" rather
  // than as a deliberate UX call. The BottomTabs MUST stay visible
  // on those screens, otherwise the user has no way to navigate
  // away. Two flags, distinct concerns. The CSS-level body:has(...)
  // rules in base.css handle the "any sheet / drawer is open" case
  // for both at once.
  //
  // Tutorial: the carousel overlay covers the whole viewport, so the FAB
  // is hidden while it (or its welcome gate) is open.
  const hideFab = localHideFab
    || tutorialHidesFab
    || screen === "admin"
    || screen === "privacy";
  const hideBottomTabs = screen === "admin" || localHideBottomTabs;
  const notifications = useNotifications(demo ? null : user);

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
  useEffect(() => {
    if (demo || viewAsUserId) return;
    if (!user?.id) return;
    if (subscription.accessState !== "trial") return;
    if (tutorial?.state === "running") return;
    let stored = null;
    try { stored = localStorage.getItem(`cardigan.welcomePro.shown.v1.${user.id}`); }
    catch { /* private mode — fall through and show; worst case it shows twice */ }
    if (stored) return;
    const delay = tutorial?.state === "done" ? 600 : 10000;
    const id = setTimeout(() => setWelcomeProOpen(true), delay);
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

  // ── Cardi (in-app navigation chatbot) ──
  // Lives as a sheet, not a screen — the drawer routes the "cardi"
  // nav id through `handleDrawerNav` below, which gates on isPro and
  // either opens the sheet or bumps the user to ProUpgradeSheet.
  const [cardiOpen, setCardiOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const handleDrawerNav = useCallback((id) => {
    if (id === "cardi") {
      if (!subscription.isPro) {
        requirePro("cardi");
        return;
      }
      setCardiOpen(true);
      return;
    }
    setScreen(id);
  }, [subscription.isPro, requirePro, setScreen]);

  // ── Trial reminder prompt (15 / 10 / 5 / 3 / 2 / 1 days left) ──
  // Fires at most once per (user, day) combination so the user isn't
  // pestered if they reload mid-day, and doesn't fire at all once
  // they've subscribed or been comp'd. Dedupe key encodes the YYYY-MM-DD
  // local date — a fresh login the next morning re-evaluates.
  const [trialReminderOpen, setTrialReminderOpen] = useState(false);
  const [trialReminderDays, setTrialReminderDays] = useState(null);
  const [trialReminderPaymentOpen, setTrialReminderPaymentOpen] = useState(false);

  // ── Post-login passkey enrollment nudge ──
  // Offered once per user, only when passkeys are available (web + flag
  // on; never native), and only if they don't already have one. The
  // dismissal/enrolled flag is per-user localStorage so it never nags a
  // second time. Deferred ~1.6s so it doesn't collide with first paint
  // or stack on top of the trial reminder during that frame.
  const [passkeyPromptOpen, setPasskeyPromptOpen] = useState(false);
  const [passkeyCreating, setPasskeyCreating] = useState(false);
  const passkeyPromptKey = user?.id ? `cardigan.passkeyPrompt.done.${user.id}` : null;
  useEffect(() => {
    if (demo || viewAsUserId) return;
    if (!user?.id) return;
    if (!passkeysAvailable()) return;
    let done = false;
    try { done = localStorage.getItem(passkeyPromptKey) === "1"; } catch { /* private mode */ }
    if (done) return;
    let cancelled = false;
    let timer = null;
    (async () => {
      try {
        const { data, error } = await supabase.auth.passkey.list();
        if (cancelled || error) return;
        const list = Array.isArray(data) ? data : (data?.passkeys || []);
        if (list.length > 0) {
          // Already has a passkey — never prompt again.
          try { localStorage.setItem(passkeyPromptKey, "1"); } catch { /* private mode */ }
          return;
        }
        timer = setTimeout(() => { if (!cancelled) setPasskeyPromptOpen(true); }, 1600);
      } catch { /* beta API hiccup — just skip the nudge */ }
    })();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [user?.id, demo, viewAsUserId, passkeyPromptKey]);

  const dismissPasskeyPrompt = useCallback(() => {
    setPasskeyPromptOpen(false);
    try { if (passkeyPromptKey) localStorage.setItem(passkeyPromptKey, "1"); } catch { /* private mode */ }
  }, [passkeyPromptKey]);

  const createPasskeyFromPrompt = useCallback(async () => {
    if (passkeyCreating) return;
    setPasskeyCreating(true);
    try {
      const { error } = await supabase.auth.registerPasskey();
      if (!error) {
        showSuccess(t("settings.passkeyPromptDone"));
        setPasskeyPromptOpen(false);
        try { if (passkeyPromptKey) localStorage.setItem(passkeyPromptKey, "1"); } catch { /* private mode */ }
      } else if (!/NotAllowed|AbortError|cancel/i.test(error.name || error.message || "")) {
        // Real failure (not a user cancel) — surface a toast but keep the
        // prompt open so they can retry.
        showToast(t("settings.passkeyAddError"), "error");
      }
    } catch (e) {
      if (!/NotAllowed|AbortError|cancel/i.test(e?.name || e?.message || "")) {
        showToast(t("settings.passkeyAddError"), "error");
      }
    } finally {
      setPasskeyCreating(false);
    }
  }, [passkeyCreating, passkeyPromptKey, showSuccess, showToast, t]);
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

  // Expense sheet — mirrors the payment-modal pattern so any screen
  // (FAB, GastosTab list, ResumenTab CTA) can open record-mode or
  // edit-mode through context.
  const [expenseSheetOpen, setExpenseSheetOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const openRecordExpenseModal = useCallback(() => {
    if (readOnly) return;
    setEditingExpense(null);
    setExpenseSheetOpen(true);
  }, [readOnly]);
  const openEditExpenseModal = useCallback((expense) => {
    if (readOnly) return;
    setEditingExpense(expense);
    setExpenseSheetOpen(true);
  }, [readOnly]);
  const [recurringExpenseSheetOpen, setRecurringExpenseSheetOpen] = useState(false);
  const openRecurringExpenseSheet = useCallback(() => {
    if (readOnly) return;
    setRecurringExpenseSheetOpen(true);
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

  // Native admin redirect — if the user lands on #admin from a stale
  // deep link, the URL bar (web only), or a sticky bookmark, send
  // them straight back to home. The admin chunk wouldn't render
  // anyway (the SCREEN_MAP entry returns null on native), so this
  // prevents the user from sitting on a blank screen.
  useEffect(() => {
    if (screen === "admin" && isNative()) {
      navigate("home");
    }
  }, [screen, navigate]);

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
      // DRAWER_EDGE_BAND is shared with useSwipe's IN_SCREEN_SWIPE_DEAD_ZONE
      // so the two gesture owners never race at start.
      const inEdgeBand = e.touches[0].clientX < DRAWER_EDGE_BAND;
      if (drawerOpenRef.current) {
        // Drawer is already open. We must NOT kick off a second open
        // animation — but we DO need to claim left-edge horizontal
        // touches so iOS Safari's native "edge-swipe-back" peel-the-
        // previous-page gesture doesn't fire under the drawer panel.
        // Without this, swiping right from the left edge while the
        // drawer is open shows the previous browser-history page
        // peeking out behind the drawer (the "weird thing" reported).
        if (inEdgeBand) {
          edgeRef.current = {
            startX: e.touches[0].clientX,
            startY: e.touches[0].clientY,
            time: Date.now(),
            active: false,
            suppressOnly: true, // block iOS gesture, no app-side animation
          };
        } else {
          edgeRef.current = null;
        }
        return;
      }
      if (inEdgeBand) {
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
      if (!edgeRef.current) return;
      const dx = e.touches[0].clientX - edgeRef.current.startX;
      const dy = e.touches[0].clientY - edgeRef.current.startY;
      // suppressOnly path (drawer already open): block iOS's native
      // edge-swipe-back as soon as motion is clearly horizontal, but
      // never claim the swipe coordinator and never update drawer
      // state — the drawer is already open; there's nothing to do.
      if (edgeRef.current.suppressOnly) {
        if (Math.abs(dx) > 4 && Math.abs(dx) > Math.abs(dy)) {
          if (e.cancelable) e.preventDefault();
        } else if (Math.abs(dy) > 10) {
          // Vertical scroll — release the gesture so the drawer
          // panel's own scroll handler can take over.
          edgeRef.current = null;
        }
        return;
      }
      if (drawerOpenRef.current) return;
      // Suppress iOS Safari's native edge-swipe-back AS EARLY AS
      // possible. iOS makes its mind up about back-peek within the
      // first ~5px of horizontal motion — calling preventDefault
      // only AFTER our 10px engagement threshold lets iOS paint the
      // previous-history page during the gap (the "swipe opened a
      // brief flash of the previous screen" glitch). As soon as
      // we see clearly-horizontal motion, claim the gesture by
      // preventDefault'ing every move; the 10px threshold below
      // still gates whether we engage the drawer animation.
      if (!edgeRef.current.active && Math.abs(dx) > 4 && Math.abs(dx) > Math.abs(dy)) {
        if (e.cancelable) e.preventDefault();
      }
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
        // Continue suppressing back-peek through the rest of the drag.
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

  // ── PWA / native app shortcuts receiver ──
  // The web app manifest's `shortcuts` array (public/manifest.json)
  // and the Android AndroidManifest.xml's <shortcut> entries both
  // launch the app at /?fab=patient|session|payment (or /?screen=…
  // for nav-only shortcuts). This effect drains those params on
  // mount, fires the matching action, and strips them from the URL
  // so a refresh / screenshot doesn't replay the shortcut.
  //
  // Sits after pendingFabAction's useState because it calls the
  // setter directly. Read-only / demo / unauth users have the params
  // stripped but the action no-ops downstream (requestFabAction /
  // setScreen are safe-by-default in those modes). Stripping happens
  // unconditionally so a later state flip doesn't surprise the user
  // with a stale intent.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fab = params.get("fab");
    const target = params.get("screen");
    if (!fab && !target) return;
    params.delete("fab");
    params.delete("screen");
    const newUrl = window.location.pathname
      + (params.toString() ? `?${params.toString()}` : "")
      + window.location.hash;
    window.history.replaceState({}, "", newUrl);
    if (target && typeof target === "string") {
      // For the "Hoy" shortcut (target=agenda), nudge the agenda's
      // pending view ref to "day" so the user lands on the day strip
      // showing today's sessions even if their last visit left them
      // in week/month view. Agenda's consumeAgendaView() drains it
      // on mount.
      if (target === "agenda") pendingAgendaViewRef.current = "day";
      setScreen(target);
    }
    if (fab && typeof fab === "string") {
      // requestFabAction is the same coordinator the FAB itself uses;
      // QuickActions watches pendingFabAction and opens the matching
      // sheet (patient, session, payment, note, document). Routing
      // through it instead of opening a sheet directly keeps the
      // entry-point logic in one place and respects the existing
      // pro-gate / readOnly checks downstream.
      setPendingFabAction(fab);
    }
  // First mount only — the URL params are drained immediately and a
  // navigation away rewrites window.location, so re-running would
  // either find an empty URL (no-op) or re-fire a stale intent. The
  // share-target effect above uses the same pattern.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // (withSuccess wrapper removed — the one remaining caller
  // [deleteRecurringTemplate] no longer needs a success toast. The
  // list row disappears as confirmation, which is enough.)
  // Undo-aware delete wrapper. Takes a `softFn` that returns
  // { commit, undo } (defined per-domain in useSessions /
  // usePayments / useExpenses / useNotes) and orchestrates:
  //   1. Optimistic state change happens immediately inside softFn.
  //   2. A "X eliminado · Deshacer" toast shows for UNDO_MS.
  //   3. If the user taps "Deshacer" within the window → undo() runs
  //      and the row reappears in place. No network call.
  //   4. Otherwise the timer fires → commit() runs the server-side
  //      delete (or enqueues offline).
  //   5. If the tab is backgrounded mid-window, commit() runs eagerly
  //      via the visibilitychange handler — closing the tab would
  //      kill the setTimeout and silently leave the row in the DB.
  // Returns true so callers using `await delete(id)` see the same
  // success contract as before.
  const UNDO_MS = 3000;
  const withUndoableDelete = useCallback((softFn, label) => async (...args) => {
    if (typeof softFn !== "function") return false;
    const handle = softFn(...args);
    if (!handle || typeof handle.commit !== "function") return false;

    let done = false;
    let timer;
    const onHidden = () => { if (document.visibilityState === "hidden") finalize(); };
    const cleanup = () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onHidden);
    };
    const finalize = () => {
      if (done) return;
      done = true;
      cleanup();
      handle.commit();
    };
    const restore = () => {
      if (done) return;
      done = true;
      cleanup();
      handle.undo();
    };

    timer = setTimeout(finalize, UNDO_MS);
    document.addEventListener("visibilitychange", onHidden);
    haptic.tap();
    showToast(label, "info", {
      actionLabel: "Deshacer",
      onRetry: restore,
      duration: UNDO_MS,
    });
    return true;
  }, [showToast]);
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
    // The four everyday destructive actions go through the undoable
    // wrapper: optimistic remove + "Deshacer" toast + 3s commit
    // window. Recurring-template delete stays straight-through \u2014
    // it's an admin-rare action and undoable wouldn't add much.
    deleteSession: withUndoableDelete(data.softDeleteSession, "Sesi\u00f3n eliminada"),
    deletePayment: withUndoableDelete(data.softDeletePayment, "Pago eliminado"),
    deleteExpense: withUndoableDelete(data.softDeleteExpense, "Gasto eliminado"),
    deleteRecurringTemplate: data.deleteRecurringTemplate,
    deleteNote: withUndoableDelete(data.softDeleteNote, "Nota eliminada"),
    noteCrypto,
    profession,
    accentTheme,
    setProfessionLocal: userProfile.setProfessionLocal,
    groupsEnabled, setGroupsEnabled,
    user, userName, userInitial, openRecordPaymentModal, openEditPaymentModal, openRecordExpenseModal, openEditExpenseModal, openRecurringExpenseSheet, setHideFab, setHideBottomTabs, setScreen,
    isAdminUser: admin, // surfaced to CommandPalette for admin-only commands
    navigate, pushLayer, popLayer, removeLayer, online,
    screen, drawerOpen, setDrawerOpen, tutorial, theme, notifications, showSuccess, showToast,
    pendingFabAction,
    requestFabAction: setPendingFabAction,
    consumeFabAction: () => setPendingFabAction(null),
    openActivationShareSheet: () => setActivationShareOpen(true),
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
    openNoteById: (id) => {
      // Navigate to Archivo (which routes to Notes tab by default) and
      // stash the id; Notes screen reads it on mount and opens the
      // editor with the matching note. Same pendingRef pattern as
      // openExpediente / setAgendaView.
      pendingNoteOpenRef.current = id;
      setScreen("archivo");
    },
    consumePendingNoteOpen: () => {
      const v = pendingNoteOpenRef.current;
      pendingNoteOpenRef.current = null;
      return v;
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
      const newStatus = overrideStatus || "completed";
      const ok = await updateSessionStatus(s.id, newStatus);
      if (!ok) return ok;
      // The prompt is specifically a "you just FINISHED a visit"
      // affordance — fire only when the new status lands at
      // 'completed'. Toggling a row back to 'scheduled' (rare but
      // possible from the same handler) shouldn't surface a
      // "completed" toast.
      if (newStatus !== "completed") return ok;
      const patient = patients.find((p) => p.id === s.patient_id);
      if (!patient || !isEpisodic(patient)) return ok;
      // "Has a future visit already" check: any row with status=
      // 'scheduled' dated today-or-later that isn't the one we just
      // marked complete. Specifically NOT the broader "anything not
      // cancelled/charged" — a future row that's somehow already
      // 'completed' (early-marked) shouldn't suppress the prompt; the
      // user just wrapped a visit and likely wants to schedule the
      // next one regardless.
      const todayIso = todayISOFn();
      const hasFuture = (upcomingSessions || []).some((row) => {
        if (row.patient_id !== patient.id) return false;
        if (row.id === s.id) return false;
        if (row.status !== "scheduled") return false;
        const iso = shortDateToISO(row.date);
        return iso >= todayIso;
      });
      if (hasFuture) return ok;
      // Fire the prompt toast. Reuses the toast queue's onRetry slot;
      // the new actionLabel prop (added in this round) carries the
      // localized "Programar próxima" label so this isn't mistaken
      // for an error retry.
      // Toast carries the patient's first name so a user marking
      // two consecutive consults complete (e.g. on the Agenda screen)
      // sees which one the [Programar próxima] button refers to.
      // First name only — the toast is narrow on phones and the full
      // "Apellido Apellido" tail crowds the action button.
      const firstName = (patient.name || "").split(" ")[0];
      showToast(
        firstName
          ? `${firstName} · ${t("scheduling.endOfVisitPrompt")}`
          : t("scheduling.endOfVisitPrompt"),
        "success",
        {
          actionLabel: t("scheduling.scheduleNext"),
          onRetry: () => openQuickSchedule(patient),
          // De-dup per patient — repeatedly toggling status (or
          // quickly marking two consecutive consults complete)
          // shouldn't stack multiple "Programar próxima" toasts.
          // The latest one wins.
          key: `end-of-visit:${patient.id}`,
        },
      );
      return ok;
    },
  }), [admin, data, noteCrypto, profession, accentTheme, userProfile.setProfessionLocal, user, userName, userInitial, readOnly, subscription, requirePro, updateSessionStatus, patients, upcomingSessions, openQuickSchedule, t, navigate, setScreen, openRecordPaymentModal, openEditPaymentModal, openRecordExpenseModal, openEditExpenseModal, openRecurringExpenseSheet, pushLayer, popLayer, removeLayer, screen, drawerOpen, setDrawerOpen, tutorial, theme, notifications, showSuccess, showToast, online, pendingFabAction, withUndoableDelete, groupsEnabled, setGroupsEnabled]);

  // First-time user gate: a 2-step onboarding wizard before mounting
  // the main shell. Demo mode and admin "view as user" mode bypass —
  // the former never has a user, the latter is read-only and the
  // target user already has a profile. The brief loading window
  // falls through to the main shell (with DEFAULT_PROFESSION);
  // existing users have a backfilled row so they see no flash.
  //
  // Step 1 (ProfessionOnboarding): shown when profession is null.
  //   Triggered for any user with no row yet OR with a row missing
  //   profession. Persists profession on submit.
  //
  // Step 2 (SignupSourceStep): shown when profession is set but
  //   signup_source_recorded_at is null AND the user signed up at
  //   or after SIGNUP_SOURCE_CUTOFF_ISO. Cutoff exists so existing
  //   users (created before this feature shipped) aren't backfill-
  //   prompted with a question they can only answer poorly from
  //   memory. Persists source on submit.
  const eligibleForSourcePrompt = (() => {
    if (!user?.created_at) return false;
    const createdAt = new Date(user.created_at).getTime();
    const cutoff = new Date(SIGNUP_SOURCE_CUTOFF_ISO).getTime();
    return createdAt >= cutoff;
  })();
  if (
    !demo
    && !viewAsUserId
    && user
    && !userProfile.loading
    && userProfile.profession === null
  ) {
    return (
      <Suspense fallback={<AuthSplash />}>
        <ProfessionOnboarding
          onSelect={(p) => userProfile.createProfile(p)}
          onSignOut={signOut}
        />
      </Suspense>
    );
  }
  if (
    !demo
    && !viewAsUserId
    && user
    && !userProfile.loading
    && userProfile.profession !== null
    && !userProfile.signupSourceRecordedAt
    && eligibleForSourcePrompt
  ) {
    return (
      <Suspense fallback={<AuthSplash />}>
        <SignupSourceStep
          onSubmit={(payload) => userProfile.setSignupSource(payload)}
          onSignOut={signOut}
        />
      </Suspense>
    );
  }

  const screenMap = {
    home: <Home setScreen={setScreen} userName={userName} />,
    agenda: <Agenda />,
    patients: <Patients />,
    groups: <Groups />,
    finances: <Finances />,
    archivo: <Archivo />,
    settings: <Settings user={user} signOut={signOut} refreshUser={refreshUser} />,
    privacy: <PrivacyPolicy />,
    // Native-gated: admin only renders on web. On native the topbar
    // admin button opens cardigan.mx in Safari instead, so this
    // branch is unreachable in normal use — but the gate stops a
    // deep-link / hash-typing edge case from rendering a broken
    // surface and prevents the admin chunk from being downloaded.
    admin: admin && !readOnly && !isNative() ? (
      <AdminLayout
        currentAdminId={user?.id}
        onOpenPalette={() => setPaletteOpen(true)}
        onViewAs={(uid) => {
          // Snapshot the admin hash so the read-only banner's exit
          // path can restore it (e.g. #admin/users/<uid>).
          viewAsOriginHashRef.current = typeof window !== "undefined"
            ? window.location.hash
            : null;
          setViewAsUserId(uid);
          navigate("home");
        }}
        onLeaveAdmin={() => navigate("home")}
      />
    ) : <Home setScreen={setScreen} userName={userName} />,
  };

  return (
    <CardiganProvider value={ctxValue}>
    <div className="shell" ref={shellRef}>
      {/* Skip-to-main-content link — visually hidden until it receives
          focus, at which point it materializes in the top-left corner.
          Lets keyboard users (and switch-control users) jump past the
          topbar, drawer, and bottom-tabs to the page content with one
          Tab + Enter, instead of tabbing through every nav button on
          every page change. */}
      <a href="#main-content" className="skip-link">
        {t("a11y.skipToMain") || "Saltar al contenido"}
      </a>
      {/* LFPDPPP consent gate — blocks the app on first login or after a
          policy version bump. Skipped in demo mode (no real user) and
          in admin "view as user" mode (read-only). */}
      {!demo && !readOnly && user && <ConsentBanner user={user} />}
      {!demo && !readOnly && user && !cryptoGateDismissed && (
        <Suspense fallback={null}>
          <EncryptionUnlockGate noteCrypto={noteCrypto} onSkip={() => setCryptoGateDismissed(true)} />
        </Suspense>
      )}
      {welcomeProOpen && (
        <Suspense fallback={null}>
          <SubscriptionWelcome
            daysLeftInTrial={subscription.daysLeftInTrial}
            onContinue={closeWelcomePro}
            onSubscribe={subscribeFromWelcomePro}
          />
        </Suspense>
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
      {/* Cardi — in-app navigation/help chatbot. Lazy-loaded so the
          @anthropic-ai/sdk-powered hook + the sheet bundle only ship
          when the user actually opens the chat. */}
      <Suspense fallback={null}>
        {cardiOpen && (
          <CardiSheet open={cardiOpen} onClose={() => setCardiOpen(false)} />
        )}
      </Suspense>
      {/* In-app notification inbox — bell in the topbar opens it. Lazy so
          the sheet bundle only ships when first opened. */}
      <Suspense fallback={null}>
        {inboxOpen && <InboxSheet onClose={() => setInboxOpen(false)} />}
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
        {passkeyPromptOpen && (
          <PasskeyEnrollPrompt
            open={passkeyPromptOpen}
            creating={passkeyCreating}
            onCreate={createPasskeyFromPrompt}
            onDismiss={dismissPasskeyPrompt}
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
        <Suspense fallback={null}>
          <MilestoneCelebration
            userId={user.id}
            accessState={subscription.accessState}
          />
        </Suspense>
      )}
      {/* Opens after the user crosses all 4 activation steps (the
          ActivationChecklist fires this via openActivationShareSheet
          on its own bonus-grant path). The sheet is lazy in the
          sense that the state stays false until that single
          transition — no rendering cost on the steady state. */}
      {!demo && !readOnly && user && (
        <Suspense fallback={null}>
          <ActivationCompleteShareSheet
            open={activationShareOpen}
            onClose={() => setActivationShareOpen(false)}
            code={subscription?.referralInfo?.code || null}
          />
        </Suspense>
      )}
      {/* In-app rating sheet — driven either by the #rating hash
          (email deep-link) or the organic day-14 eligibility check
          above. Hidden in demo + read-only modes. */}
      {!demo && !readOnly && user && (
        <Suspense fallback={null}>
          <RatingSheet
            open={ratingSheetOpen}
            onClose={() => setRatingSheetOpen(false)}
            promptKind="day14_v1"
            userId={user.id}
          />
        </Suspense>
      )}
      {/* PWA Web Share Target receiver — only mounts when a share
          arrived (shareFolderUrl set by the URL-param effect). The
          sheet itself handles the "URL didn't parse" case so we
          don't need to validate here. */}
      {!demo && !readOnly && user && shareFolderUrl && (
        <Suspense fallback={null}>
          <ShareFolderSheet
            open={!!shareFolderUrl}
            url={shareFolderUrl}
            onClose={() => setShareFolderUrl(null)}
          />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <Drawer screen={screen} setScreen={handleDrawerNav} onClose={() => { setDrawerOpen(false); setSwipeProgress(0); }}
          user={user} signOut={signOut} open={drawerOpen} swipeProgress={swipeProgress}
          onReportBug={user && !demo && !readOnly ? () => { setDrawerOpen(false); setSwipeProgress(0); setBugReportOpen(true); } : null} />
      </Suspense>

      {/* tabIndex={-1} is what actually makes the skip-link work: a
          plain <div> with id="main-content" wouldn't accept programmatic
          focus, so the browser would update the URL hash but the
          user's tab order would stay where it was. -1 means "focusable
          via .focus() / hash navigation, but not in the normal tab
          sequence" — exactly the contract we want. */}
      <div className="main-content" id="main-content" tabIndex={-1}>
        <div className="status-bar" />

        {/* Dismissible, one-time iOS-Safari hint pointing users to the
            home-screen PWA — the only way to escape Safari's bottom
            toolbar (a website can't hide it). Renders nothing in the
            installed PWA, the native shell, on Android, or once dismissed
            (localStorage). Self-gated; safe to mount unconditionally. */}
        <InstallPrompt />


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
            <button onClick={() => {
              setViewAsUserId(null);
              // Return to the exact admin page the action was launched
              // from — typically #admin/users/<uid>, the user's
              // detail. Falls back to Home if there's no captured
              // origin (defensive against an admin hash that was
              // cleared mid-session).
              const origin = viewAsOriginHashRef.current;
              viewAsOriginHashRef.current = null;
              if (origin && origin.startsWith("#admin")) {
                if (typeof window !== "undefined") window.location.hash = origin;
                setScreen("admin");
              } else {
                setScreen("home");
              }
            }}
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
            <span className="app-banner-text">
              {isNative() && isIOS()
                ? t("subscription.expiredBannerIOS")
                : t("subscription.expiredBanner")}
            </span>
            {/* iOS reader-app: no subscribe CTA. The banner copy above
                tells the user where to go without an in-app link. */}
            {!(isNative() && isIOS()) && (
              <button onClick={() => navigate("settings")} className="app-banner-action">
                {t("subscription.subscribeShort")}
              </button>
            )}
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

        {/* Offline + mutation-queue surface. Renders when offline OR
            when the queue has pending entries (e.g. flushing right
            after reconnect). The banner itself is enough feedback —
            we used to fire a "X cambios guardados" success toast on
            every drain, but routine online enqueues (snapshots, tag
            links) tripped it too, carpet-bombing the editor with
            toasts that the header "Guardando…/Guardado" indicator
            already covered. The banner's headline ("Sincronizando…"
            then disappearing) is the offline-recovery signal. */}
        <OfflineBanner />

        <div className="topbar">
          <button
            className={`hamburger ${drawerOpen?"open":""}`}
            onClick={() => setDrawerOpen(o=>!o)}
            onMouseEnter={drawerImport}
            onFocus={drawerImport}
            aria-label={t("nav.menu")}
          >
            <div className="hamburger-line" />
            <div className="hamburger-line" />
            <div className="hamburger-line" />
          </button>
          {/* Mobile-only entry to the command palette / patient
              search. Cmd-K is keyboard-gated and TopbarActions is
              hidden below 768px, so without this iPhone users had
              no way to fuzzy-jump to a patient in a 30+ list. Lives
              on the LEFT next to the hamburger — the right side
              already carries the admin chip, help, and avatar; an
              extra circle there made the cluster feel cramped. */}
          {!readOnly && (
            <button
              type="button"
              className="topbar-search-mobile"
              onClick={() => setPaletteOpen(true)}
              aria-label={t("cmdp.open") || "Buscar"}
            >
              <IconSearch size={18} />
            </button>
          )}
          <button type="button" className="topbar-brand" onClick={() => navigate("home")} aria-label={t("nav.home")} style={{ cursor:"pointer", background:"none", border:"none", padding:0 }}><LogoIcon size={20} color="currentColor" /><span>cardigan</span></button>
          {/* Per-screen H1 — only visible on desktop (topbar-screen-name
              is `display: none` below 768px), but always announced to
              screen readers via aria-live=polite so an AT user knows
              what page they just navigated to. Without this the topbar
              had zero heading semantics and AT users had to infer the
              current screen from URL hash or active nav item. */}
          <h1 className="topbar-screen-name" aria-live="polite">{t(`nav.${screen}`)}</h1>
          <div className="topbar-right">
            {!readOnly && <TopbarActions onOpenPalette={() => setPaletteOpen(true)} />}
            <Tooltip label={t("inbox.title")} placement="bottom">
              <button
                type="button"
                className="topbar-refresh-btn"
                onClick={() => setInboxOpen(true)}
                aria-label={t("inbox.open")}
                style={{ position: "relative" }}
              >
                <IconBell size={16} />
                {inboxUnread > 0 && (
                  <span aria-hidden style={{
                    position: "absolute", top: 3, right: 3,
                    width: 9, height: 9, borderRadius: 999,
                    background: "var(--red)", border: "1.5px solid var(--white)",
                  }} />
                )}
              </button>
            </Tooltip>
            <Tooltip label={t("retry")} placement="bottom">
              <button className="topbar-refresh-btn" onClick={refresh} aria-label={t("retry")}><IconRefresh size={16} /></button>
            </Tooltip>
            {admin && !readOnly && (
              <button
                className="admin-btn"
                onClick={async () => {
                  // Admin lives on the web only. On native (iOS /
                  // Android Capacitor) the button hands off to Safari
                  // / Chrome via AppLauncher — the user's existing
                  // session there means they land directly in the
                  // admin view without re-authenticating. Rationale:
                  // (1) admin is one-user, never used by regular
                  // therapists — it doesn't justify the bundle weight
                  // or attack surface on every install;
                  // (2) admin features (impersonation, encryption
                  // recovery, billing grants) are sensitive enough
                  // that keeping them off the mobile binary is
                  // defensive both for App Store review and against
                  // IPA reverse-engineering;
                  // (3) admin operations are deliberate / desk-shaped
                  // work, not "while walking around" work — the phone
                  // isn't the natural surface.
                  if (isNative()) {
                    const { launchUrl } = await import("./lib/nativeBrowser");
                    await launchUrl("https://cardigan.mx/#admin");
                  } else {
                    navigate("admin");
                  }
                }}>
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
              {/* Suspense boundary for the lazy screen chunks. The
                  fallback is the same per-screen LoadingSkeleton the
                  data-loading path uses, so a chunk-fetch flash and
                  a data-fetch flash look identical to the user. */}
              <Suspense fallback={<LoadingSkeleton screen={screen} />}>
                {/* Groups disabled → a deep-link / stale hash to #groups
                    falls back to Home so the feature is fully inert. */}
                {screenMap[(screen === "groups" && !groupsEnabled) ? "home" : screen]}
              </Suspense>
            </SkeletonCrossfade>
          </div>
        </PullToRefresh>
        {!readOnly && (
          <Suspense fallback={null}>
            <PaymentModal open={paymentModalOpen} onClose={(msg) => { setPaymentModalOpen(false); setEditingPayment(null); if (typeof msg === "string" && msg) showSuccess(msg); }}
              initialPatientName={paymentDraft.patientName} initialAmount={paymentDraft.amount} editingPayment={editingPayment} />
          </Suspense>
        )}
        {!readOnly && expenseSheetOpen && (
          <Suspense fallback={null}>
            <ExpenseSheet
              editingExpense={editingExpense}
              onClose={(msg) => {
                setExpenseSheetOpen(false);
                setEditingExpense(null);
                if (typeof msg === "string" && msg) showSuccess(msg);
              }}
            />
          </Suspense>
        )}
        {!readOnly && recurringExpenseSheetOpen && (
          <Suspense fallback={null}>
            <RecurringExpenseSheet
              onClose={() => setRecurringExpenseSheetOpen(false)}
            />
          </Suspense>
        )}
        {!readOnly && !hideFab && <QuickActions />}
        {!hideBottomTabs && <BottomTabs />}
        <Suspense fallback={null}>
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            currentAdminId={user?.id}
          onViewAsUser={admin && !readOnly ? (uid) => {
            // Same impersonation entry as AdminLayout's onViewAs. We
            // snapshot the admin hash (empty when invoked from a non-admin
            // screen) so the read-only banner's exit returns to wherever
            // the admin invoked the action from.
            viewAsOriginHashRef.current = typeof window !== "undefined"
              ? window.location.hash
              : null;
            setViewAsUserId(uid);
            navigate("home");
          } : undefined}
          />
        </Suspense>

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
