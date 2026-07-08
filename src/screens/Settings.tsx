import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import { supabase } from "../supabaseClient";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- boundary: untyped domain/hook data
type Row = any;
import { openExternal } from "../lib/nativeBrowser";
import { DiagnosticsSheet } from "../components/sheets/DiagnosticsSheet";
// Lazy-loaded so Stripe.js + the PaymentElement bundle aren't pulled
// into the main chunk for users who never open the payment sheet.
const StripePaymentSheet = lazy(() => import("../components/StripePaymentSheet"));
import { IconX } from "../components/Icons";
import { AccountHeader } from "./settings/AccountHeader";
import { MfaSheets } from "./settings/sheets/MfaSheets";
import { ChangePasswordSheet } from "./settings/sheets/ChangePasswordSheet";
import { PasskeysSheet } from "./settings/sheets/PasskeysSheet";
import { SignOutEverywhereSheet } from "./settings/sheets/SignOutEverywhereSheet";
import { ExportDataSheet } from "./settings/sheets/ExportDataSheet";
import { DeleteAccountSheet } from "./settings/sheets/DeleteAccountSheet";
import { EncryptionSheets } from "./settings/sheets/EncryptionSheets";
import { NotificationsSheet } from "./settings/sheets/NotificationsSheet";
import { PlanSheet } from "./settings/sheets/PlanSheet";
import { ReferralSheet } from "./settings/sheets/ReferralSheet";
import { ProfileSheet } from "./settings/sheets/ProfileSheet";
import { AppearanceSheets } from "./settings/sheets/AppearanceSheets";
import { PanelSheet } from "./settings/sheets/PanelSheet";
import { SubscriptionPanel } from "./settings/SubscriptionPanel";
import { AppearancePanel } from "./settings/AppearancePanel";
import { FeaturesPanel } from "./settings/FeaturesPanel";
import { NotificationsCalendarPanel } from "./settings/NotificationsCalendarPanel";
import { WidgetsPanel } from "./settings/WidgetsPanel";
import { SecurityPanel } from "./settings/SecurityPanel";
import { DataPrivacyPanel } from "./settings/DataPrivacyPanel";
import { HelpPanel } from "./settings/HelpPanel";
import { DangerZone } from "./settings/DangerZone";
import { MONETIZATION_ENABLED } from "../config/monetization";
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
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useSheetDrag } from "../hooks/useSheetDrag";
import { useCardigan } from "../context/CardiganContext";
import { useHapticsEnabled } from "../hooks/useHapticsEnabled";
import { isClinicalProfession } from "../data/constants";
import { haptic } from "../utils/haptics";
import { notifErrorKey } from "./settings/sheets/notifErrorKey";

type SettingsProps = {
  user?: Row;
  signOut: (scope?: string) => void | Promise<void>;
  refreshUser?: () => void;
};

