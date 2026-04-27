import { LogoIcon } from "./LogoMark";
import { useT } from "../i18n/index";

/* iOS-style lock-screen notification mock. Sits inside the Settings
   notifications card when push is enabled so the user sees what an
   actual reminder will look like, and can intuit that the feature is
   live even before one fires. Renders a real upcoming session when
   one exists; falls back to a muted "Ejemplo" badge. */

function pad(n) { return String(n).padStart(2, "0"); }

export function NotificationPreview({ upcoming, reminderMinutes }) {
  const { t } = useT();
  const isExample = !upcoming;
  const now = new Date();
  const nowLabel = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const body = isExample
    ? t("notifications.previewExampleBody")
    : `${upcoming.patient} a las ${upcoming.time}`;
  const hint = isExample
    ? t("notifications.previewExampleHint")
    : `en ${reminderMinutes} min`;

  return (
    <div
      role="group"
      aria-label={t("notifications.previewAriaLabel")}
      style={{
        margin: "10px 14px 14px",
        padding: "12px 14px",
        background: "var(--charcoal-fog, rgba(12, 17, 29, 0.06))",
        borderRadius: 14,
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        border: "1px solid var(--charcoal-mist, rgba(12, 17, 29, 0.08))",
        position: "relative",
      }}
    >
      <div style={{
        flexShrink: 0,
        width: 34, height: 34, borderRadius: 8,
        background: "var(--teal)",
        color: "var(--white)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <LogoIcon size={20} color="var(--white)" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}>
          <div style={{
            fontFamily: "var(--font-d)",
            fontWeight: 800,
            fontSize: "var(--text-sm)",
            color: "var(--charcoal)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {t("notifications.previewTitle")}
          </div>
          <div style={{
            fontSize: 11,
            color: "var(--charcoal-xl)",
            flexShrink: 0,
          }}>
            {nowLabel}
          </div>
        </div>
        <div style={{
          fontSize: "var(--text-sm)",
          color: "var(--charcoal)",
          marginTop: 2,
          lineHeight: 1.35,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {body}
        </div>
        <div style={{
          fontSize: 12,
          color: "var(--charcoal-xl)",
          marginTop: 1,
        }}>
          {hint}
        </div>
      </div>
      {isExample && (
        <span style={{
          position: "absolute",
          top: 8, right: 10,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color: "var(--charcoal-xl)",
          background: "var(--white, #fff)",
          padding: "2px 6px",
          borderRadius: 4,
          border: "1px solid var(--charcoal-mist, rgba(12, 17, 29, 0.08))",
        }}>
          {t("notifications.previewExampleTag")}
        </span>
      )}
    </div>
  );
}
