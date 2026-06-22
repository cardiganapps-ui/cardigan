import React, { useEffect, useState } from "react";
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

// Spanish gender is built into practitioner nouns (psicóloga vs.
// psicólogo, etc.) and the patient doesn't always know their
// professional's gender — defaulting to feminine across the flow
// reads weird half the time. Using the FIELD/DISCIPLINE noun
// instead ("psicología", "nutrición", "tutoría") sidesteps the
// problem entirely: the role is what's relevant, not the
// practitioner's gender. This map is mirrored in PatientHome,
// IntakeFormSheet, and useAuth — keep them in sync if a profession
// is added.
const PROVIDER_LABELS: Record<string, string> = {
  psychologist:  "psicología",
  nutritionist:  "nutrición",
  trainer:       "entrenamiento personal",
  music_teacher: "clases de música",
  tutor:         "tutoría",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed invite-preview payload
type Row = any;

type PatientClaimScreenProps = {
  token: string;
  onCreateAccount?: () => void;
  onSignIn?: () => void;
};

export function PatientClaimScreen({ token, onCreateAccount, onSignIn }: PatientClaimScreenProps) {
  const { t } = useT();
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const cardStyle: React.CSSProperties = {
    background: "var(--white)",
    borderRadius: "var(--radius-lg, 16px)",
    border: "1px solid var(--border-lt)",
    // Soft drop shadow that survives dark mode — base.css's
    // --shadow-lg already darkens the alpha in the dark palette.
    boxShadow: "var(--shadow-lg)",
    padding: "28px 24px",
    width: "100%",
    maxWidth: 420,
    boxSizing: "border-box",
  };

  // Outer = scroll owner. Body has `overflow: hidden` globally
  // (base.css), so any full-viewport patient surface has to mint
  // its own scroll container or content past the fold gets clipped.
  // Inner = centering frame: minHeight 100% so it grows to at least
  // viewport height (centers vertically when content fits), but
  // expands further when the card is taller than the screen — at
  // which point the OUTER scrolls. .scroll-bounce wires in the iOS
  // rubber-band sentinel so the screen feels native even when the
  // card fits the viewport.
  const wrapperStyle: React.CSSProperties = {
    height: "100dvh",
    background: "var(--white)",
  };
  const innerStyle: React.CSSProperties = {
    minHeight: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "max(24px, calc(var(--sat, 0px) + 16px)) 16px max(24px, env(safe-area-inset-bottom))",
    boxSizing: "border-box",
  };

  if (loading) {
    // Skeleton that mirrors the resolved card shape (logo circle +
    // two title lines + button) so the swap to real content feels
    // continuous instead of yanking content in over a bare
    // "Cargando…" string. Design-system rule: first paint should
    // feel like the destination.
    return (
      <div className="scroll-bounce" style={wrapperStyle}>
        <div style={innerStyle}>
          <div style={cardStyle}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
              <span className="sk-circle" style={{ width: 48, height: 48 }} aria-hidden="true" />
              <span className="sk-bar sk-bar-lg" style={{ width: "70%" }} aria-hidden="true" />
              <span className="sk-bar sk-bar-sm" style={{ width: "55%" }} aria-hidden="true" />
              <span className="sk-bar sk-bar-md" style={{ width: "100%", height: 40, borderRadius: "var(--radius-pill)", marginTop: 6 }} aria-hidden="true" />
            </div>
            <span
              role="status"
              aria-live="polite"
              style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}
            >
              {t("loading")}
            </span>
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
      <div className="scroll-bounce" style={wrapperStyle}>
        <div style={innerStyle}>
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
      </div>
    );
  }

  const therapistName = preview?.therapist_full_name || t("patientClaim.therapistFallback");
  const professionLabel = PROVIDER_LABELS[preview?.therapist_profession] || PROVIDER_LABELS.psychologist;

  return (
    <div className="scroll-bounce" style={wrapperStyle}>
      <div style={innerStyle}>
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
    </div>
  );
}
