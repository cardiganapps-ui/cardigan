import { memo } from "react";
import { IconMail, IconPhone } from "../../../components/Icons";
import { isNative } from "../../../lib/platform";
import { launchUrl } from "../../../lib/nativeBrowser";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed profession-theme row
type Row = any;

/* ── TherapistHero ────────────────────────────────────────────────
   Lifted-up version of the contact card that used to sit at the
   bottom of the page. Avatar + name + profession + contact pills.
   Pulls profession color so the avatar circle echoes the hero tint. */
export const TherapistHero = memo(function TherapistHero({ theme, name, professionWord, email, phone, t }: {
  theme: Row;
  name?: string;
  professionWord: string;
  email?: string;
  phone?: string;
  t: (key: string, vars?: Record<string, unknown>) => string;
}) {
  const initials = (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0])
    .join("")
    .toUpperCase() || "—";

  return (
    <div className="card list-entry-stagger" style={{ padding: 16, background: "var(--white)", "--stagger-i": 3 } as React.CSSProperties}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: email || phone ? 14 : 0 }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: theme.accentPale,
            color: theme.accentDark,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontFamily: "var(--font-d)",
            fontWeight: 800,
            fontSize: 18,
            letterSpacing: "-0.2px",
          }}
          aria-hidden="true"
        >
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: "var(--charcoal-xl)",
              marginBottom: 2,
            }}
          >
            {t("patientHome.therapistLabel", { profession: professionWord })}
          </div>
          <div
            style={{
              fontFamily: "var(--font-d)",
              fontWeight: 800,
              fontSize: 18,
              color: "var(--charcoal)",
              letterSpacing: "-0.2px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </div>
        </div>
      </div>
      {(email || phone) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {email && (
            <a
              href={`mailto:${email}`}
              onClick={(e) => {
                if (isNative()) { e.preventDefault(); launchUrl(`mailto:${email}`); }
              }}
              className="btn-tap"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                border: "1px solid var(--border-lt)",
                borderRadius: "var(--radius)",
                color: "var(--charcoal)",
                textDecoration: "none",
                fontSize: 14,
                background: "var(--white)",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <IconMail size={16} style={{ color: theme.accent, flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {email}
              </span>
            </a>
          )}
          {phone && (
            <a
              href={`tel:${phone}`}
              onClick={(e) => {
                if (isNative()) { e.preventDefault(); launchUrl(`tel:${phone}`); }
              }}
              className="btn-tap"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                border: "1px solid var(--border-lt)",
                borderRadius: "var(--radius)",
                color: "var(--charcoal)",
                textDecoration: "none",
                fontSize: 14,
                background: "var(--white)",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <IconPhone size={16} style={{ color: theme.accent, flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {phone}
              </span>
            </a>
          )}
        </div>
      )}
    </div>
  );
});
