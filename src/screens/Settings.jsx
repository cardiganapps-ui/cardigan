import { useState } from "react";
import { supabase } from "../supabaseClient";
import { IconUser, IconCurrency, IconStar, IconClipboard, IconKey, IconLogOut, IconChevron, IconX, IconCheck } from "../components/Icons";
import { useT } from "../i18n/index";

export function Settings({ user, signOut }) {
  const { t } = useT();
  const userName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuario";
  const userEmail = user?.email || "";
  const userInitial = userName.charAt(0).toUpperCase();

  const [activeSheet, setActiveSheet] = useState(null);
  const [editName, setEditName] = useState(userName);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const saveProfile = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ data: { full_name: editName.trim() } });
    setSaving(false);
    if (error) { setMessage(t("settings.saveError")); return; }
    setMessage(t("settings.linkSent"));
    setTimeout(() => { setMessage(""); setActiveSheet(null); }, 1200);
  };

  const resetPassword = async () => {
    setSaving(true);
    const { error } = await supabase.auth.resetPasswordForEmail(userEmail);
    setSaving(false);
    if (error) { setMessage(t("settings.emailError")); return; }
    setMessage(t("settings.linkSent"));
    setTimeout(() => setMessage(""), 3000);
  };

  const openSheet = (key) => {
    setMessage("");
    if (key === "profile") setEditName(userName);
    setActiveSheet(key);
  };

  return (
    <div className="page">
      <div className="section" style={{ paddingTop:20 }}>
        <div className="card" style={{ padding:16 }}>
          <div className="flex items-center gap-3">
            <div style={{ width:52,height:52,background:"var(--teal)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--font-d)",fontSize:18,fontWeight:800,color:"white" }}>{userInitial}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:"var(--font-d)",fontSize:16,fontWeight:800,color:"var(--charcoal)" }}>{userName}</div>
              <div style={{ fontSize:12.5,color:"var(--charcoal-xl)",marginTop:2 }}>{userEmail}</div>
            </div>
            <button className="btn btn-ghost" style={{ fontSize:13,height:34 }} onClick={() => openSheet("profile")}>{t("edit")}</button>
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
        <div className="settings-row" style={{ cursor:"pointer" }} onClick={() => openSheet("currency")}>
          <div className="settings-row-icon" style={{ color:"var(--teal-dark)" }}><IconCurrency size={18} /></div>
          <div style={{ flex:1 }}>
            <div className="settings-row-title">{t("settings.currency")}</div>
            <div className="settings-row-sub">MXN — Peso Mexicano</div>
          </div>
          <IconChevron />
        </div>
      </div>

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
          <div className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
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
              <button className="btn btn-primary" onClick={saveProfile} disabled={saving || !editName.trim()}>
                {saving ? t("saving") : t("save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CURRENCY SHEET ── */}
      {activeSheet === "currency" && (
        <div className="sheet-overlay" onClick={() => setActiveSheet(null)}>
          <div className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("settings.currency")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => setActiveSheet(null)}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              <div className="card" style={{ padding:"14px 16px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:600, color:"var(--charcoal)" }}>MXN — Peso Mexicano</div>
                  <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginTop:2 }}>$1,000.00</div>
                </div>
                <div style={{ color:"var(--teal)" }}><IconCheck size={18} /></div>
              </div>
              <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginTop:12, lineHeight:1.5, textAlign:"center" }}>
                {t("settings.currencySoon")}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PLAN SHEET ── */}
      {activeSheet === "plan" && (
        <div className="sheet-overlay" onClick={() => setActiveSheet(null)}>
          <div className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
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
