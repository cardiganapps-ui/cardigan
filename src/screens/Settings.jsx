import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import { supabase } from "../supabaseClient";
// Lazy-loaded so Stripe.js + the PaymentElement bundle aren't pulled
// into the main chunk for users who never open the payment sheet.
const StripePaymentSheet = lazy(() => import("../components/StripePaymentSheet"));
import { IconUser, IconUsers, IconStar, IconKey, IconLogOut, IconChevron, IconX, IconCheck, IconSun, IconMoon, IconSmartphone, IconBell, IconEdit, IconRefresh, IconDownload, IconTrash, IconShield, IconLock, IconSparkle, IconCalendar, IconDocument, IconMail } from "../components/Icons";
import { ProValueWidget } from "../components/ProValueWidget";

// Spanish "hace X" relative time for the referral leaderboard. Days
// rounded down so "hace 1 día" doesn't slip to "hace 0 días" on the
// 23rd hour. Anything older than 30 days falls back to a calendar
// date so the leaderboard doesn't read as a stale-feeling "hace 200
// días" list.
function relativeTime(iso) {
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
  return then.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}
import { useCalendarToken } from "../hooks/useCalendarToken";
import { CalendarLinkPanel } from "../components/CalendarLinkPanel";
import { PasswordInput } from "../components/PasswordInput";
import { Toggle } from "../components/Toggle";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Avatar } from "../components/Avatar";
import { AvatarPicker } from "../components/AvatarPicker";
import { useAvatarUrl } from "../hooks/useAvatarUrl";
import { useMfa } from "../hooks/useMfa";
import { TurnstileWidget, TURNSTILE_ENABLED } from "../components/TurnstileWidget";
import { SegmentedControl } from "../components/SegmentedControl";
import { Expando } from "../components/Expando";
import { PushInstallCard } from "../components/PushInstallCard";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";
import { useSheetDrag } from "../hooks/useSheetDrag";
import { useCardigan } from "../context/CardiganContext";
import { isClinicalProfession } from "../data/constants";
import { haptic } from "../utils/haptics";
// Map typed error codes from useNotifications to user-readable i18n
// keys. Keeping this as a pure mapping means the hook stays decoupled
// from locale strings.
/* Official WhatsApp glyph (SimpleIcons, CC0). The previous icon was
   a hand-rolled approximation that read as a generic chat bubble.
   Using the brand mark verbatim avoids the "is that the right app?"
   moment when users see the button on iOS Safari. */
