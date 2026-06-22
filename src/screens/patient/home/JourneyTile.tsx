import { memo } from "react";
import { IconSparkle } from "../../../components/Icons";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed journey-stats / profession-theme rows
type Row = any;

/* ── JourneyTile ──────────────────────────────────────────────────
   "Camino contigo" relationship-stat tile. Displays a soft sparkle
   icon, the start-date copy, the months/weeks-with phrase, and a
   counter of completed sessions. Reads as warmth, not numbers. */
export const JourneyTile = memo(function JourneyTile({ journey, therapistName, theme }: {
  journey: Row;
  therapistName: string;
  theme: Row;
}) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: "var(--radius-lg)",
        border: `1px solid ${theme.accentMist}`,
        background: `linear-gradient(135deg, ${theme.accentPale} 0%, var(--white) 100%)`,
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: theme.accent,
          color: "var(--white)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        <IconSparkle size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-d)",
            fontWeight: 800,
            fontSize: 15,
            color: "var(--charcoal)",
            letterSpacing: "-0.2px",
            lineHeight: 1.25,
            marginBottom: 2,
          }}
        >
          {`${journey.durationLabel.charAt(0).toUpperCase() + journey.durationLabel.slice(1)} acompañándote ${therapistName}`}
        </div>
        <div style={{ fontSize: 12, color: "var(--charcoal-md)", lineHeight: 1.4 }}>
          {`${journey.completedCount} ${journey.completedCount === 1 ? "sesión" : "sesiones"} desde el ${journey.firstSessionDate}`}
        </div>
      </div>
    </div>
  );
});
