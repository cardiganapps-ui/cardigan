import { IconSparkle, IconCheck, IconX } from "./Icons";
import { useT } from "../i18n/index";

/* ── CardiConsentGate ─────────────────────────────────────────────────
   Shown inside CardiSheet on first open (per user, per device, until
   server-confirmed consent for cardi-data-v1). Lists what flows to
   Anthropic and what doesn't, then captures the user's explicit
   "Acepto y empezar" before the chat surfaces.

   Visual: lives inside the sheet body — replaces the normal empty
   state until accepted. Avoids a modal-on-modal stack and keeps the
   user's mental model aligned with the feature they're trying to
   open. */

export function CardiConsentGate({ onAccept, onCancel, submitting, error }) {
  const { t, strings } = useT();
  const seesItems = strings?.cardi?.consent?.seesItems || [];
  const doesNotSeeItems = strings?.cardi?.consent?.doesNotSeeItems || [];

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 18,
      paddingTop: 14,
      paddingBottom: 8,
    }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 48, height: 48, borderRadius: "50%",
          background: "var(--teal-pale)", color: "var(--teal-dark)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>
          <IconSparkle size={22} />
        </div>
        <div style={{
          fontFamily: "var(--font-d)",
          fontSize: 17,
          fontWeight: 800,
          color: "var(--charcoal)",
          textAlign: "center",
          letterSpacing: "-0.2px",
        }}>
          {t("cardi.consent.title")}
        </div>
        <div style={{
          fontSize: 13,
          lineHeight: 1.55,
          color: "var(--charcoal-md)",
          textAlign: "center",
          maxWidth: 340,
        }}>
          {t("cardi.consent.intro")}
        </div>
      </div>

      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}>
        <ConsentSection
          label={t("cardi.consent.sees")}
          items={seesItems.map(i => t(i, {}))}
          tone="positive"
        />
        <ConsentSection
          label={t("cardi.consent.doesNotSee")}
          items={doesNotSeeItems.map(i => t(i, {}))}
          tone="negative"
        />
      </div>

      <div style={{
        background: "var(--cream)",
        borderRadius: "var(--radius)",
        padding: "10px 14px",
        fontSize: 12,
        lineHeight: 1.5,
        color: "var(--charcoal-md)",
      }}>
        {t("cardi.consent.retention")}
      </div>

      {error && (
        <div style={{
          background: "var(--red-bg)",
          color: "var(--red)",
          padding: "8px 12px",
          borderRadius: "var(--radius-sm)",
          fontSize: 12,
          textAlign: "center",
        }}>
          {error === "server" ? "No pude registrar la autorización. Intenta de nuevo." :
           error === "auth"   ? "Sesión expirada. Vuelve a iniciar sesión." :
                                "Error de red. Intenta de nuevo."}
        </div>
      )}

      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        marginTop: 4,
      }}>
        <button
          type="button"
          onClick={onAccept}
          disabled={submitting}
          className="btn btn-primary"
          style={{ width: "100%" }}
        >
          {submitting ? "Guardando…" : t("cardi.consent.accept")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          style={{
            width: "100%",
            background: "none",
            border: "none",
            color: "var(--charcoal-md)",
            fontSize: 13,
            fontWeight: 600,
            padding: "10px 12px",
            cursor: submitting ? "default" : "pointer",
            fontFamily: "inherit",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {t("cardi.consent.cancel")}
        </button>
      </div>
    </div>
  );
}

function ConsentSection({ label, items, tone }) {
  const isPositive = tone === "positive";
  const Icon = isPositive ? IconCheck : IconX;
  const accent = isPositive ? "var(--teal-dark)" : "var(--red)";
  return (
    <div>
      <div style={{
        fontSize: "var(--text-eyebrow)",
        textTransform: "uppercase",
        letterSpacing: "0.6px",
        color: "var(--charcoal-xl)",
        fontWeight: 700,
        padding: "0 4px 6px",
      }}>
        {label}
      </div>
      <ul style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        background: "var(--white)",
        border: "1px solid var(--border-lt)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
      }}>
        {items.map((text, i) => (
          <li key={i} style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "10px 14px",
            borderBottom: i < items.length - 1 ? "1px solid var(--border-lt)" : "none",
            fontSize: 13,
            lineHeight: 1.45,
            color: "var(--charcoal)",
          }}>
            <span style={{
              color: accent,
              flexShrink: 0,
              display: "inline-flex",
              marginTop: 2,
            }}>
              <Icon size={14} />
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
