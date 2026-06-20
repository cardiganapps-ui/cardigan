import { useMemo } from "react";
import { shortDateToISO } from "../../../utils/dates";
import { IconCalendar } from "../../../components/Icons";
import { formatCountdown } from "./constants";

/* ── PatientHero ──────────────────────────────────────────────────
   Profession-tinted gradient banner replacing the old plain "Hola,
   Diego" text greeting. Picks its accent from PROFESSION_THEME so
   the same portal reads as "your psychology space" / "your nutrition
   space" depending on the linked professional. Hides the journey
   line in the first-experience case (no sessions yet) and replaces
   it with a warm welcome message. */
export function PatientHero({ firstName, theme, nextSession, journey, therapistName, professionWord, isFirstExperience, t }) {
  const countdown = useMemo(() => {
    if (!nextSession) return null;
    const iso = shortDateToISO(nextSession.date);
    return formatCountdown(iso, nextSession.time);
  }, [nextSession]);

  return (
    <div
      style={{
        position: "relative",
        padding: "calc(var(--sat, 0px) + 24px) 16px 22px",
        // Diagonal gradient: profession accent at top-left fading
        // into white at bottom-right. The accentMist token keeps the
        // tint subtle (~12% saturation in dark mode, ~8% in light)
        // so it reads as warm presence rather than a colored block.
        background: `linear-gradient(150deg, ${theme.accentPale} 0%, ${theme.accentMist} 35%, var(--white) 75%)`,
        marginBottom: -2,
      }}
    >
      <div style={{ maxWidth: 528, margin: "0 auto" }}>
        {firstName && (
          <div
            style={{
              fontFamily: "var(--font-d)",
              fontSize: 28,
              fontWeight: 800,
              color: "var(--charcoal)",
              letterSpacing: "-0.6px",
              lineHeight: 1.1,
              marginBottom: 6,
            }}
          >
            {t("patientHome.greeting", { name: firstName })}
          </div>
        )}
        {isFirstExperience ? (
          <div style={{ fontSize: 15, color: "var(--charcoal-md)", lineHeight: 1.5, marginTop: 4, maxWidth: 460 }}>
            {t("patientHome.welcomeBody", { profession: professionWord, name: therapistName })}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            {countdown && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 12px",
                  borderRadius: "var(--radius-pill)",
                  background: theme.accent,
                  color: "var(--white)",
                  fontFamily: "var(--font-d)",
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: "-0.1px",
                }}
              >
                <IconCalendar size={12} />
                {`Próxima cita ${countdown}`}
              </span>
            )}
            {journey && journey.completedCount > 0 && (
              <span
                style={{
                  fontSize: 13,
                  color: "var(--charcoal-md)",
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {`${journey.completedCount} ${journey.completedCount === 1 ? "sesión" : "sesiones"} · contigo desde ${journey.durationLabel}`}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
