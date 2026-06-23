import React, { useEffect, useState, useRef, useCallback, lazy, Suspense } from "react";
import { useAuth } from "./hooks/useAuth";
import { useToastQueue } from "./hooks/useToastQueue";
import { useEngagementPrompts } from "./hooks/useEngagementPrompts";
import { useLaunchParams } from "./hooks/useLaunchParams";
import { useCardiganContextValue } from "./hooks/useCardiganContextValue";
import ErrorBoundary from "./components/ErrorBoundary";
import { LoadingSkeleton, SkeletonCrossfade } from "./components/LoadingSkeleton";
import { isNative } from "./lib/platform";
import { useNoteCrypto } from "./hooks/useNoteCrypto";
import { AppOverlays } from "./components/app/AppOverlays";
import { AppBanners } from "./components/app/AppBanners";
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
import { useEdgeSwipeGesture } from "./hooks/useEdgeSwipeGesture";
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
import { identify as analyticsIdentify, reset as analyticsReset } from "./lib/analytics";
import MfaChallengeGate from "./components/MfaChallengeGate";
import { PasswordRecoveryScreen } from "./components/PasswordRecoveryScreen";
import { BugReportSheet } from "./components/BugReportFab";
import { UpdatePrompt, consumePostUpdateToast } from "./components/UpdatePrompt";
import { useTheme } from "./hooks/useTheme";
import { useNotifications } from "./hooks/useNotifications";
import { useSubscription } from "./hooks/useSubscription";
import "./utils/logBuffer";
import "./styles/index.css";

// Boundary alias for untyped domain/hook/context data flowing in from
// the still-JS data layer. See the migration conventions — mechanical,
// behavior-preserving; not a real domain model.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

// The trial-reminder cadence is intentionally light — a few nudges across
// the 30-day window respects the user's attention more than a daily
// final-week barrage, and each modal is suppressed if the user opened the
// plan sheet within the last 3 days. The cadence constants + the
// eligibility decisions live in utils/modalGates (pure + unit-tested);
// the side-effect orchestration (localStorage read/write, setTimeout,
// setState) lives in hooks/useEngagementPrompts.

// AuthSplash is the single brand-loading surface for the entire boot
// sequence (Suspense fallbacks, auth/role gates, and the MFA gate). It
// lives in its own module so MfaChallengeGate can render the exact same
// splash instead of a bare "Cargando" line — see components/AuthSplash.

// Passkey enrollment-nudge cadence (respectful but persistent) lives in
// utils/modalGates (PASSKEY_PROMPT_MAX_ASKS / _COOLDOWN_MS + the
// shouldPromptPasskey decision); the nudge effect itself is in
// hooks/useEngagementPrompts.

