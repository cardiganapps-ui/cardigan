import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "../supabaseClient";
import { IconUser, IconStar, IconKey, IconLogOut, IconChevron, IconX, IconCheck, IconSun, IconMoon, IconSmartphone, IconBell, IconEdit, IconRefresh, IconDownload, IconTrash } from "../components/Icons";
import { CalendarLinkPanel } from "../components/CalendarLinkPanel";
import { PasswordInput } from "../components/PasswordInput";
import { Toggle } from "../components/Toggle";
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

export function Settings({ user, signOut, refreshUser }) {
  const { t } = useT();
  const { tutorial, navigate, theme, accentTheme, notifications, showToast, readOnly, noteCrypto, profession } = useCardigan();
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
      // Token is single-use; widget reissues a fresh one for the next attempt.
      setPasswordCaptchaToken(null);
      setPendingPasswordSubmit(false);
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
    setActiveSheet(key);
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
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  /* Map server-side reauth codes → user-facing Spanish messages so
     the prompt knows what to say beyond a generic "wrong password". */
  const reauthMessageFor = (code) => {
    if (code === "wrong_password") return t("settings.privacyReauthWrong");
    if (code === "password_required") return t("settings.privacyReauthRequired");
    if (code === "oauth_only") return t("settings.privacyReauthOauthOnly");
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
        body: JSON.stringify({ password: exportPassword }),
      });
      if (!res.ok) {
        // 401 with a code field → reauth issue; surface in the sheet so
        // the user can re-enter without losing the modal context.
        if (res.status === 401) {
          let code = ""; try { const j = await res.json(); code = j.code || ""; } catch { /* ignore */ }
          setExportError(reauthMessageFor(code));
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
      const res = await fetch("/api/delete-my-account", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirmation: deleteConfirm, password: deletePassword }),
      });
      if (!res.ok) {
        // 401 → reauth issue; keep the sheet open so the user can fix.
        if (res.status === 401) {
          let code = ""; try { const j = await res.json(); code = j.code || ""; } catch { /* ignore */ }
          setDeleteError(reauthMessageFor(code));
          return;
        }
        let msg = t("settings.privacyDeleteError");
        try { const j = await res.json(); if (j.error) msg = j.error; } catch { /* keep default */ }
        setDeleteError(msg);
        return;
      }
      // Cascade completed — sign out to clear the (now-orphan) session.
      await signOut();
    } finally {
      setDeleting(false);
    }
  };

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

      <div className="settings-label">{t("nav.principal")}</div>
      <div className="card" style={{ margin:"0 16px" }}>
        <div className="settings-row" style={{ cursor:"pointer" }} onClick={() => openSheet("profile")}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconUser size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.profile")}</div>
            <div className="settings-row-sub">{userName}</div>
          </div>
          <IconChevron />
        </div>
        <div className="settings-row" style={{ cursor:"pointer" }} onClick={() => openSheet("theme")}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}>{theme?.resolvedTheme === "dark" ? <IconMoon size={18} /> : <IconSun size={18} />}</div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.appearance")}</div>
            <div className="settings-row-sub">{theme?.preference === "light" ? t("settings.themeLight") : theme?.preference === "dark" ? t("settings.themeDark") : t("settings.themeSystem")}</div>
          </div>
          <IconChevron />
        </div>
        <div className="settings-row" style={{ cursor:"pointer" }} onClick={() => openSheet("accent")}>
          <div className="settings-row-icon" aria-hidden="true">
            <span style={{ display:"inline-block", width:18, height:18, borderRadius:"50%", background:"var(--teal)", border:"1px solid var(--border-lt)" }} />
          </div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.accentColor")}</div>
            <div className="settings-row-sub">{t(`settings.accent.${accentTheme?.accent || "default"}`)}</div>
          </div>
          <IconChevron />
        </div>
        <div className="settings-row" style={{ cursor:"pointer" }} onClick={restartTutorial}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconStar size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("tutorial.settingsRow")}</div>
            <div className="settings-row-sub">{t("tutorial.settingsRowSub")}</div>
          </div>
          <IconChevron />
        </div>
      </div>

      {notifications?.supported && (
        <>
          <div className="settings-label">{t("settings.notificationsSection")}</div>

          {/* ── PWA install gate (iOS Safari) ──
             When the user is on an iOS Safari tab rather than the
             installed PWA, the whole toggle flow is a dead end — push
             just doesn't work in Safari tabs. Surface the install
             guidance as a first-class card instead of a disabled row. */}
          {notifications.needsInstall ? (
            <PushInstallCard />
          ) : notifications.permission === "denied" ? (
            /* ── Permission blocked card ──
               Replaces the toggle entirely when the OS-level permission
               is denied. iOS gives us no programmatic path to the
               settings app, so the job is purely instructional. */
            <div className="push-amber-card" role="alert">
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
            <div className="card" style={{ margin:"0 16px", overflow:"hidden" }}>
              {/* ── Reconciliation inline banner ──
                 Replaces the previous toast-only surface: an expired
                 subscription is slightly more serious than a 3-second
                 toast conveys, and having a "Reactivar" button inline
                 means the remediation is one tap away. */}
              {notifications.reconciledOff && (
                <div className="push-inline-banner">
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

              <div className="settings-row">
                <div
                  className={`settings-row-icon${bellFx ? " bell-ring bell-glow" : ""}`}
                  style={{ color:"var(--teal-dark)" }}
                >
                  <IconBell size={18} />
                </div>
                <div style={{ flex:1 }}>
                  <div className="settings-row-title">{t("notifications.sessionReminders")}</div>
                  <div className="settings-row-sub">
                    {notifications.enabled
                      ? t("notifications.enabled")
                      : t("notifications.sessionRemindersDesc")}
                  </div>
                </div>
                <Toggle
                  on={notifications.enabled}
                  onToggle={handleToggleNotifications}
                  disabled={togglePending}
                  ariaLabel={t("notifications.sessionReminders")}
                />
              </div>

              <Expando open={!!notifications.enabled}>
                {/* ── Reminder lead time (inline segmented control) ──
                   Replaces the former full-screen sheet. Three options
                   don't earn a sheet, and the inline pill stays in
                   context with the toggle and preview. */}
                <div style={{ padding:"4px 14px 12px" }}>
                  <div style={{
                    fontSize:12, fontWeight:700,
                    color:"var(--charcoal-md)", letterSpacing:0.2,
                    textTransform:"uppercase",
                    margin:"6px 2px 8px",
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
                    value={notifications.reminderMinutes}
                    onChange={async (v) => {
                      if (v === notifications.reminderMinutes) return;
                      haptic.tap();
                      const res = await notifications.setReminderMinutes(v);
                      if (res && !res.ok) {
                        showToast(t(notifErrorKey(res.code)), "error");
                      }
                    }}
                  />
                </div>

              </Expando>
            </div>
          )}
        </>
      )}

      {!readOnly && (
        <>
          <div className="settings-label">{t("settings.calendarLabel")}</div>
          <div className="card" style={{ margin:"0 16px", padding:"14px 16px" }}>
            <CalendarLinkPanel readOnly={readOnly} />
          </div>
        </>
      )}

      <div className="settings-label">{t("settings.privacyLabel")}</div>
      <div className="card" style={{ margin:"0 16px" }}>
        {/* Two-factor (TOTP) — security row sits at the top of the
            privacy section since it's the strongest single account-
            level protection. */}
        {!readOnly && (
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
            <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconKey size={18} /></div>
            <div style={{ flex:1 }}>
              <div className="settings-row-title">{t("settings.mfaTitle")}</div>
              <div className="settings-row-sub">
                {mfa.loading ? "…" : mfa.factors.length > 0 ? t("settings.mfaActive") : t("settings.mfaInactive")}
              </div>
            </div>
            <IconChevron />
          </div>
        )}
        {/* Note encryption — primary affordance. The disabled / locked /
            unlocked states each render their own row(s). */}
        {!readOnly && noteCrypto && noteCrypto.status !== "loading" && (
          <>
            {noteCrypto.status === "disabled" && showEncryptionSetup && (
              <div className="settings-row" style={{ cursor:"pointer" }} onClick={() => { setEncUiError(""); setEncSetupPass1(""); setEncSetupPass2(""); setActiveSheet("encSetup"); }}>
                <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconKey size={18} /></div>
                <div style={{ flex:1 }}>
                  <div className="settings-row-title">{t("settings.encEnable")}</div>
                  <div className="settings-row-sub">{t("settings.encEnableSub")}</div>
                </div>
                <IconChevron />
              </div>
            )}
            {(noteCrypto.status === "locked" || noteCrypto.status === "unlocked") && (
              <>
                <div className="settings-row">
                  <div className="settings-row-icon" style={{ color: noteCrypto.status === "unlocked" ? "var(--green)" : "var(--charcoal-md)" }}><IconKey size={18} /></div>
                  <div style={{ flex:1 }}>
                    <div className="settings-row-title">{t("settings.encStatus")}</div>
                    <div className="settings-row-sub">{noteCrypto.status === "unlocked" ? t("settings.encStatusUnlocked") : t("settings.encStatusLocked")}</div>
                  </div>
                </div>
                {noteCrypto.status === "unlocked" && (
                  <>
                    <div className="settings-row" style={{ cursor:"pointer" }} onClick={() => { setEncUiError(""); setEncChangeNew1(""); setEncChangeNew2(""); setActiveSheet("encChange"); }}>
                      <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconEdit size={18} /></div>
                      <div style={{ flex:1 }}>
                        <div className="settings-row-title">{t("settings.encChange")}</div>
                        <div className="settings-row-sub">{t("settings.encChangeSub")}</div>
                      </div>
                      <IconChevron />
                    </div>
                    <div className="settings-row" style={{ cursor:"pointer" }} onClick={() => { setEncUiError(""); setEncConfirmDisable(""); setActiveSheet("encDisable"); }}>
                      <div className="settings-row-icon" style={{ color:"var(--red)" }}><IconTrash size={18} /></div>
                      <div style={{ flex:1 }}>
                        <div className="settings-row-title" style={{ color:"var(--red)" }}>{t("settings.encDisable")}</div>
                        <div className="settings-row-sub">{t("settings.encDisableSub")}</div>
                      </div>
                      <IconChevron />
                    </div>
                  </>
                )}
                {noteCrypto.status === "locked" && (
                  <div className="settings-row" style={{ paddingTop:6, paddingBottom:14 }}>
                    <div style={{ flex:1, fontSize:13, color:"var(--charcoal-md)", lineHeight:1.5 }}>
                      {t("settings.encLockedHint")}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
        {!readOnly && (
          <div className="settings-row" style={{ cursor: exporting ? "default" : "pointer" }}
            onClick={() => { if (!exporting) { setExportPassword(""); setExportError(""); setActiveSheet("exportData"); } }}>
            <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconDownload size={18} /></div>
            <div style={{ flex:1 }}>
              <div className="settings-row-title">{t("settings.privacyExport")}</div>
            </div>
            {exporting ? <span style={{ fontSize:12, color:"var(--charcoal-xl)" }}>…</span> : <IconChevron />}
          </div>
        )}
      </div>

      <div className="settings-label">{t("nav.account")}</div>
      <div className="card" style={{ margin:"0 16px" }}>
        {/* Plan moved here from its own section — it's an account-scoped
            attribute, not a top-level concern. */}
        <div className="settings-row" style={{ cursor:"pointer" }} onClick={() => openSheet("plan")}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconStar size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.planActive")}</div>
            <div className="settings-row-sub">{t("settings.planValue")}</div>
          </div>
          <IconChevron />
        </div>
        <div className="settings-row" style={{ cursor:"pointer" }}
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
        <div className="settings-row" style={{ cursor: updateChecking ? "default" : "pointer" }} onClick={checkForUpdate}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconRefresh size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.checkUpdate") || "Buscar actualización"}</div>
            {updateStatus && <div className="settings-row-sub" style={{ color: updateStatus.tone === "err" ? "var(--red)" : updateStatus.tone === "ok" ? "var(--green)" : "var(--charcoal-xl)" }}>{updateStatus.msg}</div>}
          </div>
          {updateChecking ? <span style={{ fontSize:12, color:"var(--charcoal-xl)" }}>…</span> : <IconChevron />}
        </div>
        <div className="settings-row" style={{ cursor:"pointer" }} onClick={signOut}>
          <div className="settings-row-icon" style={{ color:"var(--red)" }}><IconLogOut size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title" style={{ color:"var(--red)" }}>{t("nav.signOut")}</div>
          </div>
          <IconChevron />
        </div>
        {!readOnly && (
          <div className="settings-row" style={{ cursor:"pointer" }} onClick={() => setActiveSheet("signOutEverywhere")}>
            <div className="settings-row-icon" style={{ color:"var(--red)" }}><IconLogOut size={18} /></div>
            <div style={{ flex:1 }}>
              <div className="settings-row-title" style={{ color:"var(--red)" }}>{t("settings.signOutEverywhere")}</div>
              <div className="settings-row-sub">{t("settings.signOutEverywhereSub")}</div>
            </div>
            <IconChevron />
          </div>
        )}
      </div>

      {/* Account deletion lives in its own bottom-of-page section so it
          can't be tapped by accident while scanning Settings. */}
      {!readOnly && (
        <>
          <div className="settings-label">{t("settings.dangerZone")}</div>
          <div className="card" style={{ margin:"0 16px" }}>
            <div className="settings-row" style={{ cursor:"pointer" }} onClick={() => { setDeleteConfirm(""); setDeleteError(""); setActiveSheet("deleteAccount"); }}>
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

      {/* Footnote-style legal link — the policy is rarely consulted but
          must remain reachable from every account screen for LFPDPPP
          compliance. Centred, low-contrast, no chrome. */}
      <div style={{ textAlign:"center", padding:"24px 16px 28px" }}>
        <button
          type="button"
          onClick={() => navigate("privacy")}
          style={{
            background:"transparent",
            border:"none",
            padding:"4px 8px",
            fontSize:11,
            color:"var(--charcoal-xl)",
            textDecoration:"underline",
            cursor:"pointer",
            WebkitTapHighlightColor:"transparent",
          }}
        >
          {t("settings.privacyPolicy")}
        </button>
      </div>

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

      {/* ── PLAN SHEET ── */}
      {activeSheet === "plan" && (
        <div className="sheet-overlay" onClick={() => setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.plan")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => setActiveSheet(null)}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px", textAlign:"center" }}>
              <div style={{ width:48, height:48, background:"var(--amber-bg)", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px", color:"var(--amber)" }}>
                <IconStar size={22} />
              </div>
              <div style={{ fontFamily:"var(--font-d)", fontSize:18, fontWeight:800, color:"var(--charcoal)", marginBottom:4 }}>{t("settings.planValue")}</div>
              <div style={{ fontSize:13, color:"var(--charcoal-xl)", lineHeight:1.5 }}>
                {t("settings.planDescription")}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── ENCRYPTION SETUP SHEET ── */}
      {activeSheet === "encSetup" && (
        <div className="sheet-overlay" onClick={() => !encBusy && setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.encEnable")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => !encBusy && setActiveSheet(null)} disabled={encBusy}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
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
              <div className="input-group" style={{ marginBottom: 14 }}>
                <label className="input-label">{t("settings.privacyDeleteConfirmLabel")}</label>
                <input
                  className="input"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder="ELIMINAR"
                  disabled={deleting}
                />
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
              {deleteError && (
                <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{deleteError}</div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={confirmDeleteAccount}
                  disabled={deleting || deleteConfirm !== "ELIMINAR" || !deletePassword}
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
                  <TurnstileWidget onToken={setPasswordCaptchaToken} />
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
              {exportError && (
                <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{exportError}</div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={exportMyData}
                  disabled={exporting || !exportPassword}
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
    </div>
  );
}