function WhatsAppGlyph({ size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

/* iOS-style share glyph (the box-with-up-arrow). Signals "system
   share sheet" on iOS Safari and matches modern share buttons on
   Android Chrome too. */
function ShareGlyph({ size = 18 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v13" />
      <polyline points="7 8 12 3 17 8" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

/* ── Referral share block ──
   Three-tier share UI:
     1. Primary: native OS share (navigator.share) — covers every
        app the user has installed. Hidden on browsers without the
        Web Share API (mostly older desktop builds).
     2. Direct icon row: WhatsApp + Email. The most common channels
        in Mexico, deep-linked so they work even when navigator.share
        is unavailable.
     3. Code box + Copiar enlace (above this block) for the manual
        case.

   Each tap fires `referral_share` with `channel` so we can see in
   Vercel Analytics which path actually drives invitations. */
function ReferralShareBlock({ code, t }) {
  const url = `https://cardigan.mx/?ref=${code}`;
  const text = t("subscription.referralShareText", { code });
  const canNativeShare = typeof navigator !== "undefined"
    && typeof navigator.share === "function";

  const fireTrack = (channel) => {
    // Lazy import the analytics layer so this component doesn't
    // pull it into the bundle until first render.
    import("../lib/analytics").then(({ track }) => {
      track("referral_share", { channel });
    }).catch(() => { /* swallow */ });
  };

  const handleNativeShare = async () => {
    haptic.tap();
    try {
      await navigator.share({
        title: "Cardigan",
        text,
        url,
      });
      fireTrack("native");
    } catch (err) {
      // AbortError fires when the user dismisses the share sheet —
      // expected, no-op. Anything else is unexpected; log and move on.
      if (err?.name !== "AbortError") {
        console.warn("share:", err?.message || err);
      }
    }
  };

  const onChannel = (channel) => () => {
    haptic.tap();
    fireTrack(channel);
  };

  return (
    <>
      {canNativeShare && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleNativeShare}
          style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10, marginBottom:14 }}>
          <ShareGlyph size={16} />
          <span>{t("subscription.shareNative")}</span>
        </button>
      )}

      {/* Section divider — only renders when there's a primary
          button above to separate from. On desktop where native
          share is hidden, the icon row is the primary surface and
          we drop the eyebrow to keep it tight. */}
      {canNativeShare && (
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--charcoal-md)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 10,
          textAlign: "center",
        }}>
          {t("subscription.shareDirectEyebrow")}
        </div>
      )}

      {/* Icon row — equal-width tiles so the buttons read as a
          coherent set rather than three random pills. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10,
        marginBottom: 4,
      }}>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onChannel("whatsapp")}
          className="referral-channel-btn"
          style={{ background: "#25D366", color: "#fff" }}
          aria-label="WhatsApp">
          <WhatsAppGlyph size={20} />
          <span>WhatsApp</span>
        </a>
        <a
          href={`mailto:?subject=${encodeURIComponent("Te invito a Cardigan")}&body=${encodeURIComponent(text)}`}
          onClick={onChannel("email")}
          className="referral-channel-btn"
          style={{ background: "var(--charcoal)", color: "#fff" }}
          aria-label={t("subscription.shareEmail")}>
          <IconMail size={18} />
          <span>{t("subscription.shareEmail")}</span>
        </a>
      </div>
    </>
  );
}

function notifErrorKey(code) {
  switch (code) {
    case "permission-denied": return "notifications.toastPermissionDenied";
    case "install-required":  return "notifications.toastInstallRequired";
    case "subscribe-failed":  return "notifications.toastSubscribeFailed";
    case "server-error":      return "notifications.toastServerError";
    case "unsupported":       return "notifications.toastUnsupported";
    default:                  return "notifications.toastSubscribeFailed";
  }
}

// Small "PRO" pill rendered next to gated row titles. Visual cue that
// the row needs an active subscription before it'll do anything.
// Charcoal-on-cream so it reads clearly without screaming for
// attention — Cardigan's badges throughout the app share this tone.
function ProBadge() {
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: "0.08em",
      padding: "2px 6px", borderRadius: 999,
      background: "var(--charcoal)", color: "var(--white)",
      lineHeight: 1.2,
    }}>PRO</span>
  );
}

export function Settings({ user, signOut, refreshUser }) {
  const { t } = useT();
  const { tutorial, navigate, theme, accentTheme, notifications, showToast, readOnly, noteCrypto, profession, setHideFab, subscription, requirePro } = useCardigan();
  const isPro = !!subscription?.isPro;
  const showEncryptionSetup = isClinicalProfession(profession);
  const { imageUrl: avatarImageUrl } = useAvatarUrl(user?.user_metadata?.avatar);
  const mfa = useMfa();
  // Captcha state for the password-reset flow. Supabase enforces a
  // captcha token on resetPasswordForEmail, so the in-app "Cambiar
  // contraseña" affordance has to render its own Turnstile widget.
  // pendingPasswordSubmit defers the click while the invisible
  // Turnstile widget is still resolving — set true on click; a
  // useEffect fires the actual request the moment the token arrives.
  // Without this the user sees "Espera a que se complete la
  // verificación" if they tap before the widget settles (typical on
  // a cold sheet open).
  const [passwordCaptchaToken, setPasswordCaptchaToken] = useState(null);
  const [passwordResetError, setPasswordResetError] = useState("");
  const [pendingPasswordSubmit, setPendingPasswordSubmit] = useState(false);
  // Imperative handle on the Turnstile widget so we can force a fresh
  // challenge after each consumed token. Without an explicit reset the
  // widget holds the issued token until natural expiry (~5 min) and
  // subsequent submits look stuck verifying.
  const turnstileRef = useRef(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaUiError, setMfaUiError] = useState("");
  const [mfaUnenrollId, setMfaUnenrollId] = useState(null);
  const [mfaSecretCopied, setMfaSecretCopied] = useState(false);
  const copyMfaSecret = async () => {
    if (!mfa.enrollment?.secret) return;
    try {
      await navigator.clipboard.writeText(mfa.enrollment.secret);
      setMfaSecretCopied(true);
      setTimeout(() => setMfaSecretCopied(false), 1800);
    } catch {
      showToast(t("settings.calendarCopyError"), "error");
    }
  };

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
          showToast(t("notifications.toastEnabled"), "success");
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
        showToast(t("notifications.toastEnabled"), "success");
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

  const [activeSheet, setActiveSheet] = useState(null);
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
    const handleOpenSheet = (e) => {
      const sheet = e?.detail?.sheet;
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
    if (!subscription?.subscribedActive) return;
    if (subscription.invoices != null) return;
    subscription.fetchInvoices?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSheet, subscription?.subscribedActive]);
  const { scrollRef: sheetScrollRef, setPanelEl: setSheetPanelEl, panelHandlers: sheetPanelHandlers } = useSheetDrag(closeSheet, { isOpen: !!activeSheet });
  const setSheetPanel = (el) => { sheetScrollRef.current = el; setSheetPanelEl(el); };
  const [editName, setEditName] = useState(userName);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(null); // { msg, tone: "ok" | "info" | "err" }

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
        // controllerchange in main.jsx reloads the page.
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

  const resetPassword = useCallback(async (token) => {
    setSaving(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(userEmail, {
        captchaToken: token || undefined,
      });
      if (error) {
        setPasswordResetError(error.message || t("settings.emailError"));
        return;
      }
      setMessage(t("settings.linkSent"));
      setActiveSheet(null);
      setTimeout(() => setMessage(""), 3000);
    } catch {
      setPasswordResetError(t("settings.emailError"));
    } finally {
      setSaving(false);
      // Token is single-use; force the widget to issue a fresh one
      // immediately so the next attempt isn't stuck waiting for natural
      // expiry (~5 min in managed mode).
      setPasswordCaptchaToken(null);
      setPendingPasswordSubmit(false);
      turnstileRef.current?.reset();
    }
  }, [userEmail, t]);

  // Auto-fire submit once the captcha token arrives if the user clicked
  // while the widget was still resolving. Eliminates the visible
  // "Espera a que se complete la verificación" error during cold opens.
  useEffect(() => {
    if (!pendingPasswordSubmit) return;
    if (!passwordCaptchaToken) return;
    if (saving) return;
    resetPassword(passwordCaptchaToken);
  }, [pendingPasswordSubmit, passwordCaptchaToken, saving, resetPassword]);

  const openSheet = (key) => {
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
  const [paymentSheetReferralCode, setPaymentSheetReferralCode] = useState(null);
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
    if (res.url) window.location.href = res.url;
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
  const [exporting, setExporting] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [exportError, setExportError] = useState("");
  const [exportCaptchaToken, setExportCaptchaToken] = useState(null);
  const exportTurnstileRef = useRef(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteCaptchaToken, setDeleteCaptchaToken] = useState(null);
  const deleteTurnstileRef = useRef(null);
  // Sign-out confirmation, mirroring the Drawer pattern.
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  /* Map server-side reauth codes → user-facing Spanish messages so
     the prompt knows what to say beyond a generic "wrong password". */
  const reauthMessageFor = (code) => {
    if (code === "wrong_password") return t("settings.privacyReauthWrong");
    if (code === "password_required") return t("settings.privacyReauthRequired");
    if (code === "oauth_only") return t("settings.privacyReauthOauthOnly");
    if (code === "captcha_failed") return t("settings.privacyReauthCaptcha");
    return t("settings.privacyReauthError");
  };

  const exportMyData = async () => {
    if (exporting) return;
    if (!exportPassword) { setExportError(t("settings.privacyReauthRequired")); return; }
    setExporting(true);
    setExportError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setExportError(t("settings.privacyExportError")); return; }
      const res = await fetch("/api/export-user-data", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          password: exportPassword,
          captchaToken: exportCaptchaToken || undefined,
        }),
      });
      if (!res.ok) {
        // 401 with a code field → reauth issue; surface in the sheet so
        // the user can re-enter without losing the modal context.
        if (res.status === 401) {
          let code = ""; try { const j = await res.json(); code = j.code || ""; } catch { /* ignore */ }
          setExportError(reauthMessageFor(code));
          setExportCaptchaToken(null);
          exportTurnstileRef.current?.reset();
          return;
        }
        let msg = t("settings.privacyExportError");
        try { const j = await res.json(); if (j.hint) msg = j.hint; else if (j.error) msg = j.error; } catch { /* keep default */ }
        showToast(msg, res.status === 429 ? "warning" : "error");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const today = new Date().toISOString().slice(0, 10);
      a.download = `cardigan-export-${today}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast(t("settings.privacyExportDone"), "success");
      setExportPassword("");
      setActiveSheet(null);
    } finally {
      setExporting(false);
    }
  };

  const confirmDeleteAccount = async () => {
    if (deleting) return;
    if (!deletePassword) { setDeleteError(t("settings.privacyReauthRequired")); return; }
    setDeleting(true);
    setDeleteError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setDeleteError(t("settings.privacyDeleteError")); return; }
      // Normalize the confirmation phrase: iOS predictive keyboards
      // can insert trailing spaces or lowercase characters even with
      // autoCapitalize="characters". The server still requires exact
      // "ELIMINAR" so we send the normalized value.
      const normalizedConfirmation = deleteConfirm.trim().toUpperCase();
      const res = await fetch("/api/delete-my-account", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          confirmation: normalizedConfirmation,
          password: deletePassword,
          captchaToken: deleteCaptchaToken || undefined,
        }),
      });
      if (!res.ok) {
        // 401 → reauth issue; keep the sheet open so the user can fix.
        if (res.status === 401) {
          let code = ""; try { const j = await res.json(); code = j.code || ""; } catch { /* ignore */ }
          setDeleteError(reauthMessageFor(code));
          // Captcha tokens are single-use; force a fresh challenge so a
          // retry isn't immediately blocked by the same stale token.
          setDeleteCaptchaToken(null);
          deleteTurnstileRef.current?.reset();
          return;
        }
        let msg = t("settings.privacyDeleteError");
        try { const j = await res.json(); if (j.error) msg = j.error; } catch { /* keep default */ }
        setDeleteError(msg);
        return;
      }
      // Cascade completed — sign out to clear the (now-orphan) session.
      await signOut();
    } catch (err) {
      // Surface network / unexpected errors so the user knows something
      // happened (a silent failure looks like the button is broken).
      setDeleteError(err?.message || t("settings.privacyDeleteError"));
    } finally {
      setDeleting(false);
    }
  };

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
    <div className="page">
      <div className="section" style={{ paddingTop:16 }}>
        <div className="card" style={{ padding:16 }}>
          <div className="flex items-center gap-3">
            <div
              className="av-settings-avatar"
              role={readOnly ? undefined : "button"}
              tabIndex={readOnly ? undefined : 0}
              aria-label={readOnly ? undefined : (t("avatar.changePhoto") || "Cambiar foto")}
              aria-disabled={readOnly ? "true" : undefined}
              onClick={readOnly ? undefined : () => setActiveSheet("avatar")}
              onKeyDown={readOnly ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveSheet("avatar"); } }}
            >
              <Avatar
                initials={userInitial}
                color="var(--teal)"
                size="lg"
                imageUrl={avatarImageUrl}
              />
              {!readOnly && (
                <span className="av-settings-avatar-badge" aria-hidden="true">
                  <IconEdit size={11} />
                </span>
              )}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"var(--font-d)",fontSize:"var(--text-lg)",fontWeight:800,color:"var(--charcoal)" }}>{userName}</div>
              <div style={{ fontSize:"var(--text-sm)",color:"var(--charcoal-xl)",marginTop:2 }}>{userEmail}</div>
            </div>
            <button className="btn btn-ghost" onClick={() => openSheet("profile")}>{t("edit")}</button>
          </div>
        </div>
      </div>

      {/* ── CUENTA ── */}
      <div className="settings-label">{t("settings.sectionAccount")}</div>
      <div className="card" style={{ margin:"0 16px" }}>
        <div className="settings-row" onClick={() => openSheet("plan")}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconSparkle size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.subscriptionTitle")}</div>
            <div className="settings-row-sub" style={subscription?.subscription?.status === "past_due" ? { color: "var(--amber)" } : undefined}>{(() => {
              const s = subscription || {};
              if (s.compGranted) return t("subscription.statusComp");
              // Past-due jumps the line so the row reflects the
              // payment problem before the generic "active" label.
              if (s.subscription?.status === "past_due") return t("subscription.statusPastDue");
              if (s.subscribedActive) return t("subscription.statusActive");
              if (s.accessState === "trial" && s.daysLeftInTrial != null) {
                return s.daysLeftInTrial <= 1
                  ? t("subscription.statusTrialEndsToday")
                  : t("subscription.statusTrialDaysLeft", { n: s.daysLeftInTrial });
              }
              if (s.accessState === "expired") return t("subscription.statusExpired");
              // Admin shortcut — useSubscription returns
              // accessState="active" for admins regardless of
              // comp / paid state, so neither subscribedActive nor
              // compGranted is true. Without this fall-through the
              // row was permanently stuck on "Cargando…" for the
              // admin's own account.
              if (s.accessState === "active") return t("subscription.statusActive");
              return t("subscription.statusLoading");
            })()}</div>
          </div>
          <IconChevron />
        </div>
        {/* Referral row — surface the user's invite code directly so it's
            findable without going through the Suscripción sheet first. The
            sub-line shows the code (or "Genera tu código…" while the lazy
            fetch is running on first open). Tapping opens a dedicated sheet
            with the share UI + rewards tally. */}
        <div className="settings-row" onClick={() => openSheet("referral")}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconUsers size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.referralRowTitle")}</div>
            <div className="settings-row-sub">{(() => {
              const info = subscription?.referralInfo;
              if (info?.code) {
                return info.rewardsCount > 0
                  ? t("settings.referralRowSubWithRewards", { code: info.code, n: info.rewardsCount })
                  : t("settings.referralRowSubCode", { code: info.code });
              }
              if (subscription?.referralLoading) return t("settings.referralRowSubLoading");
              return t("settings.referralRowSubDefault");
            })()}</div>
          </div>
          <IconChevron />
        </div>
        <div className="settings-row"
          onClick={() => { setPasswordResetError(""); setPasswordCaptchaToken(null); setActiveSheet("changePassword"); }}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconKey size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.changePassword")}</div>
            {message && activeSheet === null && (
              <div className="settings-row-sub" style={{ color:"var(--green)" }}>{message}</div>
            )}
          </div>
          <IconChevron />
        </div>
      </div>

      {/* ── APARIENCIA ── */}
      <div className="settings-label">{t("settings.sectionAppearance")}</div>
      <div className="card" style={{ margin:"0 16px" }}>
        <div className="settings-row" onClick={() => openSheet("theme")}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}>{theme?.resolvedTheme === "dark" ? <IconMoon size={18} /> : <IconSun size={18} />}</div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.appearance")}</div>
            <div className="settings-row-sub">{theme?.preference === "light" ? t("settings.themeLight") : theme?.preference === "dark" ? t("settings.themeDark") : t("settings.themeSystem")}</div>
          </div>
          <IconChevron />
        </div>
        <div className="settings-row" onClick={() => openSheet("accent")}>
          <div className="settings-row-icon" aria-hidden="true">
            <span style={{ display:"inline-block", width:18, height:18, borderRadius:"50%", background:"var(--teal)", border:"1px solid var(--border-lt)" }} />
          </div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.accentColor")}</div>
            <div className="settings-row-sub">{t(`settings.accent.${accentTheme?.accent || "default"}`)}</div>
          </div>
          <IconChevron />
        </div>
      </div>

      {/* ── NOTIFICACIONES Y CALENDARIO ──
         Notifications row opens a sub-sheet absorbing all of the
         notification UI states (install gate, blocked, toggle +
         reminder time). Calendar row opens a sheet wrapping the
         CalendarLinkPanel — both surfaces are about how the user gets
         told about their schedule, so they belong together. */}
      {(notifications?.supported || !readOnly) && (
        <>
          <div className="settings-label">{t("settings.sectionNotifCal")}</div>
          <div className="card" style={{ margin:"0 16px" }}>
            {notifications?.supported && (
              <div className="settings-row" onClick={() => setActiveSheet("notifications")}>
                <div
                  className={`settings-row-icon${bellFx ? " bell-ring bell-glow" : ""}`}
                  style={{ color:"var(--teal-dark)" }}
                >
                  <IconBell size={18} />
                </div>
                <div style={{ flex:1 }}>
                  <div className="settings-row-title">{t("settings.notificationsRowTitle")}</div>
                  <div className="settings-row-sub">{notifSummary}</div>
                </div>
                <IconChevron />
              </div>
            )}
            {!readOnly && (
              <div
                className="settings-row"
                onClick={() => isPro ? setActiveSheet("calendar") : requirePro?.("calendar")}
              >
                <div className="settings-row-icon" style={{ color: isPro ? "var(--teal-dark)" : "var(--charcoal-xl)" }}><IconCalendar size={18} /></div>
                <div style={{ flex:1 }}>
                  <div className="settings-row-title" style={{ display:"flex", alignItems:"center", gap:6 }}>
                    {t("settings.calendarLabel")}
                    {!isPro && <ProBadge />}
                  </div>
                  <div className="settings-row-sub">{isPro ? calendarSummary : t("settings.proRowLockedSub")}</div>
                </div>
                <IconChevron />
              </div>
            )}
          </div>
        </>
      )}

      {/* ── SEGURIDAD ── */}
      {!readOnly && (
        <>
          <div className="settings-label">{t("settings.sectionSecurity")}</div>
          <div className="card" style={{ margin:"0 16px" }}>
            <div className="settings-row" style={{ cursor: mfa.loading ? "default" : "pointer" }}
              onClick={() => {
                if (mfa.loading) return;
                setMfaUiError(""); setMfaCode("");
                if (mfa.factors.length === 0) {
                  setActiveSheet("mfaEnroll");
                  if (!mfa.enrollment) mfa.enroll();
                } else {
                  setMfaUnenrollId(mfa.factors[0].id);
                  setActiveSheet("mfaManage");
                }
              }}>
              <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconShield size={18} /></div>
              <div style={{ flex:1 }}>
                <div className="settings-row-title">{t("settings.mfaTitle")}</div>
                <div className="settings-row-sub">
                  {mfa.loading ? "…" : mfa.factors.length > 0 ? t("settings.mfaActive") : t("settings.mfaInactive")}
                </div>
              </div>
              <IconChevron />
            </div>
            {noteCrypto && noteCrypto.status !== "loading" && (showEncryptionSetup || noteCrypto.status !== "disabled") && (
              <div className="settings-row" onClick={() => {
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
              }}>
                <div className="settings-row-icon" style={{ color: noteCrypto.status === "unlocked" ? "var(--green)" : noteCrypto.status === "locked" ? "var(--charcoal-md)" : (!isPro && noteCrypto.status === "disabled" ? "var(--charcoal-xl)" : "var(--teal-dark)") }}>
                  <IconLock size={18} />
                </div>
                <div style={{ flex:1 }}>
                  <div className="settings-row-title" style={{ display:"flex", alignItems:"center", gap:6 }}>
                    {t("settings.encryptionTitle")}
                    {!isPro && noteCrypto.status === "disabled" && <ProBadge />}
                  </div>
                  <div className="settings-row-sub">
                    {!isPro && noteCrypto.status === "disabled" ? t("settings.proRowLockedSub") : encSummary}
                  </div>
                </div>
                <IconChevron />
              </div>
            )}
          </div>
        </>
      )}

      {/* ── DATOS Y PRIVACIDAD ── */}
      <div className="settings-label">{t("settings.sectionPrivacyData")}</div>
      <div className="card" style={{ margin:"0 16px" }}>
        {!readOnly && (
          <div className="settings-row" style={{ cursor: exporting ? "default" : "pointer" }}
            onClick={() => { if (!exporting) { setExportPassword(""); setExportError(""); setActiveSheet("exportData"); } }}>
            <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconDownload size={18} /></div>
            <div style={{ flex:1 }}>
              <div className="settings-row-title">{t("settings.privacyExport")}</div>
              <div className="settings-row-sub">{t("settings.privacyExportSub")}</div>
            </div>
            {exporting ? <span style={{ fontSize:12, color:"var(--charcoal-xl)" }}>…</span> : <IconChevron />}
          </div>
        )}
        <div className="settings-row" onClick={() => navigate("privacy")}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconDocument size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.privacyPolicy")}</div>
            <div className="settings-row-sub">{t("settings.privacyPolicySub")}</div>
          </div>
          <IconChevron />
        </div>
      </div>

      {/* ── AYUDA ── */}
      <div className="settings-label">{t("settings.sectionHelp")}</div>
      <div className="card" style={{ margin:"0 16px" }}>
        <div className="settings-row" onClick={restartTutorial}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconStar size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("tutorial.settingsRow")}</div>
            <div className="settings-row-sub">{t("tutorial.settingsRowSub")}</div>
          </div>
          <IconChevron />
        </div>
        <div className="settings-row" style={{ cursor: updateChecking ? "default" : "pointer" }} onClick={checkForUpdate}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconRefresh size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.checkUpdate") || "Buscar actualización"}</div>
            {updateStatus && <div className="settings-row-sub" style={{ color: updateStatus.tone === "err" ? "var(--red)" : updateStatus.tone === "ok" ? "var(--green)" : "var(--charcoal-md)" }}>{updateStatus.msg}</div>}
          </div>
          {updateChecking ? <span style={{ fontSize:12, color:"var(--charcoal-xl)" }}>…</span> : <IconChevron />}
        </div>
      </div>

      {/* ── SESIÓN ── */}
      <div className="settings-label">{t("settings.sectionSession")}</div>
      <div className="card" style={{ margin:"0 16px" }}>
        {/* Confirm before signing out — same ConfirmDialog the Drawer
            uses, so the affordance is consistent across both entry
            points (drawer chip + this row). */}
        <div className="settings-row" onClick={() => setConfirmSignOut(true)}>
          <div className="settings-row-icon" style={{ color:"var(--red)" }}><IconLogOut size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title" style={{ color:"var(--red)" }}>{t("nav.signOut")}</div>
          </div>
          <IconChevron />
        </div>
        {!readOnly && (
          <div className="settings-row" onClick={() => setActiveSheet("signOutEverywhere")}>
            <div className="settings-row-icon" style={{ color:"var(--red)" }}><IconLogOut size={18} /></div>
            <div style={{ flex:1 }}>
              <div className="settings-row-title" style={{ color:"var(--red)" }}>{t("settings.signOutEverywhere")}</div>
              <div className="settings-row-sub">{t("settings.signOutEverywhereSub")}</div>
            </div>
            <IconChevron />
          </div>
        )}
      </div>

      {/* ── ZONA PELIGROSA ──
         Account deletion lives in its own bottom-of-page section so it
         can't be tapped by accident while scanning Settings. */}
      {!readOnly && (
        <>
          <div className="settings-label">{t("settings.dangerZone")}</div>
          <div className="card" style={{ margin:"0 16px" }}>
            <div className="settings-row" onClick={() => { setDeleteConfirm(""); setDeleteError(""); setActiveSheet("deleteAccount"); }}>
              <div className="settings-row-icon" style={{ color:"var(--red)" }}><IconTrash size={18} /></div>
              <div style={{ flex:1 }}>
                <div className="settings-row-title" style={{ color:"var(--red)" }}>{t("settings.privacyDelete")}</div>
                <div className="settings-row-sub">{t("settings.privacyDeleteSub")}</div>
              </div>
              <IconChevron />
            </div>
          </div>
        </>
      )}

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
                        ]}
                        value={notifications?.reminderMinutes}
                        onChange={async (v) => {
                          if (v === notifications?.reminderMinutes) return;
                          haptic.tap();
                          const res = await notifications?.setReminderMinutes(v);
                          if (res && !res.ok) {
                            showToast(t(notifErrorKey(res.code)), "error");
                          }
                        }}
                      />
                    </div>
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
            referralCode={paymentSheetReferralCode}
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
                const periodEnd = s.subscription?.current_period_end;
                const periodEndStr = periodEnd
                  ? new Date(periodEnd).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })
                  : null;
                const accentColor = isComp ? "var(--green)"
                  : isPastDue ? "var(--amber)"
                  : isActive ? "var(--teal-dark)"
                  : state === "expired" ? "var(--red)"
                  : "var(--teal-dark)";
                const accentBg = isComp ? "var(--green-bg)"
                  : isPastDue ? "var(--amber-bg)"
                  : isActive ? "var(--teal-pale)"
                  : state === "expired" ? "var(--red-bg)"
                  : "var(--cream)";
                const HeroIcon = isComp ? IconCheck
                  : isPastDue ? IconStar
                  : isActive ? IconSparkle
                  : state === "expired" ? IconLock
                  : IconStar;
                // Admin shortcut: accessState === "active" without
                // a paid sub or comp grant is the admin's own row.
                // Treat it as the same "Activa" hero as a real Pro
                // sub so the panel doesn't read as perpetually
                // loading for the admin.
                const isAdminAccess = !isComp && !isActive && state === "active";
                const heroTitle = isComp ? t("subscription.statusCompTitle")
                  : isPastDue ? t("subscription.statusPastDueTitle")
                  : isActive ? t("subscription.statusActiveTitle")
                  : isAdminAccess ? t("subscription.statusActiveTitle")
                  : state === "trial" ? t("subscription.statusTrialTitle")
                  : state === "expired" ? t("subscription.statusExpiredTitle")
                  : t("subscription.statusLoading");
                const heroSub = isComp ? t("subscription.compExplain")
                  : isPastDue ? t("subscription.statusPastDueBody")
                  : isActive && periodEndStr
                    ? (s.subscription?.cancel_at_period_end
                        ? t("subscription.cancelAt", { date: periodEndStr })
                        : t("subscription.renewsOn", { date: periodEndStr }))
                  : isAdminAccess ? t("subscription.compExplain")
                  : state === "trial" && s.daysLeftInTrial != null
                    ? (s.daysLeftInTrial <= 1
                        ? t("subscription.statusTrialEndsToday")
                        : t("subscription.statusTrialDaysLeft", { n: s.daysLeftInTrial }))
                  : state === "expired" ? t("subscription.expiredExplain")
                  : "";
                return (
                  <>
                    {/* ── Hero card — combines status + (when applicable) price into a single
                          well-framed unit. Background is a soft accent tint and the icon
                          sits in a clean white circle so the card reads as a premium
                          surface rather than a noisy alert. */}
                    <div style={{
                      padding: !isComp && !isActive && !isAdminAccess ? "20px 18px 22px" : "18px",
                      borderRadius: "var(--radius-lg, 16px)",
                      marginBottom: 16,
                      background: accentBg,
                      textAlign: "center",
                    }}>
                      <div style={{ width:52, height:52, borderRadius:"50%",
                        display:"flex", alignItems:"center", justifyContent:"center",
                        background:"var(--white)", color: accentColor, margin:"0 auto 10px",
                        boxShadow:"0 2px 8px rgba(0,0,0,0.05)" }}>
                        <HeroIcon size={22} />
                      </div>
                      <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:800, color:"var(--charcoal)", letterSpacing:"-0.2px" }}>
                        {heroTitle}
                      </div>
                      {heroSub && (
                        <div style={{ fontSize:13, color:"var(--charcoal-md)", marginTop:4, lineHeight:1.5 }}>
                          {heroSub}
                        </div>
                      )}

                      {/* Price line — only when there's a sale to make. Lives inside the
                          hero so the user perceives value + cost together. The
                          numbers reflect the currently selected billing cycle. */}
                      {!isComp && !isActive && !isAdminAccess && (
                        <div style={{ marginTop:18, paddingTop:14, borderTop:"1px solid rgba(0,0,0,0.06)" }}>
                          <div style={{ display:"flex", alignItems:"baseline", justifyContent:"center", gap:6 }}>
                            <span style={{ fontFamily:"var(--font-d)", fontSize:34, fontWeight:800, color:"var(--charcoal)", letterSpacing:"-1px", lineHeight:1 }}>
                              ${selectedPlan === "annual" ? "2,990" : "299"}
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
                    {!isComp && !isActive && !isAdminAccess && (
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

                    {/* Active-plan transparency: next charge or cancel-at-period-end +
                        a one-tap link to the most recent receipt. Reads entirely from
                        already-stored fields on user_subscriptions; doesn't require a
                        Stripe round-trip. */}
                    {isActive && periodEndStr && !isPastDue && (
                      <div style={{
                        padding:"12px 14px",
                        borderRadius:"var(--radius)",
                        background:"var(--white)",
                        border:"1px solid var(--border)",
                        marginBottom:14,
                        fontSize:13,
                        color:"var(--charcoal-md)",
                        lineHeight:1.55,
                      }}>
                        <div style={{ fontWeight:700, color:"var(--charcoal)" }}>
                          {s.subscription?.cancel_at_period_end
                            ? t("subscription.cancelAt", { date: periodEndStr })
                            : t("subscription.nextChargeOn", { date: periodEndStr })}
                        </div>
                        {s.subscription?.hosted_invoice_url && (
                          <a href={s.subscription.hosted_invoice_url}
                            target="_blank" rel="noopener noreferrer"
                            style={{ color:"var(--teal-dark)", fontWeight:600, fontSize:13, textDecoration:"none", display:"inline-block", marginTop:4 }}>
                            {t("subscription.viewLatestReceipt")} →
                          </a>
                        )}
                      </div>
                    )}

                    {/* Invite-code input — only when not yet subscribed
                        AND the code wasn't auto-captured from a ?ref=<code>
                        URL. Visitors who arrived via a friend's referral
                        link don't see this field at all; the code is
                        already in inviteCodeInput from sessionStorage and
                        flows through to handleStartCheckout invisibly.
                        Word-of-mouth users (who never hit a ?ref URL)
                        still see the field and can type their code in. */}
                    {!isComp && !isActive && !isAdminAccess && !inviteCodeFromUrl && (
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
                    {(!isComp && !isActive && !isAdminAccess) && (
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
                    {isActive && !isComp && (
                      <div style={{ marginBottom:22 }}>
                        <button type="button" className="btn btn-primary"
                          onClick={handleOpenPortal} disabled={subBusy}>
                          {subBusy ? t("loading") : t("subscription.managePortalCta")}
                        </button>
                        <div style={{ fontSize:11, color:"var(--charcoal-xl)", textAlign:"center", marginTop:8, lineHeight:1.4 }}>
                          {t("subscription.portalFooter")}
                        </div>
                        {/* Pause-subscription link — soft secondary affordance.
                            Routes to the same Stripe portal as "Administrar"
                            but the copy hints at the option for users who
                            were going to cancel for a vacation and would
                            otherwise just churn. The actual pause UI lives
                            in the Stripe portal (configured to allow pause
                            with default 1-month cap). */}
                        <button type="button" className="btn btn-ghost"
                          onClick={handleOpenPortal} disabled={subBusy}
                          style={{ width:"100%", marginTop:10, fontSize:13 }}>
                          {t("subscription.pauseCta")}
                        </button>
                        <div style={{ fontSize:11, color:"var(--charcoal-xl)", textAlign:"center", marginTop:4, lineHeight:1.4 }}>
                          {t("subscription.pauseHint")}
                        </div>
                        {/* Manual reconciliation — recovery affordance for the
                            rare case where a Stripe webhook delivery lags or
                            is missed (so the user cancelled in the portal but
                            still sees "Activa" here). Hits /api/stripe-sync
                            which pulls live Stripe state and writes to DB. */}
                        <button type="button"
                          onClick={handleSyncWithStripe} disabled={syncBusy || subBusy}
                          style={{
                            display:"block", margin:"14px auto 0", padding:"6px 12px",
                            background:"transparent", border:"none",
                            color: syncDone ? "var(--green)" : "var(--charcoal-xl)",
                            fontSize:12, cursor:"pointer", textDecoration:"underline",
                          }}>
                          {syncBusy ? t("subscription.syncing")
                            : syncDone ? t("subscription.syncDone")
                            : t("subscription.syncCta")}
                        </button>
                        <div style={{ fontSize:11, color:"var(--charcoal-xl)", textAlign:"center", marginTop:2, lineHeight:1.4 }}>
                          {t("subscription.syncHint")}
                        </div>
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
                          {s.invoices.map((inv) => {
                            const date = new Date(inv.paid_at)
                              .toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
                            const amount = `$${(inv.amount_cents / 100).toLocaleString("es-MX")}`;
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
                        margin:"0 auto 10px", boxShadow:"0 2px 8px rgba(0,0,0,0.05)" }}>
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
                              credit: `$${(info.pendingCreditCents / 100).toLocaleString("es-MX")}`,
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
                          {subscription.referralLeaderboard.map((row, idx) => (
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
                  {encUiError && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{encUiError}</div>}
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

      {/* ── DELETE ACCOUNT SHEET ── */}
      {activeSheet === "deleteAccount" && (
        <div className="sheet-overlay" onClick={() => !deleting && setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.privacyDelete")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => !deleting && setActiveSheet(null)} disabled={deleting}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.55, marginBottom: 14 }}>
                {t("settings.privacyDeleteExplain")}
              </div>
              <div style={{ background: "var(--red-pale, #fdecea)", color: "var(--red-dark, #922)", padding: "10px 14px", borderRadius: "var(--radius)", fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
                {t("settings.privacyDeleteWarning")}
              </div>
              {/* iOS Safari autofills the closest text field above any
                  password input as the "username" side of a sign-in
                  pair. To stop it from dumping the user's email into
                  the confirmation field, we plant a hidden username
                  input here that absorbs the pairing instead. The
                  attributes also dissuade 1Password / LastPass / iOS
                  Keychain. */}
              <input
                type="text"
                name="absorb-username-autofill"
                autoComplete="username"
                tabIndex={-1}
                aria-hidden="true"
                style={{
                  position: "absolute",
                  width: 1, height: 1,
                  opacity: 0, pointerEvents: "none",
                  border: 0, padding: 0, margin: -1,
                  overflow: "hidden", clip: "rect(0 0 0 0)",
                }}
                value=""
                readOnly
              />
              <div className="input-group" style={{ marginBottom: 14 }}>
                <label className="input-label">{t("settings.privacyDeleteConfirmLabel")}</label>
                <input
                  className="input"
                  type="text"
                  inputMode="text"
                  // Distinct, non-standard name so password managers
                  // don't try to autofill known credentials here.
                  name="cardigan-eliminar-confirm"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  autoCapitalize="characters"
                  data-1p-ignore
                  data-lpignore="true"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder="ELIMINAR"
                  disabled={deleting}
                />
                {/* Inline hint when the value is non-empty but doesn't
                    match. The user almost always lands here because of
                    iOS autofill — a "Borrar" button gives them a
                    one-tap recovery instead of having to manually
                    delete their email character by character. */}
                {deleteConfirm
                  && deleteConfirm.trim().toUpperCase() !== "ELIMINAR" && (
                  <div style={{
                    display:"flex", alignItems:"center", justifyContent:"space-between",
                    gap:8, marginTop:6, fontSize:12, color:"var(--charcoal-md)",
                    lineHeight:1.45,
                  }}>
                    <span>{t("settings.privacyDeleteHint")}</span>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm("")}
                      style={{
                        background:"none", border:"none", color:"var(--teal-dark)",
                        fontWeight:700, fontSize:12, cursor:"pointer", padding:"2px 6px",
                      }}
                    >
                      {t("settings.privacyDeleteClear")}
                    </button>
                  </div>
                )}
              </div>
              <div className="input-group" style={{ marginBottom: 14 }}>
                <label className="input-label">{t("settings.privacyReauthLabel")}</label>
                <PasswordInput
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder={t("settings.privacyReauthPlaceholder")}
                  autoComplete="current-password"
                  disabled={deleting}
                />
              </div>
              {/* Captcha verification — see export sheet above for context. */}
              {TURNSTILE_ENABLED && (
                <div style={{ display:"flex", justifyContent:"center", marginBottom: 12 }}>
                  <TurnstileWidget ref={deleteTurnstileRef} onToken={setDeleteCaptchaToken} />
                </div>
              )}
              {deleteError && (
                <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{deleteError}</div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={confirmDeleteAccount}
                  disabled={deleting
                    || deleteConfirm.trim().toUpperCase() !== "ELIMINAR"
                    || !deletePassword
                    || (TURNSTILE_ENABLED && !deleteCaptchaToken)}
                  style={{ background: "var(--red)", color: "var(--white)" }}
                >
                  {deleting ? t("loading") : t("settings.privacyDeleteCta")}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setActiveSheet(null)} disabled={deleting}>
                  {t("cancel")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MFA: ENROLL SHEET ──
         Three-step flow: enroll() runs on sheet open and stashes a
         QR + secret on the hook; user scans + enters code; verify()
         flips the factor to verified. Sheet closes on success. */}
      {activeSheet === "mfaEnroll" && (
        <div className="sheet-overlay" onClick={() => { if (!mfaBusy) { mfa.cancelEnroll(); setActiveSheet(null); } }}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.mfaEnrollTitle")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => { if (!mfaBusy) { mfa.cancelEnroll(); setActiveSheet(null); } }} disabled={mfaBusy}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.55, marginBottom: 14 }}>
                {t("settings.mfaEnrollExplain")}
              </div>
              {!mfa.enrollment && (
                <div style={{ fontSize: 13, color: "var(--charcoal-xl)", marginBottom: 12 }}>{t("loading")}</div>
              )}
              {mfa.enrollment && (
                <>
                  {mfa.enrollment.qr && (
                    <div style={{ display:"flex", justifyContent:"center", marginBottom: 14 }}>
                      <img src={mfa.enrollment.qr} alt="MFA QR" width={180} height={180} style={{ background:"var(--white)", padding:8, borderRadius:"var(--radius)" }} />
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: "var(--charcoal-md)", marginBottom: 6 }}>{t("settings.mfaSecretLabel")}</div>
                  <div style={{ background:"var(--teal-pale)", color:"var(--teal-dark)", fontFamily:"var(--font-mono, monospace)", fontSize:12, padding:"10px 12px", borderRadius:"var(--radius)", wordBreak:"break-all", marginBottom: 8, userSelect:"all" }}>
                    {mfa.enrollment.secret}
                  </div>
                  <button type="button" className="btn btn-ghost" onClick={copyMfaSecret} disabled={mfaBusy}
                    style={{ width:"100%", marginBottom: 14 }}>
                    {mfaSecretCopied ? t("settings.mfaSecretCopied") : t("settings.mfaSecretCopy")}
                  </button>
                  <div className="input-group" style={{ marginBottom: 12 }}>
                    <label className="input-label">{t("settings.mfaCodeLabel")}</label>
                    <input
                      className="input"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="123456"
                      style={{ letterSpacing:"0.4em", textAlign:"center", fontSize:18, fontFamily:"var(--font-mono, monospace)" }}
                      disabled={mfaBusy}
                    />
                  </div>
                </>
              )}
              {(mfaUiError || mfa.error) && (
                <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{mfaUiError || mfa.error}</div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={mfaBusy || !mfa.enrollment || mfaCode.length !== 6}
                  onClick={async () => {
                    setMfaBusy(true); setMfaUiError("");
                    const ok = await mfa.verifyEnroll(mfaCode);
                    setMfaBusy(false);
                    if (ok) {
                      setMfaCode("");
                      setActiveSheet(null);
                      showToast(t("settings.mfaEnrolled"), "success");
                    } else {
                      setMfaUiError(t("settings.mfaCodeWrong"));
                    }
                  }}
                >
                  {mfaBusy ? t("loading") : t("settings.mfaVerify")}
                </button>
                <button type="button" className="btn btn-ghost" disabled={mfaBusy}
                  onClick={() => { mfa.cancelEnroll(); setActiveSheet(null); }}>
                  {t("cancel")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MFA: MANAGE SHEET (already enrolled) ── */}
      {activeSheet === "mfaManage" && (
        <div className="sheet-overlay" onClick={() => !mfaBusy && setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.mfaTitle")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => !mfaBusy && setActiveSheet(null)} disabled={mfaBusy}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.55, marginBottom: 14 }}>
                {t("settings.mfaManageActive")}
              </div>
              <div style={{ background:"var(--red-bg, #fdecea)", color:"var(--red-dark, #922)", padding:"10px 12px", borderRadius:"var(--radius)", fontSize:13, lineHeight:1.5, marginBottom: 16 }}>
                {t("settings.mfaUnenrollWarn")}
              </div>
              {(mfaUiError || mfa.error) && (
                <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{mfaUiError || mfa.error}</div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ background:"var(--red)", color:"var(--white)" }}
                  disabled={mfaBusy || !mfaUnenrollId}
                  onClick={async () => {
                    if (!mfaUnenrollId) return;
                    setMfaBusy(true); setMfaUiError("");
                    const ok = await mfa.unenroll(mfaUnenrollId);
                    setMfaBusy(false);
                    if (ok) {
                      setActiveSheet(null);
                      showToast(t("settings.mfaUnenrolled"), "info");
                    } else {
                      setMfaUiError(t("settings.mfaUnenrollError"));
                    }
                  }}
                >
                  {mfaBusy ? t("loading") : t("settings.mfaUnenroll")}
                </button>
                <button type="button" className="btn btn-ghost" disabled={mfaBusy} onClick={() => setActiveSheet(null)}>
                  {t("cancel")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SIGN OUT EVERYWHERE SHEET ──
         Calls signOut("global") which revokes every refresh token tied
         to this user — kicks them out of every device. Lost-phone
         recovery action. */}
      {activeSheet === "signOutEverywhere" && (
        <div className="sheet-overlay" onClick={() => setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.signOutEverywhere")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => setActiveSheet(null)}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.55, marginBottom: 16 }}>
                {t("settings.signOutEverywhereExplain")}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ background:"var(--red)", color:"var(--white)" }}
                  onClick={async () => { await signOut("global"); }}
                >
                  {t("settings.signOutEverywhereCta")}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setActiveSheet(null)}>
                  {t("cancel")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CHANGE PASSWORD SHEET ──
         Captcha-gated reset email. The Turnstile widget is invisible
         on trusted browsers (non-interactive mode + appearance:"interaction-
         only" — see TurnstileWidget.jsx); on the few cases it surfaces,
         the user gets a brief challenge before the email goes out. */}
      {activeSheet === "changePassword" && (
        <div className="sheet-overlay" onClick={() => !saving && setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.changePassword")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => !saving && setActiveSheet(null)} disabled={saving}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.55, marginBottom: 14 }}>
                {t("settings.changePasswordExplain", { email: userEmail })}
              </div>
              {TURNSTILE_ENABLED && (
                <div style={{ display:"flex", justifyContent:"center", marginBottom: 12 }}>
                  <TurnstileWidget ref={turnstileRef} onToken={setPasswordCaptchaToken} />
                </div>
              )}
              {passwordResetError && (
                <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{passwordResetError}</div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving || pendingPasswordSubmit}
                  onClick={() => {
                    if (saving || pendingPasswordSubmit) return;
                    setPasswordResetError("");
                    if (TURNSTILE_ENABLED && !passwordCaptchaToken) {
                      // Captcha hasn't resolved yet — defer; the
                      // useEffect above will fire resetPassword the
                      // moment the token arrives.
                      setPendingPasswordSubmit(true);
                      return;
                    }
                    resetPassword(passwordCaptchaToken);
                  }}
                >
                  {saving || pendingPasswordSubmit ? t("loading") : t("settings.changePasswordCta")}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setActiveSheet(null)} disabled={saving}>
                  {t("cancel")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── EXPORT DATA SHEET ──
         Step-up password gate before issuing the export. The session
         JWT alone isn't enough: a stolen token shouldn't be able to
         one-shot the entire data export. */}
      {activeSheet === "exportData" && (
        <div className="sheet-overlay" onClick={() => !exporting && setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.privacyExport")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => !exporting && setActiveSheet(null)} disabled={exporting}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.55, marginBottom: 14 }}>
                {t("settings.privacyExportExplain")}
              </div>
              <div className="input-group" style={{ marginBottom: 14 }}>
                <label className="input-label">{t("settings.privacyReauthLabel")}</label>
                <PasswordInput
                  value={exportPassword}
                  onChange={(e) => setExportPassword(e.target.value)}
                  placeholder={t("settings.privacyReauthPlaceholder")}
                  autoComplete="current-password"
                  disabled={exporting}
                />
              </div>
              {/* Captcha verification — Supabase Auth has security_captcha_enabled
                  on, so signInWithPassword (used by the server-side reauth)
                  rejects without a fresh Turnstile token. The widget is
                  invisible/managed and resolves on its own; we just hold the
                  token and forward it on submit. */}
              {TURNSTILE_ENABLED && (
                <div style={{ display:"flex", justifyContent:"center", marginBottom: 12 }}>
                  <TurnstileWidget ref={exportTurnstileRef} onToken={setExportCaptchaToken} />
                </div>
              )}
              {exportError && (
                <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{exportError}</div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={exportMyData}
                  disabled={exporting || !exportPassword || (TURNSTILE_ENABLED && !exportCaptchaToken)}
                >
                  {exporting ? t("loading") : t("settings.privacyExportCta")}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setActiveSheet(null)} disabled={exporting}>
                  {t("cancel")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmSignOut}
        title={t("nav.signOut")}
        body={t("nav.signOutConfirm")}
        confirmLabel={t("nav.signOut")}
        destructive
        onConfirm={() => { setConfirmSignOut(false); signOut(); }}
        onCancel={() => setConfirmSignOut(false)}
      />
    </div>
  );
}
