import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { supabase } from "../supabaseClient";
import { IconUser, IconStar, IconKey, IconLogOut, IconChevron, IconX, IconCheck, IconSun, IconMoon, IconSmartphone, IconBell } from "../components/Icons";
import { Toggle } from "../components/Toggle";
import { Avatar } from "../components/Avatar";
import { SegmentedControl } from "../components/SegmentedControl";
import { Expando } from "../components/Expando";
import { NotificationPreview } from "../components/NotificationPreview";
import { PushInstallCard } from "../components/PushInstallCard";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";
import { useSheetDrag } from "../hooks/useSheetDrag";
import { useCardigan } from "../context/CardiganContext";
import { haptic } from "../utils/haptics";
import { parseShortDate, SHORT_MONTHS } from "../utils/dates";

const WEEKDAYS_SHORT_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

// Compute the next scheduled session within the next 24 hours. Returns
// { session, atDate } or null if none. Used by both the preview card
// (0.3) and the "next reminder" hint (0.4).
function computeNextReminder(upcomingSessions) {
  if (!Array.isArray(upcomingSessions) || upcomingSessions.length === 0) return null;
  const now = new Date();
  const cutoff = now.getTime() + 24 * 60 * 60 * 1000;
  let best = null;
  for (const s of upcomingSessions) {
    if (s.status !== "scheduled") continue;
    if (!s.date || !s.time) continue;
    const d = parseShortDate(s.date);
    if (!d) continue;
    const [h, m] = String(s.time).split(":").map((n) => parseInt(n, 10) || 0);
    d.setHours(h, m, 0, 0);
    const ts = d.getTime();
    if (ts <= now.getTime() || ts > cutoff) continue;
    if (!best || ts < best.ts) best = { ts, session: s, atDate: d };
  }
  return best ? { session: best.session, atDate: best.atDate } : null;
}

function formatNextReminder(atDate, patientName) {
  const pad = (n) => String(n).padStart(2, "0");
  const dow = WEEKDAYS_SHORT_ES[atDate.getDay()];
  const day = atDate.getDate();
  const mon = SHORT_MONTHS[atDate.getMonth()];
  const time = `${pad(atDate.getHours())}:${pad(atDate.getMinutes())}`;
  return `${dow} ${day} ${mon} ${time} · ${patientName}`;
}

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
  const { tutorial, navigate, theme, notifications, showToast, upcomingSessions } = useCardigan();

  // Inline "next reminder" hint + preview-card data.
  const nextReminder = useMemo(() => computeNextReminder(upcomingSessions), [upcomingSessions]);

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

  // Test-send state machine: null → "sending" → "ok" | "err". Idle
  // resets after ~3s so the row goes back to its default affordance.
  const [testState, setTestState] = useState(null); // null | "sending" | "ok" | "err"
  useEffect(() => {
    if (testState !== "ok" && testState !== "err") return;
    const id = setTimeout(() => setTestState(null), 3000);
    return () => clearTimeout(id);
  }, [testState]);

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

  const handleSendTest = async () => {
    if (!notifications || testState === "sending") return;
    setTestState("sending");
    const res = await notifications.sendTest();
    if (res?.ok) {
      haptic.success();
      setTestState("ok");
      return;
    }
    haptic.warn();
    if (res?.code === "no-subscription") {
      // Distinct actionable case — a toast explains the remediation
      // (toggle off/on) which doesn't fit the inline pill.
      setTestState("err");
      showToast(t("notifications.testFailedNoSub"), "warning");
      return;
    }
    setTestState("err");
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
                  background:"var(--amber)", color:"#FFFFFF",
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
                      background:"var(--amber)", color:"#FFFFFF",
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
                    background:"var(--amber)", color:"#FFFFFF",
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
                        background:"var(--amber)", color:"#FFFFFF",
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
                  pending={togglePending}
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
                    onChange={(v) => {
                      if (v === notifications.reminderMinutes) return;
                      haptic.tap();
                      notifications.setReminderMinutes(v);
                    }}
                  />
                </div>

                {/* ── Live preview card (0.3) ── */}
                <NotificationPreview
                  upcoming={nextReminder?.session || null}
                  reminderMinutes={notifications.reminderMinutes}
                />

                {/* ── Send test row with inline state machine (0.5) ── */}
                <div
                  className={`settings-row${testState === "ok" ? " test-row-pulse" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={testState === "sending" ? undefined : handleSendTest}
                  onKeyDown={(e) => {
                    if (testState === "sending") return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSendTest();
                    }
                  }}
                  style={{
                    cursor: testState === "sending" ? "default" : "pointer",
                    opacity: testState === "sending" ? 0.75 : 1,
                  }}
                >
                  <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}>
                    <IconBell size={18} />
                  </div>
                  <div style={{ flex:1 }}>
                    <div className="settings-row-title">
                      {testState === "sending"
                        ? t("notifications.sendingTest")
                        : t("notifications.sendTest")}
                    </div>
                  </div>
                  {testState === "sending" && (
                    <span
                      aria-hidden="true"
                      style={{
                        width:16, height:16, borderRadius:"50%",
                        border:"2px solid rgba(12,17,29,0.14)",
                        borderTopColor:"var(--teal-dark)",
                        animation:"togglePendingSpin 0.7s linear infinite",
                        marginRight:4,
                      }}
                    />
                  )}
                  {testState === "ok" && (
                    <span
                      role="status"
                      style={{
                        display:"inline-flex", alignItems:"center", gap:4,
                        padding:"3px 10px",
                        background:"var(--teal)", color:"#FFFFFF",
                        borderRadius:999,
                        fontSize:12, fontWeight:700,
                      }}
                    >
                      <IconCheck size={12} /> {t("notifications.testSentShort")}
                    </span>
                  )}
                  {testState === "err" && (
                    <span
                      role="status"
                      style={{
                        display:"inline-flex", alignItems:"center", gap:4,
                        padding:"3px 10px",
                        background:"var(--amber-bg)", color:"var(--amber)",
                        border:"1px solid rgba(224,138,30,0.35)",
                        borderRadius:999,
                        fontSize:12, fontWeight:700,
                      }}
                    >
                      {t("notifications.testRetry")}
                    </span>
                  )}
                </div>

                {/* ── Next-reminder hint (0.4) ── */}
                <div style={{
                  padding:"0 16px 14px",
                  fontSize:12, color:"var(--charcoal-xl)",
                  lineHeight:1.4,
                }}>
                  {nextReminder
                    ? `${t("notifications.nextReminderLabel")}: ${formatNextReminder(nextReminder.atDate, nextReminder.session.patient)}`
                    : t("notifications.nextReminderNone")}
                </div>
              </Expando>
            </div>
          )}
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