export function Settings({ user, signOut, refreshUser }: SettingsProps) {
  const { t } = useT();
  const { tutorial, navigate, theme, accentTheme, fontScale, notifications, showToast, readOnly, noteCrypto, profession, setHideFab, subscription, requirePro, groups, groupsEnabled, setGroupsEnabled } = useCardigan();
  // Vibration preference — per-device (localStorage), no context plumbing;
  // the flag lives in utils/haptics.ts and applies app-wide instantly.
  const { hapticsEnabled, setHapticsEnabled } = useHapticsEnabled();
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
      // Profile save only updates user_metadata.full_name — no email is
      // sent. The old "Enlace enviado a tu correo" copy was wrong here
      // (it's the password-reset string). (bug-hunt: wrong success msg)
      setMessage(t("saved"));
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
  // The passphrase/confirm/busy/error state + the setup/change/disable
  // handlers live in EncryptionSheets now.

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
        fontScale={fontScale}
        onOpenSheet={openSheet}
      />

      <FeaturesPanel
        groupsEnabled={groupsEnabled}
        groupsToggleLocked={groupsToggleLocked}
        readOnly={readOnly}
        setGroupsEnabled={setGroupsEnabled}
        hapticsEnabled={hapticsEnabled}
        setHapticsEnabled={setHapticsEnabled}
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
          // (EncryptionSheets resets its fields on open.)
          if (!isPro && noteCrypto.status === "disabled") {
            requirePro?.("encryption");
            return;
          }
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
      <NotificationsSheet
        open={activeSheet === "notifications"}
        notifications={notifications}
        togglePending={togglePending}
        bellFx={bellFx}
        handleToggleNotifications={handleToggleNotifications}
        handleReconcileReactivate={handleReconcileReactivate}
        showToast={showToast}
        setActiveSheet={setActiveSheet}
        setSheetPanel={setSheetPanel}
        sheetPanelHandlers={sheetPanelHandlers}
      />

      {/* ── CALENDAR SHEET ──
         Wraps the existing CalendarLinkPanel (multi-state component)
         so the Settings page only shows a single uniform row. */}
      <PanelSheet
        open={activeSheet === "calendar"}
        title={t("settings.calendarLabel")}
        onClose={() => setActiveSheet(null)}
        setSheetPanel={setSheetPanel}
        sheetPanelHandlers={sheetPanelHandlers}
      >
        <CalendarLinkPanel readOnly={readOnly} />
      </PanelSheet>

      {/* ── iOS WIDGETS SHEET ──
         Only reachable from the widgets row, which itself renders only
         inside the native iOS shell. */}
      <PanelSheet
        open={activeSheet === "widgets"}
        title={t("settings.widgetsLabel")}
        onClose={() => setActiveSheet(null)}
        setSheetPanel={setSheetPanel}
        sheetPanelHandlers={sheetPanelHandlers}
      >
        <WidgetsPanel readOnly={readOnly} />
      </PanelSheet>

      {/* ── ONLINE PAYMENTS (STRIPE CONNECT) SHEET ── */}
      <PanelSheet
        open={activeSheet === "onlinePayments"}
        title={t("settings.onlinePaymentsLabel")}
        onClose={() => setActiveSheet(null)}
        setSheetPanel={setSheetPanel}
        sheetPanelHandlers={sheetPanelHandlers}
      >
        <OnlinePaymentsPanel user={user} />
      </PanelSheet>

      {/* ── PROFILE SHEET ── */}
      <ProfileSheet
        open={activeSheet === "profile"}
        editName={editName}
        setEditName={setEditName}
        userEmail={userEmail}
        message={message}
        saving={saving}
        saveProfile={saveProfile}
        setActiveSheet={setActiveSheet}
        setSheetPanel={setSheetPanel}
        sheetPanelHandlers={sheetPanelHandlers}
      />

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

      {/* ── APARIENCIA (tema) + COLOR DE ACENTO + TAMAÑO DE TEXTO sheets ──
         One mode-driven component covers the three option-list sheets. */}
      <AppearanceSheets
        mode={activeSheet === "theme" ? "theme" : activeSheet === "accent" ? "accent" : activeSheet === "fontScale" ? "fontScale" : activeSheet === "language" ? "language" : null}
        theme={theme}
        accentTheme={accentTheme}
        fontScale={fontScale}
        onClose={() => setActiveSheet(null)}
        setSheetPanel={setSheetPanel}
        sheetPanelHandlers={sheetPanelHandlers}
      />

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

      {/* ── SUSCRIPCIÓN SHEET (presentational; state + checkout/portal/sync
          handlers stay in Settings and are threaded in as props). ── */}
      <PlanSheet
        open={activeSheet === "plan"}
        subscription={subscription}
        subBusy={subBusy}
        subError={subError}
        selectedPlan={selectedPlan}
        setSelectedPlan={setSelectedPlan}
        inviteCodeInput={inviteCodeInput}
        setInviteCodeInput={setInviteCodeInput}
        inviteCodeFromUrl={inviteCodeFromUrl}
        syncBusy={syncBusy}
        syncDone={syncDone}
        handleStartCheckout={handleStartCheckout}
        handleOpenPortal={handleOpenPortal}
        handleSyncWithStripe={handleSyncWithStripe}
        setActiveSheet={setActiveSheet}
        setSheetPanel={setSheetPanel}
        sheetPanelHandlers={sheetPanelHandlers}
      />

      {/* ── REFERRAL SHEET ── Dedicated sheet for the invite-and-earn
            program. Lives at the top level of Settings (Cuenta section)
            so users find it without going through the Suscripción flow.
            The hero centers the user's code on a teal-tinted surface;
            the rewards line below gives them a sense of progress. */}
      <ReferralSheet
        open={activeSheet === "referral"}
        subscription={subscription}
        referralCopied={referralCopied}
        copyReferralCode={copyReferralCode}
        setActiveSheet={setActiveSheet}
        setSheetPanel={setSheetPanel}
        sheetPanelHandlers={sheetPanelHandlers}
      />

      {/* Note-encryption setup / change / disable (state + handlers extracted
          to EncryptionSheets; the shared noteCrypto bag is passed in). */}
      <EncryptionSheets
        mode={activeSheet === "encryption" ? "main" : activeSheet === "encChange" ? "change" : activeSheet === "encDisable" ? "disable" : null}
        onClose={() => setActiveSheet(null)}
        onNavigate={(m) => setActiveSheet(m === "change" ? "encChange" : "encDisable")}
        noteCrypto={noteCrypto}
        showToast={showToast}
        setSheetPanel={setSheetPanel}
        sheetPanelHandlers={sheetPanelHandlers}
      />

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
        hapticOnOpen={false}
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
