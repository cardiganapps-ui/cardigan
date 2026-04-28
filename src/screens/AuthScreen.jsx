import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { LandingPage } from "../components/landing/LandingPage";
import { IconX, IconGoogle, IconApple } from "../components/Icons";
import { PasswordInput } from "../components/PasswordInput";
import { TurnstileWidget, TURNSTILE_ENABLED } from "../components/TurnstileWidget";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";
import { useSheetDrag } from "../hooks/useSheetDrag";

/* ── Verification panel ──
   Shown inside the auth sheet when signUp returns pendingVerification
   (email verification is required) or when a signIn attempt is rejected
   because the email hasn't been verified yet. Same look & feel as the
   branded email templates: teal accent bar, big Nunito headline, warm
   muted body copy, charcoal primary CTA.

   Resend is rate-limited to once per 90 s with a live countdown on the
   button so users who think "maybe it failed" don't fire multiple
   requests and burn their Supabase/Resend quota. */
const RESEND_COOLDOWN_MS = 90_000;

function VerifyPendingPanel({ email, onGoToLogin, t }) {
  const [resending, setResending] = useState(false);
  const [resentAt, setResentAt] = useState(0);
  const [resendError, setResendError] = useState("");
  // Captcha for resend(). Mirrors AuthForm's pattern — Supabase
  // requires a token on resend now that captcha is enforced for
  // signup. The widget is invisible on trusted browsers (managed →
  // non-interactive mode + appearance:"interaction-only").
  const [captchaToken, setCaptchaToken] = useState(null);
  // `now` ticks once per second while a cooldown is active so the
  // countdown rerenders. Using a state value (instead of reading
  // Date.now() inline) keeps the render pure — impure reads during
  // render break React Compiler's memoization.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!resentAt) return;
    if (Date.now() - resentAt >= RESEND_COOLDOWN_MS) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [resentAt]);

  const resend = async () => {
    if (resending) return;
    if (resentAt && Date.now() - resentAt < RESEND_COOLDOWN_MS) return;
    if (TURNSTILE_ENABLED && !captchaToken) {
      setResendError(t("auth.captchaPending"));
      return;
    }
    setResendError("");
    setResending(true);
    const usedCaptchaToken = captchaToken;
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { captchaToken: usedCaptchaToken },
    });
    setResending(false);
    setCaptchaToken(null); // single-use; widget reissues a fresh one
    if (error) { setResendError(t("auth.verifyResendError")); return; }
    const when = Date.now();
    setResentAt(when);
    setNow(when);
  };

  const elapsed = resentAt ? now - resentAt : Infinity;
  const remaining = Math.max(0, Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000));
  const cooling = remaining > 0;
  const justSent = resentAt && elapsed < 4000;

  return (
    <div style={{ paddingTop: 4 }}>
      <div style={{ width: 32, height: 3, background: "var(--teal)", borderRadius: 100, marginBottom: 18 }} />
      <div style={{ fontFamily: "var(--font-d)", fontSize: 24, fontWeight: 900, color: "var(--charcoal)", letterSpacing: "-0.02em", lineHeight: 1.15, marginBottom: 12 }}>
        {t("auth.verifyTitle")}
      </div>
      <div style={{ fontSize: 15, color: "var(--charcoal-md)", lineHeight: 1.6 }}>
        {t("auth.verifyBodyBefore")}
        <strong style={{ color: "var(--charcoal)", fontWeight: 700, wordBreak: "break-all" }}>{email}</strong>
        {t("auth.verifyBodyAfter")}
      </div>
      <div style={{ marginTop: 14, padding: "10px 14px", background: "var(--teal-pale)", borderRadius: "var(--radius)", fontSize: 13, color: "var(--teal-dark)", lineHeight: 1.5 }}>
        {t("auth.verifyTip")}
      </div>
      {resendError && <div style={{ fontSize: 13, color: "var(--red)", marginTop: 12 }}>{resendError}</div>}
      {TURNSTILE_ENABLED && (
        <div style={{ display:"flex", justifyContent:"center", marginTop: 12 }}>
          <TurnstileWidget onToken={setCaptchaToken} />
        </div>
      )}
      <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 8 }}>
        <button className="btn btn-primary" type="button" onClick={onGoToLogin}>
          {t("auth.verifyGoToLogin")}
        </button>
        <button className="btn btn-ghost" type="button" onClick={resend} disabled={resending || cooling}>
          {resending
            ? t("auth.verifyResending")
            : justSent
              ? t("auth.verifyResendSent")
              : cooling
                ? t("auth.verifyResendCooldown", { seconds: remaining })
                : t("auth.verifyResend")}
        </button>
      </div>
    </div>
  );
}

/* ── Auth form (reused inside sheet) ──
   The landing page is English; the auth form stays in Spanish to match
   the rest of the app, which is Spanish-only per CLAUDE.md. */
