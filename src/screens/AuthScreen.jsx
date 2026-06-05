import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabaseClient";
import { LandingPage } from "../components/landing/LandingPage";
import { IconX, IconGoogle, IconApple, IconSparkle, IconLink } from "../components/Icons";
import { PasswordInput } from "../components/PasswordInput";
import { TurnstileWidget, TURNSTILE_ENABLED } from "../components/TurnstileWidget";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";
import { useSheetDrag } from "../hooks/useSheetDrag";
import { isNative } from "../lib/platform";

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

function VerifyPendingPanel({ email, onGoToLogin, onCorrectEmail, t }) {
  const [resending, setResending] = useState(false);
  const [resentAt, setResentAt] = useState(0);
  const [resendError, setResendError] = useState("");
  // Captcha for resend(). Mirrors AuthForm's pattern — Supabase
  // requires a token on resend now that captcha is enforced for
  // signup. The widget is invisible on trusted browsers (managed →
  // non-interactive mode + appearance:"interaction-only").
  const [captchaToken, setCaptchaToken] = useState(null);
  // pendingResend defers a click while the invisible Turnstile
  // widget is still resolving on a cold render. Without it the
  // user gets the cryptic "Espera a que se complete la verificación
  // de seguridad" if they tap Reenviar before the token lands.
  const [pendingResend, setPendingResend] = useState(false);
  const turnstileRef = useRef(null);
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
      // Defer; the useEffect below auto-fires resend the moment the
      // captcha token lands. Button shows Cargando… while we wait.
      setResendError("");
      setPendingResend(true);
      return;
    }
    setResendError("");
    setResending(true);
    const usedCaptchaToken = captchaToken;
    let err;
    try {
      const r = await supabase.auth.resend({
        type: "signup",
        email,
        options: { captchaToken: usedCaptchaToken },
      });
      err = r.error;
    } finally {
      setResending(false);
      setPendingResend(false);
      setCaptchaToken(null);
      turnstileRef.current?.reset();
    }
    if (err) { setResendError(t("auth.verifyResendError")); return; }
    const when = Date.now();
    setResentAt(when);
    setNow(when);
  };

  // Auto-fire resend when captcha resolves if the user already clicked.
  useEffect(() => {
    if (!pendingResend) return;
    if (!captchaToken) return;
    if (resending) return;
    resend();
    // resend captured by closure, intentionally not in deps to avoid
    // re-firing every render. State guards above prevent double-firing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingResend, captchaToken, resending]);

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
      {resendError && <div role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--red)", marginTop: 12 }}>{resendError}</div>}
      {TURNSTILE_ENABLED && (
        <div style={{ display:"flex", justifyContent:"center", marginTop: 12 }}>
          <TurnstileWidget ref={turnstileRef} onToken={setCaptchaToken} />
        </div>
      )}
      <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 8 }}>
        <button className="btn btn-primary" type="button" onClick={onGoToLogin}>
          {t("auth.verifyGoToLogin")}
        </button>
        <button className="btn btn-ghost" type="button" onClick={resend} disabled={resending || pendingResend || cooling}>
          {resending || pendingResend
            ? t("auth.verifyResending")
            : justSent
              ? t("auth.verifyResendSent")
              : cooling
                ? t("auth.verifyResendCooldown", { seconds: remaining })
                : t("auth.verifyResend")}
        </button>
        {/* Escape hatch for the common typo case ("diegagax@me.com"
            instead of "diegoagax@gmail.com"). Returns the user to the
            signup form with the typo'd email pre-filled — they can
            correct it and re-submit without losing the name +
            password they already typed. */}
        {onCorrectEmail && (
          <button
            type="button"
            onClick={onCorrectEmail}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--charcoal-md)",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "var(--font)",
              padding: "8px 0 4px",
              cursor: "pointer",
              textAlign: "center",
            }}
          >
            {t("auth.verifyChangeEmail")}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Auth form (reused inside sheet) ──
   The landing page is English; the auth form stays in Spanish to match
   the rest of the app, which is Spanish-only per CLAUDE.md. */
