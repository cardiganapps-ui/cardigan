import { useState } from "react";
import { supabase } from "../supabaseClient";
import { LogoIcon } from "../components/LogoMark";
import { useT } from "../i18n/index";

export function AuthScreen({ onSignIn, onSignUp, onDemo }) {
  const { t } = useT();
  const [mode, setMode] = useState("login"); // login | signup | reset
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const switchMode = (m) => { setMode(m); setError(""); setMessage(""); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);

    if (mode === "reset") {
      if (!email.trim()) { setError(t("auth.enterEmail")); setSubmitting(false); return; }
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim());
      setSubmitting(false);
      if (err) { setError(err.message); return; }
      setMessage(t("settings.linkSent"));
      return;
    }

    if (mode === "signup") {
      if (!name.trim()) { setError(t("auth.enterName")); setSubmitting(false); return; }
      const result = await onSignUp({ email, password, name: name.trim() });
      setSubmitting(false);
      if (result.error) { setError(result.error); return; }
      setMessage(t("settings.linkSent"));
      return;
    }

    const result = await onSignIn({ email, password });
    setSubmitting(false);
    if (result.error) { setError(result.error); return; }
  };

  return (
    <div className="auth-screen">
      <div className="auth-header">
        <LogoIcon size={52} color="white" />
        <div className="auth-wordmark">cardigan</div>
        <div className="auth-tagline">{t("auth.tagline")}</div>
      </div>
      <div className="auth-body">
        {message ? (
          <div style={{ textAlign:"center", paddingTop:20 }}>
            <div style={{ fontFamily:"var(--font-d)", fontSize:18, fontWeight:800, color:"var(--charcoal)", marginBottom:12 }}>{t("done")}</div>
            <div style={{ fontSize:14, color:"var(--charcoal-lt)", lineHeight:1.6, marginBottom:24 }}>{message}</div>
            <button className="btn btn-primary" onClick={() => switchMode("login")}>{t("auth.signIn")}</button>
          </div>
        ) : (
          <>
            {mode !== "reset" && (
              <div className="auth-toggle" role="tablist">
                <button role="tab" aria-selected={mode==="login"} className={`auth-tab ${mode==="login"?"active":""}`} onClick={() => switchMode("login")}>{t("auth.signIn")}</button>
                <button role="tab" aria-selected={mode==="signup"} className={`auth-tab ${mode==="signup"?"active":""}`} onClick={() => switchMode("signup")}>{t("auth.signUp")}</button>
              </div>
            )}
            {mode === "reset" && (
              <div style={{ marginBottom:20 }}>
                <div style={{ fontFamily:"var(--font-d)", fontSize:17, fontWeight:800, color:"var(--charcoal)", marginBottom:6 }}>{t("auth.resetPassword")}</div>
                <div style={{ fontSize:13, color:"var(--charcoal-xl)", lineHeight:1.5 }}>{t("auth.resetHint")}</div>
              </div>
            )}
            <form onSubmit={handleSubmit}>
              {mode === "signup" && (
                <div className="input-group">
                  <label className="input-label">{t("settings.fullName")}</label>
                  <input className="input" placeholder={t("auth.namePlaceholder")} type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
                </div>
              )}
              <div className="input-group">
                <label className="input-label">{t("settings.email")}</label>
                <input className="input" placeholder={t("auth.emailPlaceholder")} type="email" autoComplete="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              {mode !== "reset" && (
                <div className="input-group">
                  <label className="input-label">{t("auth.enterPassword")}</label>
                  <input className="input" placeholder={t("auth.passwordPlaceholder")} type="password" autoComplete={mode==="login"?"current-password":"new-password"} value={password} onChange={e => setPassword(e.target.value)} />
                </div>
              )}
              {error && <div style={{ fontSize:13, color:"var(--red)", marginBottom:12 }}>{error}</div>}
              {mode === "login" && (
                <div style={{ textAlign:"right", marginBottom:14, marginTop:-6 }}>
                  <button type="button" className="btn btn-ghost" style={{ height:36,fontSize:13,color:"var(--teal-dark)" }} onClick={() => switchMode("reset")}>{t("auth.resetPassword")}</button>
                </div>
              )}
              <button className="btn btn-primary" type="submit" disabled={submitting}>
                {submitting ? t("loading") : mode==="login" ? t("auth.signIn") : mode==="signup" ? t("auth.createAccount") : t("auth.sendLink")}
              </button>
            </form>
            {mode === "reset" && (
              <div style={{ textAlign:"center", marginTop:16 }}>
                <button type="button" className="btn btn-ghost" onClick={() => switchMode("login")}>{t("auth.signIn")}</button>
              </div>
            )}
          </>
        )}
        <div style={{ marginTop:24, paddingTop:20, borderTop:"1px solid var(--border-lt)", textAlign:"center" }}>
          <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginBottom:10 }}>{t("auth.demo")}</div>
          <button type="button" onClick={onDemo}
            style={{ padding:"12px 28px", fontSize:13, fontWeight:700, borderRadius:"var(--radius-pill)", border:"1.5px solid var(--teal)", background:"var(--white)", color:"var(--teal-dark)", cursor:"pointer", fontFamily:"var(--font)" }}>
            {t("auth.demo")}
          </button>
        </div>
      </div>
    </div>
  );
}
