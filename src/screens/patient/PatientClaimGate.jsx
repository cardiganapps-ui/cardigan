import { useEffect, useRef, useState } from "react";
import { supabase } from "../../supabaseClient";
import { useT } from "../../i18n/index";
import { LogoIcon } from "../../components/LogoMark";
import { clearInviteToken } from "../../utils/inviteTokenStorage";

/* ── PatientClaimGate ─────────────────────────────────────────────
   Bridges a signed-in user with a pending invite token. Fires
   POST /api/patient-claim once on mount, displays a brief
   "Vinculando con tu profesionista..." spinner, and on success
   clears the token + bumps the role-detection version so the
   parent re-evaluates the role and renders PatientShell.

   On failure (token used, expired, etc) the user sees a friendly
   error with a "Continuar" button that drops them out of the gate
   — they end up in the orphan-screen path, which has its own copy.

   The token is cleared from sessionStorage in BOTH success and
   failure paths so a refresh doesn't re-fire the claim. */

export function PatientClaimGate({ token, user: _user, onComplete, onSignOut }) {
  const { t } = useT();
  const [error, setError] = useState(null);
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const access = session?.access_token;
        if (!access) {
          if (!cancelled) setError("auth");
          return;
        }
        const res = await fetch("/api/patient-claim", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${access}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token }),
        });
        if (cancelled) return;
        // Always clear the token — even on error — so a refresh
        // doesn't re-fire and we don't leave a dangling credential
        // in localStorage.
        clearInviteToken();
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          // already_used / race_lost: the token was claimed (probably
          // by THIS user in another tab — sessionStorage is shared
          // across same-origin tabs). The right move isn't to show
          // "ya se usó" — we don't know if this caller is the
          // legit claimer or a separate user. Hand off to the parent;
          // role detection will route correctly: if they're the
          // linked user they land on PatientHome, otherwise on the
          // orphan fallback. Either way, no scary error for the
          // common multi-tab case.
          if (res.status === 409 && (j.code === "already_used" || j.code === "race_lost")) {
            onComplete?.();
            return;
          }
          if (res.status === 410)         setError("expired");
          else if (res.status === 409)    setError(j.code === "patient_linked" ? "patient_linked" : "already_used");
          else if (res.status === 404)    setError(j.code === "patient_gone" ? "patient_gone" : "not_found");
          else                            setError("server");
          return;
        }
        // Successful claim — let the parent re-detect the role.
        // The patient shell will mount once role-detection sees
        // the new linked row.
        onComplete?.();
      } catch {
        if (!cancelled) {
          clearInviteToken();
          setError("network");
        }
      }
    })();
    return () => { cancelled = true; };
    // user.id is captured at first render; we don't want to re-fire on user change
    // because firedRef guards re-entry anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Outer = scroll owner (body has overflow:hidden globally — see
  // PatientClaimScreen for the same pattern). Inner centers the
  // card; if the card is taller than the viewport it falls back to
  // top-aligned and the outer scrolls.
  const wrapperStyle = {
    height: "100dvh",
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
    overscrollBehaviorY: "contain",
    background: "var(--white)",
  };
  const innerStyle = {
    minHeight: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "max(24px, calc(var(--sat, 0px) + 16px)) 16px max(24px, env(safe-area-inset-bottom))",
    boxSizing: "border-box",
  };
  const cardStyle = {
    background: "var(--white)",
    borderRadius: "var(--radius-lg, 16px)",
    border: "1px solid var(--border-lt)",
    boxShadow: "0 8px 32px rgba(0,0,0,0.06)",
    padding: "28px 24px",
    width: "100%",
    maxWidth: 420,
    boxSizing: "border-box",
    textAlign: "center",
  };

  if (!error) {
    return (
      <div style={wrapperStyle}>
        <div style={innerStyle}>
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
              <span className="cardigan-splash-logo" aria-hidden="true">
                <LogoIcon size={36} color="var(--teal)" />
              </span>
            </div>
            <div style={{
              fontFamily: "var(--font-d)",
              fontWeight: 800,
              fontSize: 18,
              color: "var(--charcoal)",
              marginBottom: 8,
              letterSpacing: "-0.2px",
            }}>
              {t("patientClaim.linkingTitle")}
            </div>
            <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.5 }}>
              {t("patientClaim.linkingBody")}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error states
  const errorTitle =
    error === "expired"        ? t("patientClaim.errorExpiredTitle")
    : error === "already_used" ? t("patientClaim.errorUsedTitle")
    : error === "patient_linked" ? t("patientClaim.errorPatientLinkedTitle")
    : error === "patient_gone" ? t("patientClaim.errorPatientGoneTitle")
    : t("patientClaim.errorGenericTitle");
  const errorBody =
    error === "expired"        ? t("patientClaim.errorExpiredBody")
    : error === "already_used" ? t("patientClaim.errorUsedBody")
    : error === "patient_linked" ? t("patientClaim.errorPatientLinkedBody")
    : error === "patient_gone" ? t("patientClaim.errorPatientGoneBody")
    : t("patientClaim.errorGenericBody");

  return (
    <div style={wrapperStyle}>
      <div style={innerStyle}>
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
            <LogoIcon size={36} color="var(--teal)" />
          </div>
          <div style={{
            fontFamily: "var(--font-d)",
            fontWeight: 800,
            fontSize: 18,
            color: "var(--charcoal)",
            marginBottom: 8,
            letterSpacing: "-0.2px",
          }}>
            {errorTitle}
          </div>
          <div style={{
            fontSize: 14,
            color: "var(--charcoal-md)",
            lineHeight: 1.55,
            marginBottom: 22,
          }}>
            {errorBody}
          </div>
          {/* "Continuar" advances to whatever the parent renders next
              — typically the orphan screen since this user has no
              link to anyone. */}
          <button
            type="button"
            className="btn btn-primary"
            onClick={onComplete}
            style={{ width: "100%", marginBottom: 8 }}
          >
            {t("patientClaim.continueAnyway")}
          </button>
          <button
            type="button"
            onClick={onSignOut}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "8px 0",
              color: "var(--charcoal-md)",
              fontFamily: "var(--font)",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {t("nav.signOut")}
          </button>
        </div>
      </div>
    </div>
  );
}