function AuthForm({ mode, setMode, onSignIn, onSignUp, onProvider, onMagicLink, t }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [providerBusy, setProviderBusy] = useState(null);
  const [message, setMessage] = useState("");
  // Influencer code captured by the /c/:code rewrite in App.jsx and
  // stashed in sessionStorage. Surface a teal banner so the visitor
  // sees that the discount was registered — drives signup confidence.
  // Read once at mount; the value doesn't change during the session.
  const [influencerCode] = useState(() => {
    if (typeof window === "undefined") return null;
    try { return sessionStorage.getItem("cardigan.influencerCodeFromUrl") || null; }
    catch { return null; }
  });
  // Captcha token (Cloudflare Turnstile). null until the widget
  // resolves; required for submit when TURNSTILE_ENABLED. Reset to
  // null after each attempt — Turnstile tokens are single-use, so a
  // failed attempt needs a fresh challenge before retry.
  const [captchaToken, setCaptchaToken] = useState(null);
  const captchaRequired = TURNSTILE_ENABLED;
  // pendingSubmit defers the submit while the invisible Turnstile
  // widget is still resolving — fast users beat the ~1s background
  // check on cold page load. Without this they'd see the cryptic
  // "Espera a que se complete la verificación de seguridad". A
  // useEffect below auto-fires the submit the moment the token
  // arrives.
  const [pendingSubmit, setPendingSubmit] = useState(false);
  // Imperative handle on the Turnstile widget so we can force a
  // fresh challenge after each consumed token; without explicit
  // reset(), the widget holds its current token until natural
  // expiry (~5 min) and the next submit attempt has nothing fresh.
  const turnstileRef = useRef(null);
  // When non-null, render the VerifyPendingPanel instead of the form.
  // Set by signUp (fresh signup waiting for verification) or by signIn
  // (tried to log in with an unverified account).
  const [pendingEmail, setPendingEmail] = useState(null);
  // When non-null, the email the user just tried to sign up with is
  // already registered. Renders an inline recovery prompt so the user
  // can switch to login or password reset without retyping.
  const [duplicateEmail, setDuplicateEmail] = useState(null);
  // When non-null, the user requested a magic link and we're waiting
  // for them to tap it. Replaces the form with a "check your inbox"
  // panel until they navigate away.
  const [magicLinkSentTo, setMagicLinkSentTo] = useState(null);
  const [magicLinkBusy, setMagicLinkBusy] = useState(false);

  const switchMode = (m) => { setMode(m); setError(""); setMessage(""); setPendingEmail(null); setDuplicateEmail(null); setMagicLinkSentTo(null); };

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

  // Magic-link sign-in. Shares the captcha gate + email validation
  // with the regular handleSubmit; we just skip the password step.
  // Defers when captchaToken hasn't landed yet, same as handleSubmit's
  // pendingSubmit branch — without this the cold-load fast-click
  // path would error on the captcha widget.
  const handleMagicLink = async () => {
    if (!onMagicLink) return;
    if (magicLinkBusy) return;
    setError("");
    setMessage("");
    if (!email) { setError(t("auth.emailRequired")); return; }
    if (captchaRequired && !captchaToken) {
      setPendingSubmit(true); // reuse the deferred-submit indicator
      return;
    }
    setMagicLinkBusy(true);
    try {
      const result = await onMagicLink({ email, captchaToken });
      if (captchaRequired) {
        setCaptchaToken(null);
        turnstileRef.current?.reset?.();
      }
      if (result?.error) {
        setError(result.error);
        return;
      }
      if (result?.sent) {
        setMagicLinkSentTo(result.email || email);
      }
    } finally {
      setMagicLinkBusy(false);
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    setError("");
    setMessage("");
    if (captchaRequired && !captchaToken) {
      // Token hasn't arrived yet — defer; the useEffect below fires
      // the actual submit the moment Turnstile resolves. Button
      // shows "Cargando…" while we wait. Eliminates the cryptic
      // captchaPending error on cold-load fast clicks.
      setPendingSubmit(true);
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
      setPendingSubmit(false);
      // Token is single-use — force the widget to issue a fresh one
      // immediately (instead of waiting for natural expiry ~5 min)
      // so the next attempt has a ready token.
      setCaptchaToken(null);
      turnstileRef.current?.reset();
    }

    if (mode === "reset") {
      if (requestErr) { setError(requestErr.message); return; }
      setMessage(t("settings.linkSent"));
      return;
    }
    if (result?.pendingVerification) { setPendingEmail(result.email || email); return; }
    if (result?.emailAlreadyRegistered) { setDuplicateEmail(result.email || email); return; }
    if (result?.error) { setError(result.error); return; }
  };

  // Auto-fire submit when captcha resolves if user already clicked.
  // Eliminates the visible "Espera a que se complete la verificación
  // de seguridad" on cold-load fast clicks. handleSubmit is captured
  // by closure here; the effect re-binds whenever its captured state
  // changes (which is fine — it only fires once per pending click).
  useEffect(() => {
    if (!pendingSubmit) return;
    if (!captchaToken) return;
    if (submitting) return;
    handleSubmit();
    // handleSubmit is intentionally not in deps — including it would
    // re-run the effect every render, since the function is recreated
    // on each render. State guards above prevent double-firing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSubmit, captchaToken, submitting]);

  if (pendingEmail) {
    return (
      <VerifyPendingPanel
        email={pendingEmail}
        onGoToLogin={() => { setPendingEmail(null); switchMode("login"); }}
        // Returning to the signup form clears the verify-pending
        // panel without touching name/password/consent — the user's
        // typo'd email is already in the email state, so they
        // re-render straight onto a focused, pre-filled signup form
        // and just need to fix the typo and submit again. We force
        // mode to "signup" in case the panel was reached via the
        // "tried-to-log-in-with-unverified-account" path (mode would
        // be "login" there); a typo correction always lands them
        // back in signup. Also clear any previous error/feedback.
        onCorrectEmail={() => {
          setPendingEmail(null);
          setError("");
          setMessage("");
          if (mode !== "signup") setMode("signup");
        }}
        t={t}
      />
    );
  }

  if (magicLinkSentTo) {
    return (
      <div style={{ paddingTop: 4 }}>
        <div style={{ width: 32, height: 3, background: "var(--teal)", borderRadius: 100, marginBottom: 18 }} />
        <div style={{ fontFamily: "var(--font-d)", fontSize: 24, fontWeight: 900, color: "var(--charcoal)", letterSpacing: "-0.02em", lineHeight: 1.15, marginBottom: 12 }}>
          {t("auth.magicLinkSentTitle")}
        </div>
        <div style={{ fontSize: 15, color: "var(--charcoal-md)", lineHeight: 1.6 }}>
          {t("auth.magicLinkSentBefore")}
          <strong style={{ color: "var(--charcoal)", fontWeight: 700, wordBreak: "break-all" }}>{magicLinkSentTo}</strong>
          {t("auth.magicLinkSentAfter")}
        </div>
        <div style={{ marginTop: 14, padding: "10px 14px", background: "var(--teal-pale)", borderRadius: "var(--radius)", fontSize: 13, color: "var(--teal-dark)", lineHeight: 1.5 }}>
          {t("auth.magicLinkTip")}
        </div>
        <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 8 }}>
          <button className="btn btn-ghost" type="button" onClick={() => setMagicLinkSentTo(null)}>
            {t("auth.magicLinkBack")}
          </button>
        </div>
      </div>
    );
  }

  if (duplicateEmail) {
    // Recovery panel for the "email already registered" path. Two
    // hand-offs: switch to login (most likely intent — they have an
    // account, just forgot) or switch to password reset (if they
    // forgot the password too). The email stays in state across the
    // mode switch so they don't have to retype.
    return (
      <div style={{ display:"flex", flexDirection:"column", gap:14, alignItems:"center", textAlign:"center", padding:"20px 8px" }}>
        <div style={{
          width: 56, height: 56, borderRadius: "50%",
          background: "var(--amber-bg)", color: "var(--amber)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 26, fontWeight: 800,
        }}>!</div>
        <div style={{ fontFamily:"var(--font-d)", fontSize: 20, fontWeight: 800, color:"var(--charcoal)", letterSpacing:"-0.3px" }}>
          {t("auth.duplicateTitle")}
        </div>
        <div style={{ fontSize: 14, color:"var(--charcoal-md)", lineHeight: 1.5, maxWidth: 320 }}>
          {t("auth.duplicateBody", { email: duplicateEmail })}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 320 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => { setDuplicateEmail(null); switchMode("login"); }}
          >
            {t("auth.duplicateLoginCta")}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => { setDuplicateEmail(null); switchMode("reset"); }}
          >
            {t("auth.duplicateResetCta")}
          </button>
        </div>
      </div>
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
      {influencerCode && mode === "signup" && (
        <div style={{
          display:"flex", alignItems:"center", gap:10,
          background:"var(--teal-pale)",
          color:"var(--teal-dark)",
          padding:"10px 14px",
          borderRadius:"var(--radius)",
          marginBottom:14,
          fontSize:13,
          lineHeight:1.45,
        }}>
          <span style={{ display:"inline-flex", flexShrink:0 }}>
            <IconSparkle size={16} />
          </span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:700, marginBottom:2 }}>
              {t("auth.influencerCodeAppliedTitle", { code: influencerCode })}
            </div>
            <div style={{ fontSize:12, opacity:0.85 }}>
              {t("auth.influencerCodeAppliedSub")}
            </div>
          </div>
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
        {error && <div role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{error}</div>}
        {mode === "login" && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 14, marginTop: -6 }}>
            {onMagicLink ? (
              <button
                type="button"
                className="btn btn-ghost btn-tap"
                style={{ height: 36, fontSize: 13, color: "var(--teal-dark)" }}
                onClick={handleMagicLink}
                disabled={magicLinkBusy}
              >
                {magicLinkBusy ? t("loading") : t("auth.magicLinkCta")}
              </button>
            ) : <span />}
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
            <TurnstileWidget ref={turnstileRef} onToken={setCaptchaToken} />
          </div>
        )}
        <button className="btn btn-primary" type="submit" disabled={submitting || pendingSubmit}>
          {(submitting || pendingSubmit) ? t("loading") : mode === "login" ? t("auth.signIn") : mode === "signup" ? t("auth.createAccount") : t("auth.sendLink")}
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
export function AuthScreen({ onSignIn, onSignUp, onProvider, onMagicLink, onDemo, autoOpen }) {
  const { t } = useT();
  // Honor autoOpen on FIRST mount as well — not just on subsequent
  // changes. The previous adjust-during-render pattern initialized
  // prevAutoOpen=autoOpen, so on first render the comparison was
  // always false → the signup/login sheet never opened. That broke
  // the path from PatientClaimScreen's "Crear cuenta" button (and
  // any other flow that mounts AuthScreen with autoOpen pre-set):
  // user landed on the marketing page instead of the signup form.
  const initialAutoOpened = autoOpen === "signup" || autoOpen === "login";
  const [showAuth, setShowAuth] = useState(initialAutoOpened);
  const [authMode, setAuthMode] = useState(autoOpen === "login" ? "login" : "signup");
  useEscape(showAuth ? () => setShowAuth(false) : null);
  const closeAuth = () => setShowAuth(false);
  const { scrollRef: authScrollRef, setPanelEl: setAuthPanelEl, panelHandlers: authPanelHandlers } = useSheetDrag(closeAuth, { isOpen: showAuth });
  const setAuthPanel = (el) => { authScrollRef.current = el; setAuthPanelEl(el); };

  const openAuth = (mode) => { setAuthMode(mode); setShowAuth(true); };

  // For subsequent autoOpen changes (rare — would require parent to
  // remount us with a new prop), still react via adjust-during-render.
  // Initialized to the same value as autoOpen so the FIRST render's
  // change-detection is no-op (the initial-mount opening above
  // already handled it).
  const [prevAutoOpen, setPrevAutoOpen] = useState(autoOpen);
  if (autoOpen !== prevAutoOpen) {
    setPrevAutoOpen(autoOpen);
    if (autoOpen === "signup" || autoOpen === "login") openAuth(autoOpen);
  }

  // Native iOS / Android: skip the marketing landing entirely and
  // render the AuthForm as a full-screen branded experience. Users
  // installed the app — they don't need the "what is Cardigan" pitch
  // before they can sign in. The native shell has a Cardigan-branded
  // header at top, the same AuthForm in the middle, and a discreet
  // "Probar demo" link in the footer so App Store reviewers still
  // have a one-tap path into the seeded reviewer account.
  if (isNative()) {
    return (
      <NativeAuthShell
        onSignIn={onSignIn}
        onSignUp={onSignUp}
        onProvider={onProvider}
        onMagicLink={onMagicLink}
        onDemo={onDemo}
        t={t}
      />
    );
  }

  return (
    <>
      {/* LandingPage stays mounted across renders so the close
          animation can fade back into the same scroll position, but
          we hide it via display:none while the auth sheet is open.
          Two wins: (a) iOS Safari stops repainting the marketing
          page on every keystroke inside the sheet form, eliminating
          the keyboard-input lag the backdrop-filter was magnifying;
          (b) the IntersectionObservers attached to landing reveals
          stop firing on offscreen elements. The sheet itself slides
          over a clean white body during the open transition, which
          reads cleanly. */}
      <div style={showAuth ? { display: "none" } : undefined}>
        <LandingPage
          onPrimary={() => openAuth("signup")}
          onSecondary={onDemo}
          onLogin={() => openAuth("login")}
        />
      </div>

      {showAuth && (
        <div
          className="sheet-overlay sheet-overlay--no-blur"
          onClick={() => setShowAuth(false)}
        >
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
              <AuthForm mode={authMode} setMode={setAuthMode} onSignIn={onSignIn} onSignUp={onSignUp} onProvider={onProvider} onMagicLink={onMagicLink} t={t} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ── NativeAuthShell ──
   Full-screen iOS/Android auth surface. Same AuthForm that powers the
   web sheet, wrapped in a Cardigan-branded shell so the user lands on
   a real first-launch screen instead of a sheet stacked over a
   marketing page they didn't ask to see.

   Sections, top → bottom:
     - Hero: small accent card with the Cardigan link glyph + name +
       a one-line tagline. No mockups or pitch — they installed the
       app, they know what it is.
     - AuthForm: the same component the web sheet uses — handles
       sign-in / sign-up / reset, OAuth providers (Apple Sign In on
       iOS native uses the Capacitor plugin), magic link.
     - Footer: discreet "Probar demo" link so App Store reviewers
       still have a one-tap path into the seeded reviewer account. */
function NativeAuthShell({ onSignIn, onSignUp, onProvider, onMagicLink, onDemo, t }) {
  const [mode, setMode] = useState("login");
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--white)",
        display: "flex",
        flexDirection: "column",
        paddingTop: "calc(var(--sat, env(safe-area-inset-top, 0px)) + 32px)",
        paddingBottom: "calc(var(--sab, env(safe-area-inset-bottom, 0px)) + 16px)",
      }}
    >
      {/* Branded hero. Compact — no marketing pitch, no screenshot
          mockup. Just identity so the user knows what app they're in. */}
      <div style={{ padding: "0 24px 22px", textAlign: "center" }}>
        <div
          style={{
            width: 64, height: 64, borderRadius: "var(--radius-lg)",
            background: "var(--teal-pale)", color: "var(--teal-dark)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            marginBottom: 14,
            boxShadow: "0 6px 20px rgba(91,155,175,0.18)",
          }}
        >
          <IconLink size={28} />
        </div>
        <div
          style={{
            fontFamily: "var(--font-d)", fontSize: 28, fontWeight: 800,
            color: "var(--charcoal)", letterSpacing: "-0.4px",
            lineHeight: 1.1, marginBottom: 6,
          }}
        >
          cardigan
        </div>
        <div
          style={{
            fontSize: 14, color: "var(--charcoal-md)",
            lineHeight: 1.45, maxWidth: 320, margin: "0 auto",
          }}
        >
          {t("auth.nativeTagline") || "Tu práctica, en orden."}
        </div>
      </div>

      {/* AuthForm — same component as the web sheet. The segmented
          control inside the form switches between sign-in / sign-up. */}
      <div
        style={{
          flex: 1,
          padding: "0 20px 8px",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <AuthForm
          mode={mode}
          setMode={setMode}
          onSignIn={onSignIn}
          onSignUp={onSignUp}
          onProvider={onProvider}
          onMagicLink={onMagicLink}
          t={t}
        />
      </div>

      {/* Footer: demo link for App Store reviewers + future privacy ref. */}
      <div style={{ padding: "8px 24px 0", textAlign: "center" }}>
        {onDemo && (
          <button
            type="button"
            className="btn-tap"
            onClick={onDemo}
            style={{
              background: "transparent", border: "none", padding: "8px 12px",
              color: "var(--charcoal-md)", fontSize: 13, fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t("auth.tryDemo") || "Probar demo"}
          </button>
        )}
      </div>
    </div>
  );
}
