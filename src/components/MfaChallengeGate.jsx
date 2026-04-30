import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { useT } from "../i18n/index";

/* ── MFA challenge gate ──
   Renders between sign-in and the main app when the active session is
   AAL1 but the user has at least one verified TOTP factor (so the
   account requires AAL2). The user enters the 6-digit code from their
   authenticator app; on success the session escalates to AAL2 and the
   parent unmounts the gate.

   This component fetches `getAuthenticatorAssuranceLevel()` itself
   rather than trusting a parent-supplied flag — it needs to react to
   live changes (e.g. the user signs out and back in, or just verified)
   without parent re-coordination.

   `onResolved` fires when the gate determines no challenge is needed
   OR after a successful challenge. `onSignOut` is the escape hatch
   so the user isn't trapped if their authenticator is unavailable. */

export default function MfaChallengeGate({ onResolved, onSignOut }) {
  const { t } = useT();
  const [phase, setPhase] = useState("loading"); // loading | challenge | done
  const [factorId, setFactorId] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: aal, error: aalErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (cancelled) return;
        if (aalErr || !aal) { onResolved?.(); return; }
        // No escalation needed — either no factors enrolled, or already
        // at AAL2. Either way, hand control back to the parent.
        if (!(aal.currentLevel === "aal1" && aal.nextLevel === "aal2")) {
          onResolved?.();
          return;
        }
        const { data: factors, error: facErr } = await supabase.auth.mfa.listFactors();
        if (cancelled) return;
        if (facErr) { setError(t("mfa.loadError")); setPhase("challenge"); return; }
        const totp = (factors?.totp || []).find(f => f.status === "verified");
        if (!totp) {
          // Edge case: nextLevel says AAL2 but no verified TOTP factor.
          // Nothing to challenge against — let the user through.
          onResolved?.();
          return;
        }
        const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: totp.id });
        if (cancelled) return;
        if (chErr) { setError(t("mfa.challengeError")); setPhase("challenge"); return; }
        setFactorId(totp.id);
        setChallengeId(ch.id);
        setPhase("challenge");
      } catch {
        if (!cancelled) { setError(t("mfa.loadError")); setPhase("challenge"); }
      }
    })();
    return () => { cancelled = true; };
  }, [onResolved, t]);

  useEffect(() => {
    if (phase === "challenge") inputRef.current?.focus();
  }, [phase]);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    if (!/^\d{6}$/.test(code)) { setError(t("mfa.codeFormat")); return; }
    setBusy(true); setError("");
    const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId, code });
    if (vErr) {
      setError(t("mfa.codeWrong"));
      setBusy(false);
      return;
    }
    setPhase("done");
    onResolved?.();
  };

  if (phase === "loading") {
    return (
      <div className="shell" style={{ justifyContent:"center", alignItems:"center" }}>
        <div style={{ color:"var(--charcoal-md)", fontSize:14 }}>{t("loading")}</div>
      </div>
    );
  }
  if (phase === "done") return null;

  return (
    <div className="shell" style={{ justifyContent:"center", alignItems:"center", padding:20 }}>
      <div style={{ maxWidth:380, width:"100%", background:"var(--white)", borderRadius:"var(--radius-lg, 16px)", padding:24, boxShadow:"var(--shadow-sm)" }}>
        <div style={{ fontFamily:"var(--font-d)", fontSize:20, fontWeight:800, color:"var(--charcoal)", marginBottom:8 }}>
          {t("mfa.challengeTitle")}
        </div>
        <div style={{ fontSize:14, color:"var(--charcoal-md)", lineHeight:1.55, marginBottom:16 }}>
          {t("mfa.challengeBody")}
        </div>
        <form onSubmit={submit}>
          <input
            ref={inputRef}
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
          {error && (
            <div style={{ fontSize:13, color:"var(--red)", marginBottom:12 }}>{error}</div>
          )}
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
              {busy ? t("loading") : t("mfa.verify")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => onSignOut?.()}>
              {t("nav.signOut")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
