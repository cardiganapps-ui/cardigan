import { useEffect, useState } from "react";
import { useT } from "../../i18n/index";
import { LogoIcon } from "../../components/LogoMark";
import { attachTherapistContext } from "../../utils/inviteTokenStorage";

/* ── PatientClaimScreen ───────────────────────────────────────────
   The "Únete a Cardigan" welcome view shown when an unauthenticated
   user lands on a /i/<token> URL. Two roles:

     1. Pre-fetch the invite metadata via /api/patient-invite-preview
        so the welcome card greets the user with their therapist's
        actual name + profession (instead of a generic "tu invitación").
     2. Surface signup / signin CTAs that trigger the existing
        AuthScreen flow. The token sits in sessionStorage during the
        auth round-trip; App.jsx auto-fires the claim once the user
        is signed in.

   Error states (token expired, already used, doesn't exist) render
   inline here — same component, different copy. The user is shown
   why their link doesn't work and what to do next ("pídele a tu
   profesionista un nuevo enlace").

   The signed-in case (user already authenticated and lands here)
   is handled by App.jsx, which fires the claim directly — this
   component never renders for an authenticated user. */

const PROVIDER_LABELS = {
  psychologist: "psicóloga",
  nutritionist: "nutrióloga",
  trainer: "entrenadora personal",
  music_teacher: "maestra de música",
  tutor: "tutora",
};

export function PatientClaimScreen({ token, onCreateAccount, onSignIn }) {
  const { t } = useT();
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/patient-invite-preview?token=${encodeURIComponent(token)}`
        );
        if (cancelled) return;
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 404) setError("not_found");
          else setError("server");
          return;
        }
        if (j.expired) { setError("expired"); return; }
        if (j.used)    { setError("used");    return; }
        setPreview(j);
        // Attach therapist context to the stored invite payload so
        // the signup flow can personalize the verification email
        // (template branches on .Data.therapist_name).
        attachTherapistContext({
          therapistName: j.therapist_full_name || null,
          therapistProfession: j.therapist_profession || null,
        });
      } catch {
        if (!cancelled) setError("network");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Centered card layout, matches the AuthScreen's hero width on
  // mobile / tablet / desktop. Logo + welcome copy + CTAs.
  const cardStyle = {
    background: "var(--white)",
    borderRadius: "var(--radius-lg, 16px)",
    border: "1px solid var(--border-lt)",
    boxShadow: "0 8px 32px rgba(0,0,0,0.06)",
    padding: "28px 24px",
    width: "100%",
    maxWidth: 420,
    boxSizing: "border-box",
  };

  const wrapperStyle = {
    minHeight: "100dvh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 16px",
    background: "var(--cream)",
  };

  if (loading) {
    return (
      <div style={wrapperStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: "center", color: "var(--charcoal-md)", fontSize: 14 }}>
            {t("loading")}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    const errorTitle =
      error === "expired" ? t("patientClaim.errorExpiredTitle")
      : error === "used"  ? t("patientClaim.errorUsedTitle")
      : t("patientClaim.errorGenericTitle");
    const errorBody =
      error === "expired" ? t("patientClaim.errorExpiredBody")
      : error === "used"  ? t("patientClaim.errorUsedBody")
      : t("patientClaim.errorGenericBody");

    return (
      <div style={wrapperStyle}>
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
            <LogoIcon size={36} color="var(--teal)" />
          </div>
          <div style={{
            fontFamily: "var(--font-d)",
            fontWeight: 800,
            fontSize: 20,
            color: "var(--charcoal)",
            textAlign: "center",
            marginBottom: 10,
            letterSpacing: "-0.3px",
          }}>
            {errorTitle}
          </div>
          <div style={{
            fontSize: 14,
            color: "var(--charcoal-md)",
            textAlign: "center",
            lineHeight: 1.55,
            marginBottom: 22,
          }}>
            {errorBody}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onSignIn}
            style={{ width: "100%" }}
          >
            {t("patientClaim.haveAccount")}
          </button>
        </div>
      </div>
    );
  }

  const therapistName = preview?.therapist_full_name || t("patientClaim.therapistFallback");
  const professionLabel = PROVIDER_LABELS[preview?.therapist_profession] || PROVIDER_LABELS.psychologist;

  return (
    <div style={wrapperStyle}>
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
          <LogoIcon size={36} color="var(--teal)" />
        </div>
        <div style={{
          fontSize: 13,
          color: "var(--charcoal-md)",
          textAlign: "center",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 700,
          marginBottom: 4,
        }}>
          {t("patientClaim.eyebrow")}
        </div>
        <div style={{
          fontFamily: "var(--font-d)",
          fontWeight: 800,
          fontSize: 22,
          color: "var(--charcoal)",
          textAlign: "center",
          marginBottom: 8,
          letterSpacing: "-0.3px",
          lineHeight: 1.2,
        }}>
          {therapistName}
        </div>
        <div style={{
          fontSize: 14,
          color: "var(--charcoal-md)",
          textAlign: "center",
          marginBottom: 24,
        }}>
          {t("patientClaim.therapistSub", { profession: professionLabel })}
        </div>
        <div style={{
          fontSize: 14,
          color: "var(--charcoal)",
          textAlign: "center",
          lineHeight: 1.55,
          marginBottom: 22,
        }}>
          {t("patientClaim.welcomeBody")}
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onCreateAccount}
          style={{ width: "100%", marginBottom: 10 }}
        >
          {t("patientClaim.createAccount")}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onSignIn}
          style={{ width: "100%" }}
        >
          {t("patientClaim.haveAccount")}
        </button>
        <div style={{
          marginTop: 20,
          fontSize: 11,
          color: "var(--charcoal-xl)",
          textAlign: "center",
          lineHeight: 1.55,
        }}>
          {t("patientClaim.privacy")}
        </div>
      </div>
    </div>
  );
}
