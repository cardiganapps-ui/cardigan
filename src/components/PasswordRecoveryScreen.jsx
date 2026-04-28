import { useState } from "react";
import { PasswordInput } from "./PasswordInput";
import { useT } from "../i18n/index";
import { LogoIcon } from "./LogoMark";
import MfaChallengeGate from "./MfaChallengeGate";

/* ── Password recovery screen ──
   Shown when the user lands on the app via a "restablecer contraseña"
   email link. useAuth sets recoveryMode=true on the
   onAuthStateChange PASSWORD_RECOVERY event; App.jsx renders this
   ahead of AppShell so the user goes straight to setting a new
   password instead of the regular shell.

   MFA gating: Supabase requires an AAL2 session to call updateUser
   with a new password when the account has any verified MFA factor.
   The recovery token alone only sets the session to AAL1, so we
   chain the existing MfaChallengeGate first — it auto-resolves
   instantly for accounts without MFA, or prompts for the 6-digit
   code first. Only after the gate resolves do we let the user enter
   a new password.

   On submit we call setNewPassword (useAuth) which runs
   supabase.auth.updateUser({ password }) and then signs the user out
   so they re-login with the new credential.

   The Turnstile widget is intentionally NOT mounted here. updateUser
   isn't on Supabase's captcha-required endpoint list — the user is
   already authenticated via the recovery token, so the bot-protection
   rationale doesn't apply. */
export function PasswordRecoveryScreen({ onSubmit, onSignOut }) {
  const [aalResolved, setAalResolved] = useState(false);
  if (!aalResolved) {
    return <MfaChallengeGate onResolved={() => setAalResolved(true)} onSignOut={onSignOut} />;
  }
  return <PasswordForm onSubmit={onSubmit} />;
}

function PasswordForm({ onSubmit }) {
  const { t } = useT();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!password || password.length < 8) {
      setError(t("recovery.errorTooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t("recovery.errorMismatch"));
      return;
    }
    setBusy(true);
    const result = await onSubmit(password);
    setBusy(false);
    if (result?.error) setError(result.error);
    // On success the user is signed out by the parent flow and the
    // app re-renders to AuthScreen; nothing for us to do here.
  };

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
          {t("recovery.title")}
        </div>
        <div style={{ fontSize:14, color:"var(--charcoal-md)", lineHeight:1.55, marginBottom:18 }}>
          {t("recovery.body")}
        </div>
        <form onSubmit={submit}>
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
          {error && (
            <div style={{ fontSize:13, color:"var(--red)", marginBottom:12 }}>{error}</div>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width:"100%" }}>
            {busy ? t("loading") : t("recovery.cta")}
          </button>
        </form>
      </div>
    </div>
  );
}
