import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import { supabase } from "../supabaseClient";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- boundary: untyped domain/hook data
type Row = any;
import { openExternal } from "../lib/nativeBrowser";
import { isNative, isIOS } from "../lib/platform";
import { DiagnosticsSheet } from "../components/sheets/DiagnosticsSheet";
// Lazy-loaded so Stripe.js + the PaymentElement bundle aren't pulled
// into the main chunk for users who never open the payment sheet.
const StripePaymentSheet = lazy(() => import("../components/StripePaymentSheet"));
import { IconUsers, IconStar, IconKey, IconX, IconCheck, IconSun, IconMoon, IconSmartphone, IconBell, IconLock, IconSparkle } from "../components/Icons";
import { AccountHeader } from "./settings/AccountHeader";
import { MfaSheets } from "./settings/sheets/MfaSheets";
import { ChangePasswordSheet } from "./settings/sheets/ChangePasswordSheet";
import { PasskeysSheet } from "./settings/sheets/PasskeysSheet";
import { SignOutEverywhereSheet } from "./settings/sheets/SignOutEverywhereSheet";
import { ExportDataSheet } from "./settings/sheets/ExportDataSheet";
import { DeleteAccountSheet } from "./settings/sheets/DeleteAccountSheet";
import { SubscriptionPanel } from "./settings/SubscriptionPanel";
import { AppearancePanel } from "./settings/AppearancePanel";
import { FeaturesPanel } from "./settings/FeaturesPanel";
import { NotificationsCalendarPanel } from "./settings/NotificationsCalendarPanel";
import { SecurityPanel } from "./settings/SecurityPanel";
import { DataPrivacyPanel } from "./settings/DataPrivacyPanel";
import { HelpPanel } from "./settings/HelpPanel";
import { DangerZone } from "./settings/DangerZone";
import { NextRemindersPreview } from "./settings/NextRemindersPreview";
import { ProValueWidget } from "../components/ProValueWidget";
import { MONETIZATION_ENABLED } from "../config/monetization";