function CardiganApp() {
  const { user, loading: authLoading, signUp, signIn, signInWithMagicLink, signInWithPasskey, signInWithProvider, signOut, refreshUser, recoveryMode, inviteMode, setNewPassword } = useAuth();
  const [demoMode, setDemoMode] = useState(false);
  // When set, AuthScreen mounts directly into the signup sheet — used by the
  // demo banner's "Crear cuenta" button AND by the ?ref=<code> referral-link
  // capture below, so a visitor arriving from a friend's invite link skips
  // the landing page entirely.
  const [authIntent, setAuthIntent] = useState<string | null>(() => {
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
        <AuthScreen onSignIn={signIn as Row} onSignUp={signUp as Row} onProvider={signInWithProvider as Row} onMagicLink={signInWithMagicLink as Row} onPasskey={signInWithPasskey} onDemo={() => { setAuthIntent(null); setDemoMode(true); }} autoOpen={authIntent ?? undefined} />
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

type AppShellProps = {
  user: Row;
  signOut: Row;
  refreshUser?: Row;
  demo?: boolean;
  theme?: Row;
};

function AppShell({ user, signOut, refreshUser, demo, theme }: AppShellProps) {
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
  const [viewAsUserId, setViewAsUserId] = useState<string | null>(null);
  // Where the admin came from when they entered "view as user" mode.
  // Captured as the full hash so the exit path can drop them BACK on
  // the exact admin page (Usuarios, the user's detail tab, etc.) they
  // launched from — instead of the previous behavior that always
  // dumped them on Home regardless of origin.
  const viewAsOriginHashRef = useRef<string | null>(null);
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
  const setGroupsEnabled = useCallback((val: boolean) => {
    setGroupsEnabledState(val);
    try { if (user?.id) localStorage.setItem(`cardigan.groupsEnabled.${user.id}`, String(val)); } catch { /* private mode */ }
  }, [user?.id]);
  const [bugReportOpen, setBugReportOpen] = useState(false);
  // Activation-complete share sheet — opens when ActivationChecklist
  // crosses 0→all-done. Reuses the user's referral code so the user
  // can share with a colleague at the moment they feel best about
  // having finished setup.
  const [activationShareOpen, setActivationShareOpen] = useState(false);
  // The encryption unlock prompt is dismissable for the current
  // session — closing the tab re-prompts on next visit. Until then,
  // encrypted notes still render as "[cifrado]" since noteCrypto.canEncrypt
  // stays false.
  const [cryptoGateDismissed, setCryptoGateDismissed] = useState(false);
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
  const [demoProfession, setDemoProfession] = useState<string>(DEFAULT_PROFESSION);
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
  const [paymentDraft, setPaymentDraft] = useState<Row>({ patientName:"", amount:"" });
  const [editingPayment, setEditingPayment] = useState<Row>(null);

  /* ── Toast queue (single source of truth) ──
     Previously three separate toast slots (success, mutationError,
     uiToast) rendered independently, which meant rapid mutations
     could clobber their own channel and the three channels could also
     collide on screen. Now every surface pushes into one queue; the
     UI renders up to MAX_TOASTS with a stagger, oldest fading out
     first. Persistent toasts (the mutationError) don't auto-dismiss. */
  // Single toast channel (state + push/dismiss API + the data-layer
  // error→toast wiring). Extracted to useToastQueue so the shell stops
  // owning the queue plumbing; unit-tested in isolation.
  const { toasts, showToast, showSuccess, dismissToast } = useToastQueue({
    mutationError, fetchError, clearMutationError, refresh, t,
  });

  /* QuickScheduleSheet at the App level — renders once, opened from
     anywhere via openQuickSchedule(patient) on the cardigan context.
     The end-of-visit toast (fired below from onMarkCompleted) routes
     into this so the user can schedule the next consult with one tap
     from the toast, regardless of which screen they're on. */
  const [quickScheduleFor, setQuickScheduleFor] = useState<Row>(null);
  const openQuickSchedule = useCallback((patient: Row) => {
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
    const handler = (e: Event) => {
      const detail = (e as CustomEvent)?.detail || {};
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
  // (mutation/fetch error → toast wiring lives in useToastQueue above)
  // Online/offline state — useConnectivity is the canonical hook now
  // (also consumed by OfflineBanner). Kept in the App-level context
  // for any consumer that branches on it (e.g. action gating).
  const { online } = useConnectivity();
  const pendingAgendaViewRef = useRef<Row>(null);
  const pendingExpedienteRef = useRef<Row>(null);
  // Pending note open — set by CommandPalette when a user picks a note
  // from the search results, consumed by Notes screen on mount. Mirrors
  // the pendingExpedienteRef pattern so the palette doesn't need to
  // reach into per-screen state setters.
  const pendingNoteOpenRef = useRef<Row>(null);

  // ── Referral-code URL handler (?ref=<CODE>) ──
  // The capture happens earlier in CardiganApp (before the auth
  // gate) so visitors arriving from a referral link land directly
  // on the signup sheet. By the time AppShell renders, the URL has
  // already been stripped and the code is in sessionStorage —
  // Settings → plan reads from there at checkout time. No further
  // work needed at this layer.

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

  // The five lifecycle / engagement prompts (rating sheet, welcome-to-Pro,
  // trial reminder, passkey enroll nudge, subscription-success celebration)
  // and their localStorage-dedup + setTimeout orchestration live in
  // useEngagementPrompts; the shell just consumes the open-flags + handlers.
  const {
    ratingSheetOpen, setRatingSheetOpen,
    welcomeProOpen, closeWelcomePro, subscribeFromWelcomePro,
    welcomePaymentOpen, setWelcomePaymentOpen,
    trialReminderOpen, setTrialReminderOpen, trialReminderDays,
    trialReminderPaymentOpen, setTrialReminderPaymentOpen, subscribeFromTrialReminder,
    passkeyPromptOpen, passkeyCreating, dismissPasskeyPrompt, createPasskeyFromPrompt,
    subscriptionSuccessOpen, closeSubscriptionSuccess,
  } = useEngagementPrompts({
    demo, viewAsUserId, user, readOnly,
    subscription, tutorialState: tutorial?.state,
    upcomingSessions, patients,
    showSuccess, showToast, t,
  });

  // ── Pro feature gating ──
  // Centralized "open the upgrade sheet" so any screen can call
  // requirePro("documents" | "encryption" | "calendar") without
  // mounting its own copy of the sheet. The sheet renders once at App
  // level, far enough below the StripePaymentSheet that subscribing
  // from inside it can stack cleanly.
  const [proSheetOpen, setProSheetOpen] = useState(false);
  const [proSheetFeature, setProSheetFeature] = useState<string | null>(null);
  const requirePro = useCallback((feature?: string) => {
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
  const handleDrawerNav = useCallback((id: string) => {
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

  const userName = demo ? "Demo" : (user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuario");
  const userInitial = userName.charAt(0).toUpperCase();
  const { imageUrl: avatarImageUrl } = useAvatarUrl(demo ? null : user?.user_metadata?.avatar);

  const openEditPaymentModal = useCallback((payment: Row) => {
    if (readOnly) return;
    setEditingPayment(payment);
    setPaymentDraft({ patientName: "", amount: "" });
    setPaymentModalOpen(true);
  }, [readOnly]);

  const openRecordPaymentModal = useCallback((patient: Row) => {
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
  const [editingExpense, setEditingExpense] = useState<Row>(null);
  const openRecordExpenseModal = useCallback(() => {
    if (readOnly) return;
    setEditingExpense(null);
    setExpenseSheetOpen(true);
  }, [readOnly]);
  const openEditExpenseModal = useCallback((expense: Row) => {
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
  const shellRef = useRef<HTMLDivElement | null>(null);
  const edgeRef = useRef<Row>(null);
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

  // Left-edge swipe-to-open for the nav drawer (phone only). Extracted
  // to a hook so the shell stops owning ~150 lines of touch plumbing;
  // the open/commit decision is unit-tested in useEdgeSwipeGesture.
  useEdgeSwipeGesture({
    shellRef, edgeRef, drawerOpenRef, screenSlidingRef,
    isTablet, setSwipeProgress, setDrawerOpen,
  });

  const [pendingFabAction, setPendingFabAction] = useState<string | null>(null);

  // The three URL-param "launch intent" receivers (Stripe billing return,
  // PWA Web Share Target, PWA/native shortcuts) and their strip-from-URL
  // plumbing live in useLaunchParams; the shell consumes the resulting
  // shareFolderUrl. Placed after pendingFabAction since the shortcuts
  // receiver calls setPendingFabAction directly.
  const { shareFolderUrl, setShareFolderUrl } = useLaunchParams({
    demo, readOnly, user,
    setScreen, setPendingFabAction, pendingAgendaViewRef,
    showSuccess, showToast, t,
  });

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
  const withUndoableDelete = useCallback((softFn: Row, label: string) => async (...args: Row[]) => {
    if (typeof softFn !== "function") return false;
    const handle = softFn(...args);
    if (!handle || typeof handle.commit !== "function") return false;

    let done = false;
    // eslint-disable-next-line prefer-const -- referenced in cleanup() closure below before its single assignment
    let timer: ReturnType<typeof setTimeout>;
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

  // The CardiganContext assembler — composes `...data` with the shell's
  // overrides + cross-cutting handlers (pro-gated uploadDocument, the
  // undoable-delete wrappers, onCancelSession, onMarkCompleted's episodic
  // "schedule next" prompt) into the two memoized slices the context
  // consumers read: `mainValue` (data + actions + config, stable across
  // navigation) and `uiValue` (fast-changing nav/UI state). Lives in
  // useCardiganContextValue so the shell stops owning the memo; the
  // behaviorful handlers are characterization-tested there.
  const ctxValue = useCardiganContextValue({
    data, readOnly, subscription, requirePro, withUndoableDelete,
    noteCrypto, profession, accentTheme, userProfile, groupsEnabled, setGroupsEnabled,
    user, userName, userInitial,
    openRecordPaymentModal, openEditPaymentModal, openRecordExpenseModal, openEditExpenseModal, openRecurringExpenseSheet,
    setHideFab, setHideBottomTabs, setScreen, admin,
    navigate, pushLayer, popLayer, removeLayer, online,
    screen, drawerOpen, setDrawerOpen, tutorial, theme, notifications, showSuccess, showToast,
    pendingFabAction, setPendingFabAction, setActivationShareOpen,
    pendingAgendaViewRef, pendingExpedienteRef, pendingNoteOpenRef,
    openQuickSchedule, updateSessionStatus, patients, upcomingSessions, t,
  });

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
          onSubmit={(payload: Row) => userProfile.setSignupSource(payload)}
          onSignOut={signOut}
        />
      </Suspense>
    );
  }

  const screenMap: Record<string, React.ReactNode> = {
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
        onViewAs={(uid: string) => {
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
    <CardiganProvider mainValue={ctxValue.mainValue} uiValue={ctxValue.uiValue}>
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
      <AppOverlays
        demo={demo}
        readOnly={readOnly}
        user={user}
        viewAsUserId={viewAsUserId}
        noteCrypto={noteCrypto}
        cryptoGateDismissed={cryptoGateDismissed}
        setCryptoGateDismissed={setCryptoGateDismissed}
        subscription={subscription}
        welcomeProOpen={welcomeProOpen}
        closeWelcomePro={closeWelcomePro}
        subscribeFromWelcomePro={subscribeFromWelcomePro}
        welcomePaymentOpen={welcomePaymentOpen}
        setWelcomePaymentOpen={setWelcomePaymentOpen}
        proSheetOpen={proSheetOpen}
        proSheetFeature={proSheetFeature}
        setProSheetOpen={setProSheetOpen}
        cardiOpen={cardiOpen}
        setCardiOpen={setCardiOpen}
        inboxOpen={inboxOpen}
        setInboxOpen={setInboxOpen}
        trialReminderOpen={trialReminderOpen}
        trialReminderDays={trialReminderDays}
        subscribeFromTrialReminder={subscribeFromTrialReminder}
        setTrialReminderOpen={setTrialReminderOpen}
        passkeyPromptOpen={passkeyPromptOpen}
        passkeyCreating={passkeyCreating}
        createPasskeyFromPrompt={createPasskeyFromPrompt}
        dismissPasskeyPrompt={dismissPasskeyPrompt}
        trialReminderPaymentOpen={trialReminderPaymentOpen}
        setTrialReminderPaymentOpen={setTrialReminderPaymentOpen}
        subscriptionSuccessOpen={subscriptionSuccessOpen}
        closeSubscriptionSuccess={closeSubscriptionSuccess}
        activationShareOpen={activationShareOpen}
        setActivationShareOpen={setActivationShareOpen}
        ratingSheetOpen={ratingSheetOpen}
        setRatingSheetOpen={setRatingSheetOpen}
        shareFolderUrl={shareFolderUrl}
        setShareFolderUrl={setShareFolderUrl}
        showSuccess={showSuccess}
        t={t}
      />
      <Suspense fallback={null}>
        <Drawer screen={screen} setScreen={handleDrawerNav} onClose={() => { setDrawerOpen(false); setSwipeProgress(0); }}
          user={user} signOut={signOut} open={drawerOpen} swipeProgress={swipeProgress}
          onReportBug={user && !demo && !readOnly ? () => { setDrawerOpen(false); setSwipeProgress(0); setBugReportOpen(true); } : undefined} />
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


        <AppBanners
          demo={demo}
          viewAsUserId={viewAsUserId}
          subscription={subscription}
          demoProfession={demoProfession}
          setDemoProfession={setDemoProfession}
          signOut={signOut}
          setViewAsUserId={setViewAsUserId}
          viewAsOriginHashRef={viewAsOriginHashRef}
          setScreen={setScreen}
          navigate={navigate}
          t={t}
        />

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
                {/* Per-screen error boundary — a crash in one screen
                    (e.g. Notes) renders a contained "Reintentar" card
                    instead of blanking the whole app via the root
                    boundary. Keyed on `screen` so navigating away
                    auto-resets it; the contained retry re-mounts in
                    place. Groups disabled → a deep-link / stale hash to
                    #groups falls back to Home so the feature is inert. */}
                <ErrorBoundary inline name={`screen:${screen}`} key={screen}>
                  {screenMap[(screen === "groups" && !groupsEnabled) ? "home" : screen]}
                </ErrorBoundary>
              </Suspense>
            </SkeletonCrossfade>
          </div>
        </PullToRefresh>
        {!readOnly && (
          <Suspense fallback={null}>
            <PaymentModal open={paymentModalOpen} onClose={((msg: Row) => { setPaymentModalOpen(false); setEditingPayment(null); if (typeof msg === "string" && msg) showSuccess(msg); }) as Row}
              initialPatientName={paymentDraft.patientName} initialAmount={paymentDraft.amount} editingPayment={editingPayment} />
          </Suspense>
        )}
        {!readOnly && expenseSheetOpen && (
          <Suspense fallback={null}>
            <ExpenseSheet
              editingExpense={editingExpense}
              onClose={((msg: Row) => {
                setExpenseSheetOpen(false);
                setEditingExpense(null);
                if (typeof msg === "string" && msg) showSuccess(msg);
              }) as Row}
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
          onViewAsUser={admin && !readOnly ? (uid: string) => {
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
