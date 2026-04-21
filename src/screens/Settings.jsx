import { useState, useCallback, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { IconUser, IconStar, IconClipboard, IconKey, IconLogOut, IconChevron, IconX, IconCheck, IconSun, IconMoon, IconSmartphone, IconBell } from "../components/Icons";
import { Toggle } from "../components/Toggle";
import { Avatar } from "../components/Avatar";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";
import { useSheetDrag } from "../hooks/useSheetDrag";
import { useCardigan } from "../context/CardiganContext";

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

export function Settings({ user, signOut }) {
  const { t } = useT();
  const { tutorial, navigate, theme, notifications, showToast } = useCardigan();

  // Surface the reconciliation message exactly once per session — the
  // hook raised the flag because we silently flipped enabled off on
  // load (browser subscription expired).
  useEffect(() => {
    if (notifications?.reconciledOff) {
      showToast(t("notifications.reconciledOff"), "warning");
      notifications.clearReconciliationMessage?.();
    }
    // showToast + t are stable-ish; rerun if the flag toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications?.reconciledOff]);

  const [testing, setTesting] = useState(false);
  const handleToggleNotifications = async () => {
    if (!notifications) return;
    if (notifications.needsInstall) {
      showToast(t("notifications.toastInstallRequired"), "warning");
      return;
    }
    if (notifications.enabled) {
      const res = await notifications.disable();
      if (res?.ok) showToast(t("notifications.toastDisabled"), "info");
      else showToast(t(notifErrorKey(res?.code)), "error");
    } else {
      const res = await notifications.enable();
      if (res?.ok) showToast(t("notifications.toastEnabled"), "success");
      else showToast(t(notifErrorKey(res?.code)), res?.code === "permission-denied" ? "warning" : "error");
    }
  };
  const handleSendTest = async () => {
    if (!notifications || testing) return;
    setTesting(true);
    const res = await notifications.sendTest();
    setTesting(false);
    if (res?.ok) showToast(t("notifications.testSent"), "success");
    else if (res?.code === "no-subscription") showToast(t("notifications.testFailedNoSub"), "warning");
    else showToast(t("notifications.testFailed"), "error");
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

  const resetPassword = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(userEmail);
      if (error) { setMessage(t("settings.emailError")); return; }
      setMessage(t("settings.linkSent"));
      setTimeout(() => setMessage(""), 3000);
    } catch {
      setMessage(t("settings.emailError"));
    } finally {
      setSaving(false);
    }
  };

  const openSheet = (key) => {
    setMessage("");
    if (key === "profile") setEditName(userName);
    setActiveSheet(key);
  };

  const restartTutorial = () => {
    navigate("home");
    setTimeout(() => { tutorial?.reset?.(); }, 340);
  };

  return (
    <div className="page">
      <div className="section" style={{ paddingTop:16 }}>
        <div className="card" style={{ padding:16 }}>
          <div className="flex items-center gap-3">
            <Avatar initials={userInitial} color="var(--teal)" size="lg" />
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
          <div className="card" style={{ margin:"0 16px" }}>
            <div className="settings-row">
              <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconBell size={18} /></div>
              <div style={{ flex:1 }}>
                <div className="settings-row-title">{t("notifications.sessionReminders")}</div>
                <div className="settings-row-sub">
                  {notifications.needsInstall
                    ? t("notifications.installRequired")
                    : notifications.permission === "denied"
                    ? t("notifications.permissionDenied")
                    : notifications.enabled
                    ? t("notifications.enabled")
                    : t("notifications.sessionRemindersDesc")}
                </div>
              </div>
              <Toggle
                on={notifications.enabled}
                onToggle={handleToggleNotifications}
              />
            </div>
            {notifications.enabled && (
              <>
                <div className="settings-row" style={{ cursor:"pointer" }} onClick={() => openSheet("reminderTime")}>
                  <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconCheck size={18} /></div>
                  <div style={{ flex:1 }}>
                    <div className="settings-row-title">{t("notifications.reminderTime")}</div>
                    <div className="settings-row-sub">
                      {notifications.reminderMinutes === 15 ? t("notifications.15min")
                        : notifications.reminderMinutes === 60 ? t("notifications.60min")
                        : t("notifications.30min")}
                    </div>
                  </div>
                  <IconChevron />
                </div>
                <div className="settings-row" role="button" tabIndex={0}
                  onClick={handleSendTest}
                  style={{ cursor: testing ? "default" : "pointer", opacity: testing ? 0.6 : 1 }}>
                  <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconBell size={18} /></div>
                  <div style={{ flex:1 }}>
                    <div className="settings-row-title">
                      {testing ? t("notifications.sendingTest") : t("notifications.sendTest")}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}

      <div className="settings-label">{t("settings.plan")}</div>
      <div className="card" style={{ margin:"0 16px" }}>
        <div className="settings-row" style={{ cursor:"pointer" }} onClick={() => openSheet("plan")}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconStar size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.planActive")}</div>
            <div className="settings-row-sub">{t("settings.planValue")}</div>
          </div>
          <IconChevron />
        </div>
      </div>

      <div className="settings-label">{t("nav.account")}</div>
      <div className="card" style={{ margin:"0 16px" }}>
        <div className="settings-row" style={{ cursor:"pointer" }} onClick={resetPassword}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconKey size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.changePassword")}</div>
            {message && activeSheet === null && <div className="settings-row-sub" style={{ color:"var(--green)" }}>{message}</div>}
          </div>
          <IconChevron />
        </div>
        <div className="settings-row" style={{ cursor:"pointer" }} onClick={signOut}>
          <div className="settings-row-icon" style={{ color:"var(--red)" }}><IconLogOut size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title" style={{ color:"var(--red)" }}>{t("nav.signOut")}</div>
          </div>
          <IconChevron />
        </div>
      </div>

      <div style={{ height:20 }} />

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

      {/* ── REMINDER TIME SHEET ── */}
      {activeSheet === "reminderTime" && (
        <div className="sheet-overlay" onClick={() => setActiveSheet(null)}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("notifications.reminderTime")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => setActiveSheet(null)}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              {[
                { key: 15, label: t("notifications.15min") },
                { key: 30, label: t("notifications.30min") },
                { key: 60, label: t("notifications.60min") },
              ].map(opt => (
                <div key={opt.key} className="settings-row" style={{ cursor:"pointer" }}
                  onClick={() => { notifications?.setReminderMinutes(opt.key); setActiveSheet(null); }}>
                  <div style={{ flex:1 }}>
                    <div className="settings-row-title">{opt.label}</div>
                  </div>
                  {notifications?.reminderMinutes === opt.key && <IconCheck size={18} style={{ color:"var(--teal)" }} />}
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
    </div>
  );
}
