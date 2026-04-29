import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { PasswordInput } from "./PasswordInput";
import { useT } from "../i18n/index";
import { LogoIcon } from "./LogoMark";

/* ── Password recovery screen ──
   Shown when the user lands on the app via a "restablecer contraseña"
   email link. useAuth sets recoveryMode=true on the
   onAuthStateChange PASSWORD_RECOVERY event; App.jsx renders this
   ahead of AppShell so the user goes straight to setting a new
   password instead of the regular shell.

   Three sequential phases:

     "checking" → ask Supabase whether MFA escalation is needed
     "mfa"      → 6-digit TOTP challenge (only when AAL2 required)
     "password" → new password form

   Inlined intentionally — the previous version chained
   MfaChallengeGate as a sibling component, but that introduced a
   race: gate's useEffect deps included onResolved (a new arrow on
   every parent render), so a re-render mid-verify could re-run the
   AAL fetch with a fresh closure and re-issue a new challenge,
   skipping the password form. Single component, single state
   machine — no conditional unmounts, no stale closures.

   Captcha is intentionally NOT mounted here. updateUser isn't on
   Supabase's captcha-required endpoint list — the recovery token
   already proves authenticity. */
export function PasswordRecoveryScreen({ onSubmit, onSignOut }) {
  const { t } = useT();
  const [phase, setPhase] = useState("checking");
  const [factorId, setFactorId] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const codeInputRef = useRef(null);

  // Bootstrap: figure out whether MFA challenge is needed. Run once.
  // No deps — onResolved-style callbacks would reintroduce the race.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: aal, error: aalErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (cancelled) return;
        // Either error fetching, or already at AAL2 (e.g. came in with
        // an MFA-elevated session somehow), or no escalation needed.
        if (aalErr || !aal || aal.currentLevel !== "aal1" || aal.nextLevel !== "aal2") {
          setPhase("password");
          return;
        }
        const { data: factors, error: facErr } = await supabase.auth.mfa.listFactors();
        if (cancelled) return;
        if (facErr) { setError(t("mfa.loadError")); setPhase("password"); return; }
        const totp = (factors?.totp || []).find(f => f.status === "verified");
        if (!totp) { setPhase("password"); return; }
        const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: totp.id });
        if (cancelled) return;
        if (chErr) { setError(t("mfa.challengeError")); setPhase("password"); return; }
        setFactorId(totp.id);
        setChallengeId(ch.id);
        setPhase("mfa");
      } catch {
        if (!cancelled) { setError(t("mfa.loadError")); setPhase("password"); }
      }
    })();
    return () => { cancelled = true; };
  }, [t]);

  // Auto-focus the code input when the MFA phase becomes active.
  useEffect(() => {
    if (phase === "mfa") codeInputRef.current?.focus();
  }, [phase]);

  const submitMfa = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    if (!/^\d{6}$/.test(code)) { setError(t("mfa.codeFormat")); return; }
    setBusy(true); setError("");
    const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId, code });
    setBusy(false);
    if (vErr) { setError(t("mfa.codeWrong")); return; }
    // Move forward unconditionally — at this point the session has
    // escalated to AAL2 server-side. The password form's submit will
    // succeed when it calls updateUser.
    setError("");
    setPhase("password");
  };

  const submitPassword = async (e) => {
    e?.preventDefault?.();
    setError("");
    if (!password || password.length < 8) { setError(t("recovery.errorTooShort")); return; }
    if (password !== confirm) { setError(t("recovery.errorMismatch")); return; }
    setBusy(true);
    const result = await onSubmit(password);
    setBusy(false);
    if (result?.error) setError(result.error);
    // On success the parent flow signs the user out and the app
    // re-renders to AuthScreen — nothing for us to do here.
  };

  if (phase === "checking") {
    return (
      <div className="shell" style={{ justifyContent:"center", alignItems:"center" }}>
        <div style={{ color:"var(--charcoal-md)", fontSize:14 }}>{t("loading")}</div>
      </div>
    );
  }

  if (phase === "mfa") {
    return (
      <Shell title={t("mfa.challengeTitle")} body={t("mfa.challengeBody")}>
        <form onSubmit={submitMfa}>
          <input
            ref={codeInputRef}
            className="input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            style={{ letterSpacing:"0.4em", textAlign:"center", fontSize:18, fontFamily:"var(--font-mono, monospace)", marginBottom:12 }}
          />
          {error && <div style={{ fontSize:13, color:"var(--red)", marginBottom:12 }}>{error}</div>}
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
              {busy ? t("loading") : t("mfa.verify")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onSignOut}>
              {t("nav.signOut")}
            </button>
          </div>
        </form>
      </Shell>
    );
  }

  // phase === "password"
  return (
    <Shell title={t("recovery.title")} body={t("recovery.body")}>
      <form onSubmit={submitPassword}>
        <div className="input-group" style={{ marginBottom:12 }}>
          <label className="input-label">{t("recovery.newPassword")}</label>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("auth.passwordPlaceholder")}
            autoComplete="new-password"
            disabled={busy}
          />
        </div>
        <div className="input-group" style={{ marginBottom:14 }}>
          <label className="input-label">{t("recovery.confirmPassword")}</label>
          <PasswordInput
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={t("auth.passwordPlaceholder")}
            autoComplete="new-password"
            disabled={busy}
          />
        </div>
        {error && <div style={{ fontSize:13, color:"var(--red)", marginBottom:12 }}>{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width:"100%" }}>
          {busy ? t("loading") : t("recovery.cta")}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ title, body, children }) {
  return (
    <div className="shell" style={{ justifyContent:"center", alignItems:"center", padding:20 }}>
      <div style={{ maxWidth:380, width:"100%", background:"var(--bg-card, #fff)", borderRadius:"var(--radius-lg, 16px)", padding:24, boxShadow:"var(--shadow-sm)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
          <LogoIcon size={28} color="var(--teal)" />
          <div style={{ fontFamily:"var(--font-d)", fontSize:18, fontWeight:800, color:"var(--charcoal)" }}>
            cardigan
          </div>
        </div>
        <div style={{ fontFamily:"var(--font-d)", fontSize:20, fontWeight:800, color:"var(--charcoal)", marginBottom:8 }}>
          {title}
        </div>
        <div style={{ fontSize:14, color:"var(--charcoal-md)", lineHeight:1.55, marginBottom:18 }}>
          {body}
        </div>
        {children}
      </div>
    </div>
  );
}
