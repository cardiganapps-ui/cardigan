import { useState } from "react";
import { supabase } from "../supabaseClient";
import { LogoIcon } from "../components/LogoMark";
import { IconCalendar, IconUsers, IconDollar, IconClipboard, IconDocument, IconHome, IconX } from "../components/Icons";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";

const FEATURE_ICONS = [IconCalendar, IconUsers, IconDollar, IconClipboard, IconDocument, IconHome];

/* ── Auth form (reused inside sheet) ── */
function AuthForm({ mode, setMode, onSignIn, onSignUp, t }) {
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

/* ── Landing page ── */
export function AuthScreen({ onSignIn, onSignUp, onDemo }) {
  const { t, strings } = useT();
  const [showAuth, setShowAuth] = useState(false);
  useEscape(showAuth ? () => setShowAuth(false) : null);
  const [authMode, setAuthMode] = useState("signup");

  const openAuth = (mode) => { setAuthMode(mode); setShowAuth(true); };

  const painItems = strings.landing?.painItems || [];
  const afterItems = strings.landing?.afterItems || [];
  const featureTitles = strings.landing?.featureTitles || [];
  const featureDescs = strings.landing?.featureDescs || [];

  return (
    <div className="landing">
      {/* ── Nav ── */}
      <div className="landing-nav">
        <div className="landing-nav-brand">
          <LogoIcon size={24} color="var(--teal-dark)" />
          <span>cardigan</span>
        </div>
        <div className="landing-nav-actions">
          <button className="landing-cta-ghost" style={{ padding: "8px 16px", fontSize: 12 }} onClick={onDemo}>
            {t("landing.ctaDemo")}
          </button>
          <button className="landing-cta-btn" style={{ padding: "8px 16px", fontSize: 12 }} onClick={() => openAuth("signup")}>
            {t("landing.cta")}
          </button>
        </div>
      </div>

      {/* ── Hero ── */}
      <div className="landing-hero">
        <div className="landing-hero-title">
          {t("landing.heroTitle")}
          <br />
          <span className="landing-hero-accent">{t("landing.heroTitleAccent")}</span>
        </div>
        <div className="landing-hero-sub">{t("landing.heroSub")}</div>
        <div className="landing-hero-ctas">
          <button className="landing-cta-btn" onClick={() => openAuth("signup")}>{t("landing.cta")}</button>
          <button className="landing-cta-ghost" onClick={onDemo}>{t("landing.ctaDemo")}</button>
        </div>
      </div>

      {/* ── Pain points: Before vs After ── */}
      <div className="landing-section">
        <div className="landing-heading">{t("landing.painTitle")}</div>
        <div className="landing-compare">
          <div className="landing-compare-col before">
            <div className="landing-compare-label">{t("landing.painBefore")}</div>
            {painItems.map((item, i) => (
              <div key={i} className="landing-compare-item">
                <span style={{ color: "var(--red)", flexShrink: 0, fontWeight: 700 }}>✕</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
          <div className="landing-compare-col after">
            <div className="landing-compare-label">{t("landing.painAfter")}</div>
            {afterItems.map((item, i) => (
              <div key={i} className="landing-compare-item">
                <span style={{ color: "var(--green)", flexShrink: 0, fontWeight: 700 }}>✓</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Features grid ── */}
      <div className="landing-section" style={{ background: "var(--teal-mist)" }}>
        <div className="landing-heading">{t("landing.featuresTitle")}</div>
        <div className="landing-grid">
          {featureTitles.map((title, i) => {
            const Icon = FEATURE_ICONS[i];
            return (
              <div key={i} className="landing-card">
                <div className="landing-card-icon">{Icon && <Icon size={20} />}</div>
                <div className="landing-card-title">{title}</div>
                <div className="landing-card-desc">{featureDescs[i]}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Trust / social proof ── */}
      <div className="landing-section">
        <div className="landing-trust">
          <div className="landing-trust-title">{t("landing.trustTitle")}</div>
          <div className="landing-trust-sub">{t("landing.trustSub")}</div>
          <div className="landing-badge">{t("landing.trustBadge")}</div>
        </div>
      </div>

      {/* ── Final CTA ── */}
      <div className="landing-section-dark">
        <div className="landing-footer-heading">{t("landing.finalCta")}</div>
        <div className="landing-footer-sub">{t("landing.finalCtaSub")}</div>
        <div className="landing-footer-ctas">
          <button className="landing-cta-btn" onClick={() => openAuth("signup")}>{t("landing.cta")}</button>
          <button className="landing-footer-link" onClick={onDemo}>{t("landing.ctaDemo")}</button>
        </div>
        <div style={{ marginTop: 20 }}>
          <button className="landing-footer-link" onClick={() => openAuth("login")}>{t("landing.login")}</button>
        </div>
      </div>

      {/* ── Auth sheet ── */}
      {showAuth && (
        <div className="sheet-overlay" onClick={() => setShowAuth(false)}>
          <div className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{authMode === "login" ? t("auth.signIn") : authMode === "signup" ? t("auth.signUp") : t("auth.resetPassword")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => setShowAuth(false)}>
                <IconX size={14} />
              </button>
            </div>
            <div style={{ padding: "0 20px 22px" }}>
              <AuthForm mode={authMode} setMode={setAuthMode} onSignIn={onSignIn} onSignUp={onSignUp} t={t} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