function AuthForm({ mode, setMode, onSignIn, onSignUp, onProvider, t }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [providerBusy, setProviderBusy] = useState(null);
  const [message, setMessage] = useState("");
  // Captcha token (Cloudflare Turnstile). null until the widget
  // resolves; required for submit when TURNSTILE_ENABLED. Reset to
  // null after each attempt — Turnstile tokens are single-use, so a
  // failed attempt needs a fresh challenge before retry.
  const [captchaToken, setCaptchaToken] = useState(null);
  const captchaRequired = TURNSTILE_ENABLED;
  // When non-null, render the VerifyPendingPanel instead of the form.
  // Set by signUp (fresh signup waiting for verification) or by signIn
  // (tried to log in with an unverified account).
  const [pendingEmail, setPendingEmail] = useState(null);

  const switchMode = (m) => { setMode(m); setError(""); setMessage(""); setPendingEmail(null); };

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
    if (captchaRequired && !captchaToken) {
      // Token hasn't arrived yet — typical when the user fills the
      // form faster than the Turnstile script loads on a slow network.
      // Show the inline notice but don't disable the button (avoids
      // the iOS Safari focus-loss-on-disable-flicker issue).
      setError(t("auth.captchaPending"));
      return;
    }
    setSubmitting(true);
    // Capture the token now but DON'T clear it yet — clearing here
    // toggles the captchaRequired check above to error during the
    // ~1-2s submit roundtrip if the user happens to refocus an input,
    // and on iOS Safari the disabled-state flip mid-keystroke kills
    // the keyboard. We clear AFTER the server responds (success or
    // failure), and the Turnstile widget re-issues a fresh token
    // automatically for the next attempt.
    const usedCaptchaToken = captchaToken;

    let result, requestErr;
    try {
      if (mode === "reset") {
        if (!email.trim()) { setError(t("auth.enterEmail")); setSubmitting(false); return; }
        const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          captchaToken: usedCaptchaToken,
        });
        requestErr = err;
      } else if (mode === "signup") {
        if (!name.trim()) { setError(t("auth.enterName")); setSubmitting(false); return; }
        if (!consentChecked) { setError(t("auth.consentRequired")); setSubmitting(false); return; }
        result = await onSignUp({ email, password, name: name.trim(), captchaToken: usedCaptchaToken });
      } else {
        result = await onSignIn({ email, password, captchaToken: usedCaptchaToken });
      }
    } finally {
      setSubmitting(false);
      // Token is single-use — clear so the next attempt picks up the
      // fresh one the widget has issued in the meantime.
      setCaptchaToken(null);
    }

    if (mode === "reset") {
      if (requestErr) { setError(requestErr.message); return; }
      setMessage(t("settings.linkSent"));
      return;
    }
    if (result?.pendingVerification) { setPendingEmail(result.email || email); return; }
    if (result?.error) { setError(result.error); return; }
  };

  if (pendingEmail) {
    return (
      <VerifyPendingPanel
        email={pendingEmail}
        onGoToLogin={() => { setPendingEmail(null); switchMode("login"); }}
        t={t}
      />
    );
  }

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
          {/* type=email + inputMode=email together suppress iOS text-shortcut
              substitution (e.g. user-defined "@@" → email expansion). Drop
              inputMode and rely on type=email to surface the @-keyboard
              while keeping autocorrect/replace pipeline intact. */}
          <input
            className="input"
            placeholder={t("auth.emailPlaceholder")}
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </div>
        {mode !== "reset" && (
          <div className="input-group">
            <label className="input-label">{t("auth.enterPassword")}</label>
            <PasswordInput placeholder={t("auth.passwordPlaceholder")} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={e => setPassword(e.target.value)} />
          </div>
        )}
        {mode === "signup" && (
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 14, cursor: "pointer", fontSize: 13, color: "var(--charcoal-md)", lineHeight: 1.5 }}>
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              style={{ marginTop: 3, accentColor: "var(--teal)" }}
            />
            <span>
              {t("auth.consentPrefix")}{" "}
              <a
                href="/#privacy"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--teal-dark)", textDecoration: "underline" }}
                onClick={(e) => e.stopPropagation()}
              >
                {t("auth.consentPolicyLink")}
              </a>
              {t("auth.consentSuffix")}
            </span>
          </label>
        )}
        {error && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{error}</div>}
        {mode === "login" && (
          <div style={{ textAlign: "right", marginBottom: 14, marginTop: -6 }}>
            <button type="button" className="btn btn-ghost" style={{ height: 36, fontSize: 13, color: "var(--teal-dark)" }} onClick={() => switchMode("reset")}>{t("auth.resetPassword")}</button>
          </div>
        )}
        {captchaRequired && (
          // The widget is invisible in managed mode for trusted browsers
          // (appearance:"interaction-only"). Wrapper stays mounted so
          // the iframe lives across re-renders. Container has no margin
          // when invisible — only adds space when the widget actually
          // surfaces a challenge.
          <div style={{ display:"flex", justifyContent:"center" }}>
            <TurnstileWidget onToken={setCaptchaToken} />
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
  // banner, jump straight into the signup sheet instead of the marketing
  // page. Adjust-state-during-render on the autoOpen transition.
  const [prevAutoOpen, setPrevAutoOpen] = useState(autoOpen);
  if (autoOpen !== prevAutoOpen) {
    setPrevAutoOpen(autoOpen);
    if (autoOpen === "signup" || autoOpen === "login") openAuth(autoOpen);
  }

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