// Spanish "hace X" relative time for the referral leaderboard. Days
// rounded down so "hace 1 día" doesn't slip to "hace 0 días" on the
// 23rd hour. Anything older than 30 days falls back to a calendar
// date so the leaderboard doesn't read as a stale-feeling "hace 200
// días" list.
function relativeTime(iso: string | null | undefined) {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const diffMs = Date.now() - then.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} ${mins === 1 ? "min" : "mins"}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} ${hrs === 1 ? "hora" : "horas"}`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `hace ${days} ${days === 1 ? "día" : "días"}`;
  return formatDate(then, "shortYear");
}
import { useCalendarToken } from "../hooks/useCalendarToken";
import { CalendarLinkPanel } from "../components/CalendarLinkPanel";
import { OnlinePaymentsPanel } from "../components/OnlinePaymentsPanel";
import { PasswordInput } from "../components/PasswordInput";
import { Toggle } from "../components/Toggle";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Avatar } from "../components/Avatar";
import { AvatarPicker } from "../components/AvatarPicker";
import { useAvatarUrl } from "../hooks/useAvatarUrl";
import { useMfa } from "../hooks/useMfa";
import { usePasskeys } from "../hooks/usePasskeys";
import { SegmentedControl } from "../components/SegmentedControl";
import { Expando } from "../components/Expando";
import { PushInstallCard } from "../components/PushInstallCard";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useSheetDrag } from "../hooks/useSheetDrag";
import { useCardigan } from "../context/CardiganContext";
import { isClinicalProfession } from "../data/constants";
import { haptic } from "../utils/haptics";
import { billingSummary } from "../utils/subscriptionStatus";
import { formatMXNCents, formatDate } from "../utils/format";
// Map typed error codes from useNotifications to user-readable i18n
// keys. Keeping this as a pure mapping means the hook stays decoupled
// from locale strings.
// ReferralShareBlock + WhatsApp/Share glyphs live in their own module
// so other surfaces (the activation-complete share sheet, etc.) can
// reuse the exact same buttons and analytics taxonomy.
import { ReferralShareBlock } from "../components/ReferralShareBlock";

function notifErrorKey(code: string | undefined) {
  switch (code) {
    case "permission-denied": return "notifications.toastPermissionDenied";
    case "install-required":  return "notifications.toastInstallRequired";
    case "subscribe-failed":  return "notifications.toastSubscribeFailed";
    case "server-error":      return "notifications.toastServerError";
    case "unsupported":       return "notifications.toastUnsupported";
    default:                  return "notifications.toastSubscribeFailed";
  }
}

type SettingsProps = {
  user?: Row;
  signOut: (scope?: string) => void | Promise<void>;
  refreshUser?: () => void;
};

export function Settings({ user, signOut, refreshUser }: SettingsProps) {
  const { t } = useT();
  const { tutorial, navigate, theme, accentTheme, notifications, showToast, readOnly, noteCrypto, profession, setHideFab, subscription, requirePro, groups, groupsEnabled, setGroupsEnabled } = useCardigan();
  // Groups feature can only be turned OFF when there are no groups (turning
  // it back ON is always allowed). Disabling hides the whole Groups surface.
  const groupCount = (groups || []).length;
  const groupsToggleLocked = groupsEnabled !== false && groupCount > 0;
  const isPro = !!subscription?.isPro;
  const showEncryptionSetup = isClinicalProfession(profession);
  const { imageUrl: avatarImageUrl } = useAvatarUrl(user?.user_metadata?.avatar);
  const mfa = useMfa();
  // Passkeys (WebAuthn). `supported` is false on native + when the build
  // flag is off, so the whole row stays hidden there. Enrollment + delete
  // run their own WebAuthn ceremonies via the hook.
  const passkeys = usePasskeys();
  // (The password-reset captcha flow lives in ChangePasswordSheet now;
  //  the passkey remove-confirm state lives in PasskeysSheet.)

  // Toggle in-flight — prevents double-taps and shows the spinner knob
  // during the server round-trip for enable/disable.
  const [togglePending, setTogglePending] = useState(false);

  // One-shot bell micro-interaction on the "enabled → true" transition
  // so the Settings row feels alive when push is first activated. The
  // prevEnabledRef guard scopes it to the transition (not every render).
  const [bellFx, setBellFx] = useState(false);
  const prevEnabledRef = useRef(notifications?.enabled ?? false);
  useEffect(() => {
    const was = prevEnabledRef.current;
    const is = notifications?.enabled ?? false;
    prevEnabledRef.current = is;
    if (!was && is) {
      setBellFx(true);
      const id = setTimeout(() => setBellFx(false), 900);
      return () => clearTimeout(id);
    }
  }, [notifications?.enabled]);

  const handleToggleNotifications = async () => {
    if (!notifications || togglePending) return;
    if (notifications.needsInstall) {
      showToast(t("notifications.toastInstallRequired"), "warning");
      return;
    }
    setTogglePending(true);
    try {
      if (notifications.enabled) {
        const res = await notifications.disable();
        if (res?.ok) {
          haptic.tap();
          showToast(t("notifications.toastDisabled"), "info");
        } else {
          haptic.warn();
          showToast(t(notifErrorKey(res?.code)), "error");
        }
      } else {
        const res = await notifications.enable();
        if (res?.ok) {
          haptic.success();
          // Toggle flips visibly in the Settings row — no toast needed.
        } else {
          haptic.warn();
          showToast(t(notifErrorKey(res?.code)), res?.code === "permission-denied" ? "warning" : "error");
        }
      }
    } finally {
      setTogglePending(false);
    }
  };

  const handleReconcileReactivate = async () => {
    if (!notifications || togglePending) return;
    setTogglePending(true);
    try {
      const res = await notifications.enable();
      if (res?.ok) {
        haptic.success();
        // Toggle flips visibly — no toast needed.
      } else {
        haptic.warn();
        showToast(t(notifErrorKey(res?.code)), res?.code === "permission-denied" ? "warning" : "error");
      }
    } finally {
      setTogglePending(false);
    }
  };
  const userName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuario";
  const userEmail = user?.email || "";
  const userInitial = userName.charAt(0).toUpperCase();

  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const closeSheet = useCallback(() => setActiveSheet(null), []);
  useEscape(activeSheet ? closeSheet : null);
  // Bottom sheets cover only part of the screen, so the FAB ends up
  // floating over the sheet content (covering "Renovar enlace" on the
  // calendar sheet, for example). Hide it whenever any Settings sheet
  // is open — same mechanism Patients uses for the expediente drawer.
  useEffect(() => {
    if (!setHideFab) return;
    setHideFab(!!activeSheet);
    return () => setHideFab(false);
  }, [activeSheet, setHideFab]);
  // Prefetch the referral code so the dedicated Settings row can show
  // the user's code in its sub-line without waiting for them to open
  // the sheet. Cheap (one-row read + lazy mint on first call) and only
  // runs once per Settings mount.
  useEffect(() => {
    if (!subscription?.referralInfo && subscription?.fetchReferralInfo) {
      subscription.fetchReferralInfo();
    }
  // Intentionally only fires once on mount — the hook caches the result.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Cross-screen sheet opener — used by the Drawer's plan card so a
  // tap from anywhere can land directly inside the Suscripción sheet
  // without forcing the user to scroll-and-tap-row. Listens at the
  // window level since the dispatcher (Drawer) doesn't share React
  // ref space with this screen.
  useEffect(() => {
    const handleOpenSheet = (e: Event) => {
      const sheet = (e as CustomEvent)?.detail?.sheet;
      if (typeof sheet === "string") {
        if (sheet === "plan" || sheet === "referral") {
          // Both the Suscripción and Invita sheets prefetch the
          // referral code on first open — mirror that behaviour here
          // so the open-from-Drawer path looks identical.
          if (!subscription?.referralInfo) subscription?.fetchReferralInfo?.();
        }
        setActiveSheet(sheet);
      }
    };
    window.addEventListener("cardigan-open-settings-sheet", handleOpenSheet);
    return () => window.removeEventListener("cardigan-open-settings-sheet", handleOpenSheet);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lazy-load the referral leaderboard when the user opens the
  // referral sheet. RLS scopes the read to the caller's
  // inviter_user_id; the join-by-user_id (decoded server-side) is
  // cheap because the page size is capped at 20.
  useEffect(() => {
    if (activeSheet !== "referral") return;
    if (subscription?.referralLeaderboard != null) return;
    subscription?.fetchReferralLeaderboard?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSheet]);

  // Lazy-load the invoice history when the user opens the plan sheet
  // AND has an active sub. The list comes from `stripe_invoices`
  // (RLS-scoped); empty for any account predating this feature, since
  // we deliberately don't backfill — the Stripe portal still has the
  // pre-table receipts.
  useEffect(() => {
    if (activeSheet !== "plan") return;
    // Stamp a "user just looked at pricing" timestamp so the trial
    // reminder modal can suppress itself for the next few days. Cheap
    // and gives users credit for actually engaging with the panel.
    if (user?.id) {
      try { localStorage.setItem(`cardigan.planSheetSeen.${user.id}`, String(Date.now())); }
      catch { /* private mode — fine */ }
    }
    // Funnel: viewing the plan/pricing sheet is the step before
    // checkout_started. Lazy import keeps analytics off the hot path.
    import("../lib/analytics").then(({ track }) => track("plan_sheet_opened")).catch(() => {});
    if (!subscription?.subscribedActive) return;
    if (subscription.invoices != null) return;
    subscription.fetchInvoices?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSheet, subscription?.subscribedActive]);
  const { scrollRef: sheetScrollRef, setPanelEl: setSheetPanelEl, panelHandlers: sheetPanelHandlers } = useSheetDrag(closeSheet, { isOpen: !!activeSheet });
  // All Settings sheets share this one ref + handlers and exactly one
  // renders at a time (gated on `activeSheet`), so a single focus trap
  // keyed on `!!activeSheet` covers whichever sheet is mounted.
  const sheetPanelRef = useFocusTrap(!!activeSheet);
  const setSheetPanel = (el: HTMLDivElement | null) => { sheetPanelRef.current = el; sheetScrollRef.current = el; setSheetPanelEl(el); };
  const [editName, setEditName] = useState(userName);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<{ msg: string; tone: "ok" | "info" | "err" } | null>(null);

  /* ── Manual update check ────────────────────────────────────────
     Escape hatch for when the automatic SW update flow has missed a
     deploy (iOS standalone PWA occasionally stalls on updatefound;
     the event fires before our listener attaches and the banner
     never appears). Triggers reg.update() directly, then inspects
     reg.waiting / reg.installing and surfaces an inline status
     instead of relying on the toast. If a waiting SW is found, we
     tell the user to tap once more to apply — keeping the "no
     unexpected reload" guarantee. */
  const checkForUpdate = useCallback(async () => {
    if (updateChecking) return;
    if (!("serviceWorker" in navigator)) {
      setUpdateStatus({ msg: t("settings.updateUnsupported") || "Tu navegador no soporta actualizaciones automáticas.", tone: "err" });
      return;
    }
    setUpdateChecking(true);
    setUpdateStatus({ msg: t("settings.updateChecking") || "Buscando…", tone: "info" });
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        setUpdateStatus({ msg: t("settings.updateNoReg") || "No se detectó una instalación activa. Cierra y vuelve a abrir la app.", tone: "err" });
        return;
      }
      await reg.update();

      // If there's already a waiting SW, apply immediately — this is the
      // common iOS case where a prior update was silently installed but
      // the banner never appeared.
      if (reg.waiting) {
        setUpdateStatus({ msg: t("settings.updateApplying") || "Actualizando…", tone: "info" });
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
        // controllerchange in main.tsx reloads the page.
        return;
      }
      if (reg.installing) {
        const sw = reg.installing;
        setUpdateStatus({ msg: t("settings.updateInstalling") || "Descargando nueva versión…", tone: "info" });
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            setUpdateStatus({ msg: t("settings.updateApplying") || "Actualizando…", tone: "info" });
            sw.postMessage({ type: "SKIP_WAITING" });
          }
        });
        return;
      }
      setUpdateStatus({ msg: t("settings.updateNone") || "Ya tienes la versión más reciente.", tone: "ok" });
    } catch {
      setUpdateStatus({ msg: t("settings.updateErr") || "No se pudo buscar actualizaciones. Revisa tu conexión.", tone: "err" });
    } finally {
      setUpdateChecking(false);
    }
  }, [updateChecking, t]);

  const saveProfile = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ data: { full_name: editName.trim() } });
      if (error) { setMessage(t("settings.saveError")); return; }
      setMessage(t("settings.linkSent"));
      setTimeout(() => { setMessage(""); setActiveSheet(null); }, 1200);
    } catch {
      setMessage(t("settings.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const openSheet = (key: string) => {
    setMessage("");
    if (key === "profile") setEditName(userName);
    if (key === "plan" || key === "referral") {
      // Lazy-fetch the user's referral code (and rewards count) on
      // first open. The code is generated server-side; subsequent
      // opens reuse the cached info on the hook.
      if (!subscription?.referralInfo) subscription?.fetchReferralInfo?.();
    }
    setActiveSheet(key);
  };

  // ── Subscription sheet local state ──
  const [subBusy, setSubBusy] = useState(false);
  const [subError, setSubError] = useState("");
  const [inviteCodeInput, setInviteCodeInput] = useState(() => {
    // Prefill from the ?ref=<code> URL param captured at app boot
    // (App.jsx stashes it in sessionStorage). Lets a friend's WhatsApp
    // link survive the email-verify roundtrip and still apply at
    // checkout. Falls through to "" when nothing's stashed.
    try {
      const stashed = sessionStorage.getItem("cardigan.referralFromUrl");
      return stashed ? stashed.toUpperCase() : "";
    } catch { return ""; }
  });
  // True when the invite code came from a ?ref=<code> URL (i.e. the
  // user arrived via someone's referral link). The plan sheet hides
  // the invite-code input entirely in that case — the user shouldn't
  // need to know they were referred for the credit to apply. Word-
  // of-mouth users who type a code manually still see the field.
  const [inviteCodeFromUrl] = useState(() => {
    try { return !!sessionStorage.getItem("cardigan.referralFromUrl"); }
    catch { return false; }
  });
  const [referralCopied, setReferralCopied] = useState(false);
  // Native payment sheet — replaces the previous redirect-to-Stripe
  // flow. We pass the resolved invite code at open-time so it's stable
  // through the whole confirm cycle even if the user re-types in the
  // Suscripción sheet underneath.
  const [paymentSheetOpen, setPaymentSheetOpen] = useState(false);
  const [paymentSheetReferralCode, setPaymentSheetReferralCode] = useState<string | null>(null);
  const [paymentSheetPlan, setPaymentSheetPlan] = useState("monthly");
  // Selected billing cycle in the Suscripción sheet — controls the
  // segmented toggle and the price displayed in the hero. Defaults to
  // monthly; "annual" routes the checkout at STRIPE_PRICE_ID_ANNUAL.
  const [selectedPlan, setSelectedPlan] = useState("monthly");
  const handleStartCheckout = () => {
    if (subBusy) return;
    setSubError("");
    setPaymentSheetReferralCode(inviteCodeInput.trim() || null);
    setPaymentSheetPlan(selectedPlan);
    setPaymentSheetOpen(true);
  };
  const handleOpenPortal = async () => {
    if (subBusy || !subscription?.openPortal) return;
    setSubBusy(true); setSubError("");
    const res = await subscription.openPortal();
    setSubBusy(false);
    if (!res.ok) { setSubError(res.error || t("subscription.errorGeneric")); return; }
    // openExternal returns false when the in-app browser can't launch
    // (plugin not loaded, malformed URL). Without feedback the button
    // silently dead-ends; surface the generic error so it doesn't read
    // as broken.
    if (res.url) {
      const opened = await openExternal(res.url);
      if (!opened) setSubError(t("subscription.errorGeneric"));
    }
  };
  // Manual reconciliation — pulls live Stripe state and writes to DB.
  // Recovers from delayed/missed cancellation webhooks so the user
  // doesn't see a stale "Activa" after cancelling in Stripe.
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncDone, setSyncDone] = useState(false);
  const handleSyncWithStripe = async () => {
    if (syncBusy || !subscription?.syncWithStripe) return;
    setSyncBusy(true); setSubError("");
    const res = await subscription.syncWithStripe();
    setSyncBusy(false);
    if (!res.ok) { setSubError(res.error || t("subscription.errorGeneric")); return; }
    setSyncDone(true);
    setTimeout(() => setSyncDone(false), 2200);
  };
  const copyReferralCode = async () => {
    const code = subscription?.referralInfo?.code;
    if (!code) return;
    // Copy the FULL URL not the bare code — that way recipients can
    // tap the link directly and our ?ref=<code> handler prefills the
    // invite at signup. (Label has always said "Copiar enlace"; the
    // implementation drifted to the bare code at some point.)
    const url = `https://cardigan.mx/?ref=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setReferralCopied(true);
      // Fire-and-forget analytics. Lazy import avoids a hot-path
      // dependency for users who never tap.
      import("../lib/analytics").then(({ track }) => {
        track("referral_share", { channel: "copy_link" });
      }).catch(() => { /* swallow */ });
      setTimeout(() => setReferralCopied(false), 1800);
    } catch {
      showToast(t("settings.calendarCopyError"), "error");
    }
  };

  const restartTutorial = () => {
    navigate("home");
    setTimeout(() => { tutorial?.reset?.(); }, 340);
  };

  // ── Note encryption ────────────────────────────────────────────────
  const [encSetupPass1, setEncSetupPass1] = useState("");
  const [encSetupPass2, setEncSetupPass2] = useState("");
  const [encChangeNew1, setEncChangeNew1] = useState("");
  const [encChangeNew2, setEncChangeNew2] = useState("");
  const [encConfirmDisable, setEncConfirmDisable] = useState("");
  const [encBusy, setEncBusy] = useState(false);
  const [encUiError, setEncUiError] = useState("");

  const submitEncryptionSetup = async () => {
    setEncUiError("");
    if (encSetupPass1.length < 8) { setEncUiError(t("settings.encMinLength")); return; }
    if (encSetupPass1 !== encSetupPass2) { setEncUiError(t("settings.encMismatch")); return; }
    setEncBusy(true);
    const ok = await noteCrypto?.setup(encSetupPass1);
    setEncBusy(false);
    if (ok) {
      setEncSetupPass1(""); setEncSetupPass2(""); setActiveSheet(null);
      showToast(t("settings.encEnabledToast"), "success");
    } else if (noteCrypto?.error) {
      setEncUiError(noteCrypto.error);
    }
  };

  const submitEncryptionChange = async () => {
    setEncUiError("");
    if (encChangeNew1.length < 8) { setEncUiError(t("settings.encMinLength")); return; }
    if (encChangeNew1 !== encChangeNew2) { setEncUiError(t("settings.encMismatch")); return; }
    setEncBusy(true);
    const ok = await noteCrypto?.changePassphrase(encChangeNew1);
    setEncBusy(false);
    if (ok) {
      setEncChangeNew1(""); setEncChangeNew2(""); setActiveSheet(null);
      showToast(t("settings.encChangedToast"), "success");
    } else if (noteCrypto?.error) {
      setEncUiError(noteCrypto.error);
    }
  };

  const submitEncryptionDisable = async () => {
    setEncUiError("");
    if (encConfirmDisable !== "DESCIFRAR") { setEncUiError(t("settings.encDisableConfirmRequired")); return; }
    setEncBusy(true);
    const ok = await noteCrypto?.disable();
    setEncBusy(false);
    if (ok) {
      setEncConfirmDisable(""); setActiveSheet(null);
      showToast(t("settings.encDisabledToast"), "info");
    } else if (noteCrypto?.error) {
      setEncUiError(noteCrypto.error);
    }
  };

  // ── Privacy / ARCO actions ─────────────────────────────────────────
  // The export + delete reauth/captcha state and their handlers live in
  // ExportDataSheet / DeleteAccountSheet now.
  // Sign-out confirmation, mirroring the Drawer pattern.
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  // ── Derived row subtitles for the consolidated rows ─────────────
  // Notifications collapses 3 inline visual layouts into one row whose
  // subtitle reflects the underlying state machine.
  const notifSummary = (() => {
    if (!notifications?.supported) return t("settings.notifSummaryUnsupported");
    if (notifications.needsInstall) return t("settings.notifSummaryNeedsInstall");
    if (notifications.permission === "denied") return t("settings.notifSummaryBlocked");
    if (!notifications.enabled) return t("settings.notifSummaryDisabled");
    const m = notifications.reminderMinutes;
    if (m === 60) return t("settings.notifSummaryEnabledHour");
    return t("settings.notifSummaryEnabled", { minutes: m });
  })();
  const encSummary = noteCrypto?.status === "unlocked"
    ? t("settings.encSummaryActive")
    : noteCrypto?.status === "locked"
      ? t("settings.encSummaryLocked")
      : t("settings.encSummaryDisabled");
  const { hasToken: hasCalendarToken } = useCalendarToken();
  const calendarSummary = hasCalendarToken
    ? t("settings.calendarSummarySynced")
    : t("settings.calendarSummaryNotLinked");

  return (
    <div className="page page--reading">
      <AccountHeader
        userName={userName}
        userEmail={userEmail}
        userInitial={userInitial}
        avatarImageUrl={avatarImageUrl}
        readOnly={readOnly}
        onOpenAvatar={() => setActiveSheet("avatar")}
        onEditProfile={() => openSheet("profile")}
      />

      <SubscriptionPanel
        subscription={subscription}
        message={message}
        activeSheet={activeSheet}
        onOpenSheet={openSheet}
        onOpenChangePassword={() => setActiveSheet("changePassword")}
      />

      <AppearancePanel
        theme={theme}
        accentTheme={accentTheme}
        onOpenSheet={openSheet}
      />

      <FeaturesPanel
        groupsEnabled={groupsEnabled}
        groupsToggleLocked={groupsToggleLocked}
        readOnly={readOnly}
        setGroupsEnabled={setGroupsEnabled}
      />

      <NotificationsCalendarPanel
        notifications={notifications}
        readOnly={readOnly}
        bellFx={bellFx}
        notifSummary={notifSummary}
        isPro={isPro}
        calendarSummary={calendarSummary}
        requirePro={requirePro}
        onOpenSheet={setActiveSheet}
      />

      <SecurityPanel
        readOnly={readOnly}
        mfa={mfa}
        passkeys={passkeys}
        noteCrypto={noteCrypto}
        isPro={isPro}
        showEncryptionSetup={showEncryptionSetup}
        encSummary={encSummary}
        onOpenMfa={() => {
          // MfaSheets resets its own code/error state and kicks off
          // enrollment when the enroll sheet opens; here we just route.
          if (mfa.loading) return;
          setActiveSheet(mfa.factors.length === 0 ? "mfaEnroll" : "mfaManage");
        }}
        onOpenPasskeys={() => setActiveSheet("passkeys")}
        onOpenEncryption={() => {
          // Existing-encryption users (status !== "disabled") can
          // always manage / unlock / change their setup, even if
          // they later drop off Pro — we never strand someone
          // outside their already-encrypted notes. Only the
          // brand-new "set up encryption" flow is Pro-gated.
          if (!isPro && noteCrypto.status === "disabled") {
            requirePro?.("encryption");
            return;
          }
          setEncUiError("");
          if (noteCrypto.status === "disabled") { setEncSetupPass1(""); setEncSetupPass2(""); }
          setActiveSheet("encryption");
        }}
      />

      <DataPrivacyPanel
        readOnly={readOnly}
        onOpenExport={() => setActiveSheet("exportData")}
        onOpenPrivacyPolicy={() => navigate("privacy")}
      />

      <HelpPanel
        updateChecking={updateChecking}
        updateStatus={updateStatus}
        onRestartTutorial={restartTutorial}
        onCheckForUpdate={checkForUpdate}
      />

      <DangerZone
        readOnly={readOnly}
        onOpenDiagnostics={() => setActiveSheet("diagnostics")}
        onSignOut={() => setConfirmSignOut(true)}
        onOpenSignOutEverywhere={() => setActiveSheet("signOutEverywhere")}
        onOpenDeleteAccount={() => setActiveSheet("deleteAccount")}
      />

      <div style={{ paddingBottom:24 }} />


      {/* ── NOTIFICATIONS SHEET ──
         Single destination for the row in the Notificaciones section.
         Branches on the same state machine the inline UI used to
         render directly on the Settings page (install gate / blocked /
         active toggle + reminder time). */}
      {activeSheet === "notifications" && (
        <div className="sheet-overlay" onClick={() => setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.notificationsRowTitle")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => setActiveSheet(null)}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              {notifications?.needsInstall ? (
                <PushInstallCard />
              ) : notifications?.permission === "denied" ? (
                <div className="push-amber-card" role="alert" style={{ margin:0 }}>
                  <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
                    <div style={{
                      flexShrink:0, width:36, height:36, borderRadius:"50%",
                      background:"var(--amber)", color:"var(--white)",
                      display:"flex", alignItems:"center", justifyContent:"center",
                    }}>
                      <IconBell size={18} />
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{
                        fontFamily:"var(--font-d)", fontWeight:800,
                        fontSize:"var(--text-md)", color:"var(--charcoal)",
                      }}>
                        {t("notifications.blockedTitle")}
                      </div>
                      <div style={{
                        fontSize:"var(--text-sm)", color:"var(--charcoal-md)",
                        marginTop:4, lineHeight:1.4,
                      }}>
                        {t("notifications.blockedBody")}
                      </div>
                    </div>
                  </div>
                  <ol style={{
                    listStyle:"none", margin:0, padding:0,
                    display:"flex", flexDirection:"column", gap:6,
                  }}>
                    {[
                      t("notifications.blockedStep1"),
                      t("notifications.blockedStep2"),
                      t("notifications.blockedStep3"),
                    ].map((step, i) => (
                      <li key={i} style={{
                        display:"flex", gap:10, alignItems:"center",
                        fontSize:"var(--text-sm)", color:"var(--charcoal)",
                        padding:"6px 8px",
                        background:"rgba(255,255,255,0.55)",
                        borderRadius:8,
                      }}>
                        <span style={{
                          flexShrink:0, width:20, height:20, borderRadius:"50%",
                          background:"var(--amber)", color:"var(--white)",
                          display:"flex", alignItems:"center", justifyContent:"center",
                          fontSize:11, fontWeight:800,
                        }}>{i + 1}</span>
                        <span style={{ lineHeight:1.3 }}>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <>
                  {notifications?.reconciledOff && (
                    <div className="push-inline-banner" style={{ marginBottom:12 }}>
                      <div style={{
                        flexShrink:0, width:22, height:22, borderRadius:"50%",
                        background:"var(--amber)", color:"var(--white)",
                        display:"flex", alignItems:"center", justifyContent:"center",
                        marginTop:2,
                      }}>
                        <IconBell size={12} />
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{
                          fontFamily:"var(--font-d)", fontWeight:700,
                          fontSize:"var(--text-sm)", color:"var(--charcoal)",
                        }}>
                          {t("notifications.reconciledBannerTitle")}
                        </div>
                        <div style={{ fontSize:12, color:"var(--charcoal-md)", marginTop:2, lineHeight:1.35 }}>
                          {t("notifications.reconciledBannerBody")}
                        </div>
                        <button
                          type="button"
                          onClick={handleReconcileReactivate}
                          disabled={togglePending}
                          style={{
                            marginTop:8, height:28, padding:"0 12px",
                            fontSize:12, fontWeight:700,
                            background:"var(--amber)", color:"var(--white)",
                            border:"none", borderRadius:6, cursor: togglePending ? "default" : "pointer",
                            opacity: togglePending ? 0.7 : 1,
                          }}
                        >
                          {t("notifications.reconciledBannerAction")}
                        </button>
                      </div>
                      <button
                        type="button"
                        aria-label={t("close")}
                        onClick={() => notifications.clearReconciliationMessage?.()}
                        style={{
                          flexShrink:0, width:24, height:24, border:"none",
                          background:"transparent", cursor:"pointer",
                          color:"var(--charcoal-xl)",
                          display:"flex", alignItems:"center", justifyContent:"center",
                        }}
                      >
                        <IconX size={12} />
                      </button>
                    </div>
                  )}

                  <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 0", borderBottom:"1px solid var(--border-lt)" }}>
                    <div
                      className={`settings-row-icon${bellFx ? " bell-ring bell-glow" : ""}`}
                      style={{ color:"var(--teal-dark)" }}
                    >
                      <IconBell size={18} />
                    </div>
                    <div style={{ flex:1 }}>
                      <div className="settings-row-title">{t("notifications.sessionReminders")}</div>
                      <div className="settings-row-sub">
                        {notifications?.enabled
                          ? t("notifications.enabled")
                          : t("notifications.sessionRemindersDesc")}
                      </div>
                    </div>
                    <Toggle
                      on={!!notifications?.enabled}
                      onToggle={handleToggleNotifications}
                      disabled={togglePending}
                      ariaLabel={t("notifications.sessionReminders")}
                    />
                  </div>

                  <Expando open={!!notifications?.enabled}>
                    <div style={{ padding:"14px 0 4px" }}>
                      <div style={{
                        fontSize:12, fontWeight:700,
                        color:"var(--charcoal-md)", letterSpacing:0.2,
                        textTransform:"uppercase",
                        margin:"0 2px 8px",
                      }}>
                        {t("notifications.reminderTime")}
                      </div>
                      <SegmentedControl
                        role="group"
                        ariaLabel={t("notifications.reminderTime")}
                        items={[
                          { k: 15, l: "15 min" },
                          { k: 30, l: "30 min" },
                          { k: 60, l: "1 hr" },
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- numeric keys; control compares with ===
                        ] as any}
                        value={notifications?.reminderMinutes}
                        onChange={async (v: Row) => {
                          if (v === notifications?.reminderMinutes) return;
                          haptic.tap();
                          const res = await notifications?.setReminderMinutes(v);
                          if (res && !res.ok) {
                            showToast(t(notifErrorKey(res.code)), "error");
                          }
                        }}
                      />
                    </div>
                    {/* Próximas notificaciones — concrete preview of when
                        reminders will fire over the next 24h based on
                        scheduled sessions + the chosen offset. Closes
                        the "what does my setting actually do" gap. */}
                    <NextRemindersPreview minutes={notifications?.reminderMinutes || 30} />
                  </Expando>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── CALENDAR SHEET ──
         Wraps the existing CalendarLinkPanel (multi-state component)
         so the Settings page only shows a single uniform row. */}
      {activeSheet === "calendar" && (
        <div className="sheet-overlay" onClick={() => setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.calendarLabel")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => setActiveSheet(null)}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              <CalendarLinkPanel readOnly={readOnly} />
            </div>
          </div>
        </div>
      )}

      {/* ── ONLINE PAYMENTS (STRIPE CONNECT) SHEET ── */}
      {activeSheet === "onlinePayments" && (
        <div className="sheet-overlay" onClick={() => setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.onlinePaymentsLabel")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => setActiveSheet(null)}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              <OnlinePaymentsPanel user={user} />
            </div>
          </div>
        </div>
      )}

      {/* ── PROFILE SHEET ── */}
      {activeSheet === "profile" && (
        <div className="sheet-overlay" onClick={() => setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.editProfile")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => setActiveSheet(null)}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              <div className="input-group">
                <label className="input-label">{t("settings.fullName")}</label>
                <input className="input" value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div className="input-group">
                <label className="input-label">{t("settings.email")}</label>
                <input className="input" value={userEmail} disabled style={{ opacity:0.5 }} />
              </div>
              {message && <div style={{ fontSize:12, color:"var(--green)", marginBottom:10, display:"flex", alignItems:"center", gap:4 }}><IconCheck size={14} /> {message}</div>}
              <button className="btn btn-primary-teal" onClick={saveProfile} disabled={saving || !editName.trim()}>
                {saving ? t("saving") : t("save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── AVATAR PICKER SHEET ── */}
      {activeSheet === "avatar" && (
        <AvatarPicker
          user={user}
          currentAvatar={user?.user_metadata?.avatar || null}
          onClose={() => setActiveSheet(null)}
          onSaved={() => {
            refreshUser?.();
            showToast?.(t("saved") || "Guardado");
          }}
        />
      )}

      {/* ── THEME SHEET ── */}
      {activeSheet === "theme" && (
        <div className="sheet-overlay" onClick={() => setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.appearance")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => setActiveSheet(null)}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              {[
                { key: "light", label: t("settings.themeLight"), icon: <IconSun size={18} /> },
                { key: "dark", label: t("settings.themeDark"), icon: <IconMoon size={18} /> },
                { key: "system", label: t("settings.themeSystem"), icon: <IconSmartphone size={18} /> },
              ].map(opt => (
                <div key={opt.key} className="settings-row" style={{ cursor:"pointer" }}
                  onClick={() => { theme?.setPreference(opt.key); setActiveSheet(null); }}>
                  <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}>{opt.icon}</div>
                  <div style={{ flex:1 }}>
                    <div className="settings-row-title">{opt.label}</div>
                  </div>
                  {theme?.preference === opt.key && <IconCheck size={18} style={{ color:"var(--teal)" }} />}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── ACCENT COLOR SHEET ──
         Per-user preference, persisted in localStorage. The swatch
         next to each option is a literal preview of that accent so
         the user sees what they'll get before tapping. */}
      {activeSheet === "accent" && (
        <div className="sheet-overlay" onClick={() => setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.accentColor")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => setActiveSheet(null)}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              {[
                { key: "default",  swatch: "#1F7A8C" },
                { key: "sage",     swatch: "#88BB99" },
                { key: "amber",    swatch: "#D8B26A" },
                { key: "burgundy", swatch: "#BD8595" },
                { key: "steel",    swatch: "#7A8FA3" },
              ].map(opt => (
                <div key={opt.key} className="settings-row" style={{ cursor:"pointer" }}
                  onClick={() => { accentTheme?.setAccent(opt.key); setActiveSheet(null); }}>
                  <div className="settings-row-icon" aria-hidden="true">
                    <span style={{ display:"inline-block", width:18, height:18, borderRadius:"50%", background:opt.swatch, border:"1px solid var(--border-lt)" }} />
                  </div>
                  <div style={{ flex:1 }}>
                    <div className="settings-row-title" style={{ fontWeight:500 }}>{t(`settings.accent.${opt.key}`)}</div>
                  </div>
                  {accentTheme?.accent === opt.key && <IconCheck size={18} style={{ color:"var(--teal)" }} />}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── NATIVE PAYMENT SHEET ──
          Mounted lazily on first use. Stripe Elements lives in here;
          the user never leaves cardigan.mx unless their bank requires
          a 3DS challenge (handled automatically via return_url). */}
      <Suspense fallback={null}>
        {paymentSheetOpen && (
          <StripePaymentSheet
            open={paymentSheetOpen}
            plan={paymentSheetPlan}
            referralCode={paymentSheetReferralCode ?? undefined}
            daysLeftInTrial={subscription?.daysLeftInTrial}
            onClose={() => setPaymentSheetOpen(false)}
            onSuccess={() => {
              setPaymentSheetOpen(false);
              showToast(t("subscription.toastSubscribed"), "success");
              // Sessionstorage stash is single-use — clear so a future
              // sign-up flow on the same device doesn't apply a stale
              // code. The DB already has it persisted on the user's
              // user_subscriptions row at checkout time.
              try { sessionStorage.removeItem("cardigan.referralFromUrl"); }
              catch { /* private mode — no-op */ }
              // Close the parent Suscripción sheet too — the user has
              // just succeeded, no reason to leave them staring at the
              // pre-checkout state.
              setActiveSheet(null);
            }}
          />
        )}
      </Suspense>

      {/* ── SUSCRIPCIÓN SHEET ── */}
      {activeSheet === "plan" && (
        <div className="sheet-overlay" onClick={() => !subBusy && setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.subscriptionTitle")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => !subBusy && setActiveSheet(null)} disabled={subBusy}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              {(() => {
                const s = subscription || {};
                const state = s.accessState || "loading";
                const isComp = s.compGranted;
                const isActive = s.subscribedActive;
                // past_due means a renewal payment failed; Stripe is
                // retrying behind the scenes. We keep the user on Pro
                // for the grace window (it'd be hostile to lock a
                // therapist out mid-week over a single card glitch),
                // but we DO surface a clear amber warning + a one-tap
                // "fix payment" route into the Stripe portal.
                const isPastDue = s.subscription?.status === "past_due";
                // Admin shortcut: accessState === "active" without
                // a paid sub or comp grant is the admin's own row.
                // Treat it as the same "Activa" hero as a real Pro
                // sub so the panel doesn't read as perpetually
                // loading for the admin.
                const isAdminAccess = !isComp && !isActive && state === "active";
                // Reader-app gate: inside the iOS native shell, App Store
                // Guideline 3.1.3(a) forbids pricing, subscribe CTAs, and
                // any "purchase via website" call to action. Existing
                // subscribers can still see status + manage via the
                // Billing Portal (allowed); only the BUY surfaces hide.
                const isIOSReader = isNative() && isIOS();
                // Structured hero summary — drives the icon tone, the
                // emphasized end-date block, the charge chip, and which
                // secondary action (pause / reactivate / none) to show.
                // Admin's accessState=active without sub/comp falls
                // through to "unknown" in the classifier; we override
                // its hero copy below to match the real-Pro presentation.
                const summary = billingSummary(s);
                const tone = summary.tone || "teal";
                const TONE_COLORS: Record<string, { color: string; bg: string }> = {
                  teal:  { color: "var(--teal-dark)", bg: "var(--teal-pale)" },
                  amber: { color: "var(--amber)",     bg: "var(--amber-bg)" },
                  green: { color: "var(--green)",     bg: "var(--green-bg)" },
                  red:   { color: "var(--red)",       bg: "var(--red-bg)" },
                };
                const accentColor = TONE_COLORS[tone].color;
                const accentBg = TONE_COLORS[tone].bg;
                const HeroIcon = isComp ? IconCheck
                  : isPastDue ? IconStar
                  : (summary.state === "cancelling") ? IconStar
                  : isActive ? IconSparkle
                  : summary.state === "expired" ? IconLock
                  : IconStar;
                // For admin access (no sub, no comp), present as
                // comp-style — they have full access and no charges.
                const heroTitle = isAdminAccess
                  ? t("subscription.statusActiveTitle")
                  : t(summary.title);
                const adminCaption = isAdminAccess ? t("subscription.compExplain") : null;
                return (
                  <>
                    {/* ── Hero card — structured layout: tone-tinted bg, icon
                          medallion, title, divider, emphasized end-date block
                          (caption + big date), and a charge chip. Each piece
                          carries one piece of the "what's happening" answer
                          rather than one dense sentence. Active subs land
                          here whether they're renewing or cancelling — the
                          tone (teal vs amber) + chip text differentiate. */}
                    <div style={{
                      padding: !isComp && !isActive && !isAdminAccess ? "22px 18px 22px" : "22px 18px",
                      borderRadius: "var(--radius-lg, 16px)",
                      marginBottom: 16,
                      background: accentBg,
                      textAlign: "center",
                    }}>
                      <div style={{ width:56, height:56, borderRadius:"50%",
                        display:"flex", alignItems:"center", justifyContent:"center",
                        background:"var(--white)", color: accentColor, margin:"0 auto 12px",
                        boxShadow:"var(--shadow-sm)" }}>
                        <HeroIcon size={24} />
                      </div>
                      <div style={{ fontFamily:"var(--font-d)", fontSize:18, fontWeight:800, color:"var(--charcoal)", letterSpacing:"-0.3px", lineHeight:1.2 }}>
                        {heroTitle}
                      </div>

                      {/* Admin shortcut: replicate the comp-style explanation
                          (no charges, full access) since admins fall through
                          billingSummary to "unknown". */}
                      {isAdminAccess && adminCaption && (
                        <div style={{ fontSize:13, color:"var(--charcoal-md)", marginTop:8, lineHeight:1.5 }}>
                          {adminCaption}
                        </div>
                      )}

                      {/* End-date block — the date is the most consequential
                          piece of info on this card, so it gets display-font
                          weight and size. The caption above ("Próximo cobro"
                          / "Pierdes acceso a Pro" / "Tu prueba termina") tells
                          the user what the date means. */}
                      {summary.endLabel && summary.endCaption && !isAdminAccess && (
                        <div style={{ marginTop:16, paddingTop:14, borderTop:"1px solid rgba(0,0,0,0.07)" }}>
                          <div style={{ fontSize:11, color:"var(--charcoal-xl)", letterSpacing:"0.05em", textTransform:"uppercase", fontWeight:700 }}>
                            {t(summary.endCaption)}
                          </div>
                          <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--charcoal)", letterSpacing:"-0.4px", marginTop:4, lineHeight:1.15 }}>
                            {summary.endLabel}
                          </div>
                        </div>
                      )}

                      {/* Charge chip — the unambiguous "this is what's
                          happening to your money". Tone-colored pill so a
                          glance separates "$149 every month" (positive)
                          from "Sin cobros futuros" (warning). */}
                      {summary.chipText && !isAdminAccess && (() => {
                        const chipMap: Record<string, { color: string; bg: string }> = {
                          positive: { color: "var(--green)",   bg: "var(--green-bg)" },
                          warning:  { color: "var(--amber)",   bg: "var(--amber-bg)" },
                          danger:   { color: "var(--red)",     bg: "var(--red-bg)" },
                          neutral:  { color: "var(--charcoal-md)", bg: "rgba(0,0,0,0.05)" },
                        };
                        const c = chipMap[summary.chipTone] || chipMap.neutral;
                        const text = summary.chipText.startsWith("subscription.")
                          ? t(summary.chipText)
                          : summary.chipText;
                        return (
                          <div style={{
                            display:"inline-block", marginTop:14,
                            padding:"6px 14px", borderRadius:999,
                            background:c.bg, color:c.color,
                            fontSize:12, fontWeight:700, letterSpacing:"0.01em",
                          }}>
                            {text}
                          </div>
                        );
                      })()}

                      {/* Price line — checkout flow only. Lives inside the
                          hero so the user perceives value + cost together. */}
                      {!isComp && !isActive && !isAdminAccess && !isIOSReader && (
                        <div style={{ marginTop:18, paddingTop:14, borderTop:"1px solid rgba(0,0,0,0.07)" }}>
                          <div style={{ display:"flex", alignItems:"baseline", justifyContent:"center", gap:6 }}>
                            <span style={{ fontFamily:"var(--font-d)", fontSize:34, fontWeight:800, color:"var(--charcoal)", letterSpacing:"-1px", lineHeight:1 }}>
                              ${selectedPlan === "annual" ? "1,490" : "149"}
                            </span>
                            <span style={{ fontSize:13, color:"var(--charcoal-md)", fontWeight:600 }}>
                              {selectedPlan === "annual"
                                ? t("subscription.priceUnitAnnual")
                                : t("subscription.priceUnit")}
                            </span>
                          </div>
                          <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginTop:6 }}>
                            {selectedPlan === "annual"
                              ? t("subscription.priceExplainAnnual")
                              : t("subscription.priceExplain")}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Billing-cycle toggle — only when there's a sale to make.
                        Annual carries a small "ahorra 17%" badge underneath so
                        the discount registers without visual clutter on the
                        toggle itself. */}
                    {!isComp && !isActive && !isAdminAccess && !isIOSReader && (
                      <div style={{ marginBottom:14 }}>
                        <SegmentedControl
                          items={[
                            { k: "monthly", l: t("subscription.pricingToggleMonthly") },
                            { k: "annual", l: t("subscription.pricingToggleAnnual") },
                          ]}
                          value={selectedPlan}
                          onChange={setSelectedPlan}
                          ariaLabel={t("subscription.pricingToggleAriaLabel")}
                        />
                        {selectedPlan === "annual" && (
                          <div style={{ fontSize:12, color:"var(--green)", textAlign:"center", marginTop:8, fontWeight:700 }}>
                            {t("subscription.annualSavingsBadge")}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Latest-invoice row — styled as a quiet card so it
                        reads as a "tap to view" affordance rather than
                        a stray underlined link. */}
                    {isActive && !isPastDue && s.subscription?.hosted_invoice_url && (
                      <a href={s.subscription.hosted_invoice_url}
                        target="_blank" rel="noopener noreferrer"
                        style={{
                          display:"flex", alignItems:"center", justifyContent:"space-between",
                          padding:"12px 14px", marginBottom:14,
                          borderRadius:"var(--radius)",
                          background:"var(--white)",
                          border:"1px solid var(--border)",
                          color:"var(--charcoal)", textDecoration:"none",
                          fontSize:13, fontWeight:600,
                        }}>
                        <span>{t("subscription.viewLatestReceipt")}</span>
                        <span style={{ color:"var(--teal-dark)", fontSize:14 }}>→</span>
                      </a>
                    )}

                    {/* Invite-code input — only when not yet subscribed
                        AND the code wasn't auto-captured from a ?ref=<code>
                        URL. Visitors who arrived via a friend's referral
                        link don't see this field at all; the code is
                        already in inviteCodeInput from sessionStorage and
                        flows through to handleStartCheckout invisibly.
                        Word-of-mouth users (who never hit a ?ref URL)
                        still see the field and can type their code in. */}
                    {!isComp && !isActive && !isAdminAccess && !isIOSReader && !inviteCodeFromUrl && (
                      <div className="input-group" style={{ marginBottom:14 }}>
                        <label className="input-label">{t("subscription.inviteCodeLabel")}</label>
                        <input
                          type="text"
                          className="input"
                          autoCapitalize="characters"
                          autoComplete="off"
                          maxLength={16}
                          placeholder={t("subscription.inviteCodePlaceholder")}
                          value={inviteCodeInput}
                          onChange={(e) => setInviteCodeInput(e.target.value.toUpperCase())}
                          disabled={subBusy}
                          style={{ letterSpacing:"0.08em", fontWeight:600 }}
                        />
                        <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginTop:6, lineHeight:1.4 }}>
                          {t("subscription.inviteCodeHint")}
                        </div>
                      </div>
                    )}

                    {subError && <div style={{ fontSize:13, color:"var(--red)", marginBottom:10 }}>{subError}</div>}

                    {/* Primary action — full-width charcoal button on its own row.
                        Active subs swap to "Administrar" pointing at the Stripe portal. */}
                    {(!isComp && !isActive && !isAdminAccess && !isIOSReader) && (
                      <div style={{ marginBottom:22 }}>
                        <button type="button" className="btn btn-primary"
                          onClick={handleStartCheckout} disabled={subBusy}>
                          {subBusy ? t("loading") : t("subscription.subscribeCta")}
                        </button>
                        <div style={{ fontSize:11, color:"var(--charcoal-xl)", textAlign:"center", marginTop:8, lineHeight:1.4 }}>
                          {t("subscription.checkoutFooter")}
                        </div>
                      </div>
                    )}
                    {/* iOS reader-app substitute — informational only.
                        No button, no link, no pricing — strictly what
                        App Store Guideline 3.1.3(a) permits. */}
                    {(!isComp && !isActive && !isAdminAccess && isIOSReader) && (
                      <div style={{
                        marginBottom: 22,
                        padding: "14px 16px",
                        background: "var(--cream)",
                        borderRadius: "var(--radius)",
                        fontSize: 13, color: "var(--charcoal-md)",
                        lineHeight: 1.5, textAlign: "center",
                      }}>
                        {t("subscription.iosReaderHint")}
                      </div>
                    )}
                    {isActive && !isComp && (
                      <div style={{ marginBottom:22 }}>
                        {/* Primary — label adapts to state. Cancelling subs
                            see "Reactivar" (the most relevant action they
                            could take); past-due see "Actualizar método de
                            pago" (the urgent one); renewing see the generic
                            "Administrar". All routes go to the same Stripe
                            Billing Portal — Stripe surfaces the right
                            in-portal flow based on sub state. */}
                        <button type="button" className="btn btn-primary"
                          onClick={handleOpenPortal} disabled={subBusy}>
                          {subBusy ? t("loading")
                            : summary.primaryCta
                              ? t(summary.primaryCta)
                              : t("subscription.managePortalCta")}
                        </button>
                        <div style={{ fontSize:11, color:"var(--charcoal-xl)", textAlign:"center", marginTop:8, lineHeight:1.4 }}>
                          {t("subscription.portalFooter")}
                        </div>
                        {/* Pause-subscription link — only when the sub is
                            actively renewing. Hidden for cancelling subs
                            (they're already winding down — pause is
                            redundant + confusing) and past_due (urgency
                            should be on fixing payment). */}
                        {summary.secondaryCta === "subscription.pauseCta" && (
                          <>
                            <button type="button" className="btn btn-ghost"
                              onClick={handleOpenPortal} disabled={subBusy}
                              style={{ width:"100%", marginTop:10, fontSize:13 }}>
                              {t("subscription.pauseCta")}
                            </button>
                            <div style={{ fontSize:11, color:"var(--charcoal-xl)", textAlign:"center", marginTop:4, lineHeight:1.4 }}>
                              {t("subscription.pauseHint")}
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Value-realization widget — only for active subs that have
                        enough historic data. The helper short-circuits to null
                        below the threshold, so the widget self-hides for
                        brand-new accounts without ceremony. */}
                    {isActive && !isComp && <ProValueWidget />}

                    {/* Invoice history — last 6 paid invoices, populated by the
                        webhook on each invoice.paid. Empty for accounts that
                        predate the stripe_invoices table; the Stripe portal
                        link in the next-charge widget covers historical
                        receipts for those users. */}
                    {isActive && !isComp && Array.isArray(s.invoices) && s.invoices.length > 0 && (
                      <div style={{ marginBottom:14 }}>
                        <div style={{ fontSize:12, fontWeight:700, color:"var(--charcoal-md)", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:8 }}>
                          {t("subscription.invoiceHistoryTitle")}
                        </div>
                        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                          {s.invoices.map((inv: Row) => {
                            const date = formatDate(inv.paid_at, "shortYear");
                            const amount = `${formatMXNCents(inv.amount_cents)}`;
                            const link = inv.hosted_invoice_url || inv.pdf_url;
                            return (
                              <a key={inv.id}
                                href={link || "#"}
                                target={link ? "_blank" : undefined}
                                rel={link ? "noopener noreferrer" : undefined}
                                onClick={(e) => { if (!link) e.preventDefault(); }}
                                style={{
                                  display:"flex", alignItems:"center", justifyContent:"space-between",
                                  padding:"10px 12px",
                                  background:"var(--white)",
                                  border:"1px solid var(--border)",
                                  borderRadius:"var(--radius)",
                                  textDecoration:"none",
                                  color:"var(--charcoal)",
                                  fontSize:13,
                                }}>
                                <span>{date}</span>
                                <span style={{ display:"flex", alignItems:"center", gap:8 }}>
                                  <span style={{ fontWeight:700 }}>{amount}</span>
                                  {link && <span style={{ color:"var(--teal-dark)", fontSize:12 }}>{t("subscription.invoiceView")} →</span>}
                                </span>
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Recovery affordance — only relevant when there's a
                        Stripe-side sub to reconcile. Tiny, subtle, lives at
                        the bottom of the sheet so it doesn't compete with
                        the primary actions. The hint is intentionally short
                        — users who don't recognize the situation will scroll
                        past; users with stale state recognize it instantly. */}
                    {isActive && !isComp && (
                      <div style={{ marginTop:24, paddingTop:14, borderTop:"1px solid var(--border-lt)", textAlign:"center" }}>
                        <button type="button"
                          onClick={handleSyncWithStripe} disabled={syncBusy || subBusy}
                          style={{
                            background:"transparent", border:"none",
                            color: syncDone ? "var(--green)" : "var(--charcoal-xl)",
                            fontSize:11, cursor:"pointer", padding:"4px 8px",
                            fontWeight: 500,
                          }}>
                          {syncBusy ? t("subscription.syncing")
                            : syncDone ? `✓ ${t("subscription.syncDone")}`
                            : `↻ ${t("subscription.syncCta")}`}
                        </button>
                      </div>
                    )}

                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── REFERRAL SHEET ── Dedicated sheet for the invite-and-earn
            program. Lives at the top level of Settings (Cuenta section)
            so users find it without going through the Suscripción flow.
            The hero centers the user's code on a teal-tinted surface;
            the rewards line below gives them a sense of progress. */}
      {activeSheet === "referral" && (
        <div className="sheet-overlay" onClick={() => setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.referralRowTitle")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => setActiveSheet(null)}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              {(() => {
                const info = subscription?.referralInfo;
                return (
                  <>
                    <div style={{
                      padding:"22px 18px",
                      borderRadius:"var(--radius-lg, 16px)",
                      background:"var(--teal-pale)",
                      textAlign:"center",
                      marginBottom:14,
                    }}>
                      <div style={{ width:52, height:52, borderRadius:"50%",
                        display:"flex", alignItems:"center", justifyContent:"center",
                        background:"var(--white)", color:"var(--teal-dark)",
                        margin:"0 auto 10px", boxShadow:"var(--shadow-sm)" }}>
                        <IconUsers size={22} />
                      </div>
                      <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:800, color:"var(--charcoal)", letterSpacing:"-0.2px" }}>
                        {t("subscription.referralTitle")}
                      </div>
                      <div style={{ fontSize:13, color:"var(--charcoal-md)", marginTop:6, lineHeight:1.5 }}>
                        {t("subscription.referralExplain")}
                      </div>
                    </div>

                    <div style={{ display:"flex", alignItems:"center", gap:8, padding:"14px 16px", background:"var(--white)", border:"1px solid var(--border)", borderRadius:"var(--radius)", marginBottom:14 }}>
                      <div style={{ flex:1, fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--charcoal)", letterSpacing:"0.2em" }}>
                        {info?.code || (subscription?.referralLoading ? "…" : "—")}
                      </div>
                      <button type="button" className="btn btn-ghost" onClick={copyReferralCode}
                        disabled={!info?.code}
                        style={{ minWidth:96, height:36, fontSize:"var(--text-sm)" }}>
                        {referralCopied ? t("subscription.shareCopied") : t("subscription.shareCopyLink")}
                      </button>
                    </div>

                    {/* Native + per-channel share. The OS share sheet
                        (navigator.share) covers every app the user has
                        installed — Messages, Mail, Telegram, IG, Notes,
                        AirDrop, etc. — and is the primary CTA when
                        available. The icon row below it is the direct
                        path for the most common Mexican channels and
                        the desktop fallback. Each path tracks a
                        `referral_share` event with the channel name
                        for funnel analysis. */}
                    {info?.code && <ReferralShareBlock code={info.code} t={t} />}
                    {info && info.rewardsCount > 0 && (
                      <div style={{ fontSize:13, color:"var(--charcoal-md)", lineHeight:1.5, padding:"4px 4px 0" }}>
                        {info.pendingCreditCents > 0
                          ? t("subscription.referralRewardsPending", {
                              n: info.rewardsCount,
                              credit: `${formatMXNCents(info.pendingCreditCents)}`,
                            })
                          : t("subscription.referralRewardsApplied", { n: info.rewardsCount })}
                      </div>
                    )}

                    {/* Leaderboard — invitees who actually converted, with
                        a relative timestamp. The names are intentionally
                        absent (we don't share emails between users); the
                        list anchors the rewards count in something the
                        user can see and feel. */}
                    {Array.isArray(subscription?.referralLeaderboard) && subscription.referralLeaderboard.length > 0 && (
                      <div style={{ marginTop:18 }}>
                        <div style={{ fontSize:12, fontWeight:700, color:"var(--charcoal-md)", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:8 }}>
                          {t("subscription.referralLeaderboardTitle")}
                        </div>
                        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                          {subscription.referralLeaderboard.map((row: Row, idx: number) => (
                            <div key={row.id} style={{
                              display:"flex", alignItems:"center", justifyContent:"space-between",
                              padding:"10px 12px",
                              background:"var(--white)",
                              border:"1px solid var(--border)",
                              borderRadius:"var(--radius)",
                              fontSize:13,
                              color:"var(--charcoal)",
                            }}>
                              <span>
                                {t("subscription.referralLeaderboardRow", { n: idx + 1 })}
                              </span>
                              <span style={{ color:"var(--charcoal-md)", fontSize:12 }}>
                                {relativeTime(row.credited_at)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── ENCRYPTION SHEET (state-aware wrapper) ──
         Single sheet that adapts to noteCrypto.status. Replaces the
         old encSetup / encStatus / encChange-row / encDisable-row
         pile that used to render up to four conditional rows on the
         main Settings page. */}
      {activeSheet === "encryption" && (
        <div className="sheet-overlay" onClick={() => !encBusy && setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.encryptionTitle")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => !encBusy && setActiveSheet(null)} disabled={encBusy}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              {noteCrypto?.status === "disabled" && (
                <>
                  <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.55, marginBottom: 14 }}>
                    {t("settings.encSetupExplain")}
                  </div>
                  <div className="input-group" style={{ marginBottom: 12 }}>
                    <label className="input-label">{t("settings.encNewPassphrase")}</label>
                    <PasswordInput autoComplete="new-password" value={encSetupPass1} onChange={(e) => setEncSetupPass1(e.target.value)} disabled={encBusy} />
                  </div>
                  <div className="input-group" style={{ marginBottom: 14 }}>
                    <label className="input-label">{t("settings.encConfirmPassphrase")}</label>
                    <PasswordInput autoComplete="new-password" value={encSetupPass2} onChange={(e) => setEncSetupPass2(e.target.value)} disabled={encBusy} />
                  </div>
                  {encUiError && <div role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{encUiError}</div>}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <button type="button" className="btn btn-primary" onClick={submitEncryptionSetup} disabled={encBusy || encSetupPass1.length < 8}>
                      {encBusy ? t("loading") : t("settings.encEnableCta")}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setActiveSheet(null)} disabled={encBusy}>
                      {t("cancel")}
                    </button>
                  </div>
                </>
              )}
              {noteCrypto?.status === "locked" && (
                <>
                  <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px", background:"var(--cream)", borderRadius:"var(--radius)", marginBottom:14 }}>
                    <div style={{ color:"var(--charcoal-md)" }}><IconLock size={18} /></div>
                    <div style={{ fontSize:13, color:"var(--charcoal)", fontWeight:600 }}>{t("settings.encStatusLocked")}</div>
                  </div>
                  <div style={{ fontSize:13, color:"var(--charcoal-md)", lineHeight:1.55 }}>
                    {t("settings.encLockedHint")}
                  </div>
                </>
              )}
              {noteCrypto?.status === "unlocked" && (
                <>
                  <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px", background:"var(--green-bg)", borderRadius:"var(--radius)", marginBottom:14 }}>
                    <div style={{ color:"var(--green)" }}><IconCheck size={18} /></div>
                    <div style={{ fontSize:13, color:"var(--charcoal)", fontWeight:600 }}>{t("settings.encStatusUnlocked")}</div>
                  </div>
                  <div style={{ fontSize:14, color:"var(--charcoal-md)", lineHeight:1.55, marginBottom:14 }}>
                    {t("settings.encryptionUnlockedExplain")}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    <button type="button" className="btn btn-ghost"
                      onClick={() => { setEncUiError(""); setEncChangeNew1(""); setEncChangeNew2(""); setActiveSheet("encChange"); }}>
                      {t("settings.encChange")}
                    </button>
                    <button type="button" className="btn btn-ghost"
                      style={{ color:"var(--red)", borderColor:"var(--red)" }}
                      onClick={() => { setEncUiError(""); setEncConfirmDisable(""); setActiveSheet("encDisable"); }}>
                      {t("settings.encDisable")}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── ENCRYPTION CHANGE PASSPHRASE SHEET ── */}
      {activeSheet === "encChange" && (
        <div className="sheet-overlay" onClick={() => !encBusy && setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.encChange")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => !encBusy && setActiveSheet(null)} disabled={encBusy}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              <div className="input-group" style={{ marginBottom: 12 }}>
                <label className="input-label">{t("settings.encNewPassphrase")}</label>
                <PasswordInput autoComplete="new-password" value={encChangeNew1} onChange={(e) => setEncChangeNew1(e.target.value)} disabled={encBusy} />
              </div>
              <div className="input-group" style={{ marginBottom: 14 }}>
                <label className="input-label">{t("settings.encConfirmPassphrase")}</label>
                <PasswordInput autoComplete="new-password" value={encChangeNew2} onChange={(e) => setEncChangeNew2(e.target.value)} disabled={encBusy} />
              </div>
              {encUiError && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{encUiError}</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button type="button" className="btn btn-primary" onClick={submitEncryptionChange} disabled={encBusy || encChangeNew1.length < 8}>
                  {encBusy ? t("loading") : t("settings.encChangeCta")}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setActiveSheet(null)} disabled={encBusy}>
                  {t("cancel")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── ENCRYPTION DISABLE SHEET ── */}
      {activeSheet === "encDisable" && (
        <div className="sheet-overlay" onClick={() => !encBusy && setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.encDisable")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => !encBusy && setActiveSheet(null)} disabled={encBusy}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              <div style={{ background: "var(--red-pale, #fdecea)", color: "var(--red-dark, #922)", padding: "10px 14px", borderRadius: "var(--radius)", fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
                {t("settings.encDisableWarning")}
              </div>
              <div className="input-group" style={{ marginBottom: 14 }}>
                <label className="input-label">{t("settings.encDisableConfirmLabel")}</label>
                <input
                  className="input"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  value={encConfirmDisable}
                  onChange={(e) => setEncConfirmDisable(e.target.value)}
                  placeholder="DESCIFRAR"
                  disabled={encBusy}
                />
              </div>
              {encUiError && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{encUiError}</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={submitEncryptionDisable}
                  disabled={encBusy || encConfirmDisable !== "DESCIFRAR"}
                  style={{ background: "var(--red)", color: "var(--white)" }}
                >
                  {encBusy ? t("loading") : t("settings.encDisableCta")}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setActiveSheet(null)} disabled={encBusy}>
                  {t("cancel")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete-account (ARCO Cancelación) — confirm/reauth/captcha state +
          handler extracted to DeleteAccountSheet. */}
      <DeleteAccountSheet
        open={activeSheet === "deleteAccount"}
        onClose={() => setActiveSheet(null)}
        signOut={signOut}
        setSheetPanel={setSheetPanel}
        sheetPanelHandlers={sheetPanelHandlers}
      />

      {/* MFA enroll + manage sheets (state + JSX extracted to MfaSheets;
          the shared `mfa` instance + sheet-trap wiring are passed in). */}
      <MfaSheets
        mode={activeSheet === "mfaEnroll" ? "enroll" : activeSheet === "mfaManage" ? "manage" : null}
        mfa={mfa}
        onClose={() => setActiveSheet(null)}
        showToast={showToast}
        setSheetPanel={setSheetPanel}
        sheetPanelHandlers={sheetPanelHandlers}
      />


      {/* Passkey list + add/remove (sheet JSX, remove-confirm dialog, and
          passkeyRemoveId state extracted to PasskeysSheet; the shared
          usePasskeys() instance is passed in). */}
      <PasskeysSheet
        open={activeSheet === "passkeys"}
        onClose={() => setActiveSheet(null)}
        passkeys={passkeys}
        showToast={showToast}
        setSheetPanel={setSheetPanel}
        sheetPanelHandlers={sheetPanelHandlers}
      />

      {/* Sign out of every device (extracted; stateless). */}
      <SignOutEverywhereSheet
        open={activeSheet === "signOutEverywhere"}
        onClose={() => setActiveSheet(null)}
        signOut={signOut}
        setSheetPanel={setSheetPanel}
        sheetPanelHandlers={sheetPanelHandlers}
      />

      {/* Captcha-gated password-reset email (state + flow extracted to
          ChangePasswordSheet; it owns its own saving/captcha state). */}
      <ChangePasswordSheet
        open={activeSheet === "changePassword"}
        onClose={() => setActiveSheet(null)}
        userEmail={userEmail}
        setMessage={setMessage}
        setSheetPanel={setSheetPanel}
        sheetPanelHandlers={sheetPanelHandlers}
      />

      {/* Export-my-data (ARCO Acceso) — reauth/captcha state + handler
          extracted to ExportDataSheet. */}
      <ExportDataSheet
        open={activeSheet === "exportData"}
        onClose={() => setActiveSheet(null)}
        showToast={showToast}
        setSheetPanel={setSheetPanel}
        sheetPanelHandlers={sheetPanelHandlers}
      />

      <ConfirmDialog
        open={confirmSignOut}
        title={t("nav.signOut")}
        body={t("nav.signOutConfirm")}
        confirmLabel={t("nav.signOut")}
        destructive
        onConfirm={() => { setConfirmSignOut(false); signOut(); }}
        onCancel={() => setConfirmSignOut(false)}
      />

      <DiagnosticsSheet
        open={activeSheet === "diagnostics"}
        onClose={() => setActiveSheet(null)}
        notifications={notifications}
      />
    </div>
  );
}
