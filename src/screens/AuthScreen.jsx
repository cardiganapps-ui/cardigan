import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { LandingPage } from "../components/landing/LandingPage";
import { IconX, IconGoogle, IconApple } from "../components/Icons";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";
import { useSheetDrag } from "../hooks/useSheetDrag";

/* ── Auth form (reused inside sheet) ──
   The landing page is English; the auth form stays in Spanish to match
   the rest of the app, which is Spanish-only per CLAUDE.md. */
function AuthForm({ mode, setMode, onSignIn, onSignUp, onProvider, t }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [providerBusy, setProviderBusy] = useState(null);
  const [message, setMessage] = useState("");

  const switchMode = (m) => { setMode(m); setError(""); setMessage(""); };

  const handleProvider = async (provider) => {
    if (!onProvider || providerBusy) return;
    setError("");
    setProviderBusy(provider);
    const result = await onProvider(provider);
    // On success Supabase redirects away, so we only reach here on failure.
    if (result?.error) {
      setError(result.error || t("auth.providerError"));
      setProviderBusy(null);
    }
  };

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
      return;
    }

    const result = await onSignIn({ email, password });
    setSubmitting(false);
    if (result.error) { setError(result.error); return; }
  };

  if (message) {
    return (
      <div style={{ textAlign: "center", paddingTop: 8 }}>
        <div style={{ fontFamily: "var(--font-d)", fontSize: 18, fontWeight: 800, color: "var(--charcoal)", marginBottom: 12 }}>{t("done")}</div>
        <div style={{ fontSize: 14, color: "var(--charcoal-lt)", lineHeight: 1.6, marginBottom: 24 }}>{message}</div>
        <button className="btn btn-primary" onClick={() => switchMode("login")}>{t("auth.signIn")}</button>
      </div>
    );
  }

  return (
    <>
      {mode !== "reset" && (
        <div className="auth-toggle" role="tablist">
          <button role="tab" aria-selected={mode === "login"} className={`auth-tab ${mode === "login" ? "active" : ""}`} onClick={() => switchMode("login")}>{t("auth.signIn")}</button>
          <button role="tab" aria-selected={mode === "signup"} className={`auth-tab ${mode === "signup" ? "active" : ""}`} onClick={() => switchMode("signup")}>{t("auth.signUp")}</button>
        </div>
      )}
      {mode === "reset" && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: "var(--font-d)", fontSize: 17, fontWeight: 800, color: "var(--charcoal)", marginBottom: 6 }}>{t("auth.resetPassword")}</div>
          <div style={{ fontSize: 13, color: "var(--charcoal-xl)", lineHeight: 1.5 }}>{t("auth.resetHint")}</div>
        </div>
      )}
      {mode !== "reset" && onProvider && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16, marginBottom: 18 }}>
            <button
              type="button"
              className="btn btn-oauth btn-oauth-google"
              disabled={!!providerBusy}
              onClick={() => handleProvider("google")}
            >
              <IconGoogle size={18} />
              <span>{t("auth.continueWithGoogle")}</span>
            </button>
            <button
              type="button"
              className="btn btn-oauth btn-oauth-apple"
              disabled={!!providerBusy}
              onClick={() => handleProvider("apple")}
            >
              <IconApple size={18} />
              <span>{t("auth.continueWithApple")}</span>
            </button>
          </div>
          <div className="auth-divider" aria-hidden="true">
            <span>{t("auth.orWithEmail")}</span>
          </div>
        </>
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
            <input className="input" placeholder={t("auth.passwordPlaceholder")} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={e => setPassword(e.target.value)} />
          </div>
        )}
        {error && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{error}</div>}
        {mode === "login" && (
          <div style={{ textAlign: "right", marginBottom: 14, marginTop: -6 }}>
            <button type="button" className="btn btn-ghost" style={{ height: 36, fontSize: 13, color: "var(--teal-dark)" }} onClick={() => switchMode("reset")}>{t("auth.resetPassword")}</button>
          </div>
        )}
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? t("loading") : mode === "login" ? t("auth.signIn") : mode === "signup" ? t("auth.createAccount") : t("auth.sendLink")}
        </button>
      </form>
      {mode === "reset" && (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" onClick={() => switchMode("login")}>{t("auth.signIn")}</button>
        </div>
      )}
    </>
  );
}

/* ── Auth screen ──
   Thin shell: renders the marketing landing page, and wires the landing
   CTAs to either the auth sheet (signup / sign in) or demo mode (the
   "See how it works" secondary CTA). */
export function AuthScreen({ onSignIn, onSignUp, onProvider, onDemo, autoOpen }) {
  const { t } = useT();
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState("signup");
  useEscape(showAuth ? () => setShowAuth(false) : null);
  const closeAuth = () => setShowAuth(false);
  const { scrollRef: authScrollRef, setPanelEl: setAuthPanelEl, panelHandlers: authPanelHandlers } = useSheetDrag(closeAuth, { isOpen: showAuth });
  const setAuthPanel = (el) => { authScrollRef.current = el; setAuthPanelEl(el); };

  const openAuth = (mode) => { setAuthMode(mode); setShowAuth(true); };

  // When we mount because the user clicked "Crear cuenta" from the demo
  // banner, jump straight into the signup sheet instead of the marketing page.
  useEffect(() => {
    if (autoOpen === "signup" || autoOpen === "login") openAuth(autoOpen);
  }, [autoOpen]);

  return (
    <>
      <LandingPage
        onPrimary={() => openAuth("signup")}
        onSecondary={onDemo}
        onLogin={() => openAuth("login")}
      />

      {showAuth && (
        <div className="sheet-overlay" onClick={() => setShowAuth(false)}>
          <div ref={setAuthPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...authPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">
                {authMode === "login" ? t("auth.signIn") : authMode === "signup" ? t("auth.signUp") : t("auth.resetPassword")}
              </span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => setShowAuth(false)}>
                <IconX size={14} />
              </button>
            </div>
            <div style={{ padding: "0 20px 22px" }}>
              <AuthForm mode={authMode} setMode={setAuthMode} onSignIn={onSignIn} onSignUp={onSignUp} onProvider={onProvider} t={t} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
