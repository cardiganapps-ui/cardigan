import { useT } from "../../../i18n/index";
import { shortDateToISO, formatShortDateWithYear } from "../../../utils/dates";
import { IconUsers } from "../../../components/Icons";
import { MODALITY_LABEL, MODALITY_ICON, MODALITY_COLOR, dayName, formatCountdown } from "./constants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed session rows
type Row = any;

export function NextSessionCard({ session, onRequestCancel, onRequestReschedule }: {
  session: Row;
  onRequestCancel?: (s: Row) => void;
  onRequestReschedule?: (s: Row) => void;
}) {
  const { t } = useT();
  const iso = shortDateToISO(session.date);
  const dateLabel = formatShortDateWithYear(new Date(iso + "T12:00:00"));
  const day = dayName(iso);
  const time = session.time || "—";
  const modality = MODALITY_LABEL[session.modality as keyof typeof MODALITY_LABEL] || MODALITY_LABEL.presencial;
  const duration = session.duration ? `${session.duration} min` : null;
  const ModalityIcon = MODALITY_ICON[session.modality as keyof typeof MODALITY_ICON] || IconUsers;
  const modalityColor = MODALITY_COLOR[session.modality as keyof typeof MODALITY_COLOR] || "var(--teal-dark)";
  const countdown = formatCountdown(iso, session.time);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        {/* Modality icon + color square. Visual cue for "this is a
            phone session vs. a video session vs. in-person" before
            the eye even reaches the text. */}
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "var(--radius)",
            background: `${modalityColor}20`,
            color: modalityColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          <ModalityIcon size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-d)",
              fontWeight: 800,
              fontSize: 20,
              color: "var(--charcoal)",
              letterSpacing: "-0.3px",
              lineHeight: 1.15,
              marginBottom: 2,
            }}
          >
            {day} {dateLabel}
          </div>
          <div style={{ fontSize: 14, color: "var(--charcoal-md)", marginBottom: 10, fontVariantNumeric: "tabular-nums" }}>
            {time}
            {duration ? ` · ${duration}` : ""}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 10px",
                borderRadius: "var(--radius-pill)",
                background: `${modalityColor}1A`,
                color: modalityColor,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.04em",
              }}
            >
              <ModalityIcon size={11} />
              {modality}
            </span>
            {countdown && (
              <span
                style={{
                  fontSize: 12,
                  color: "var(--charcoal-md)",
                  fontWeight: 600,
                }}
              >
                · {countdown}
              </span>
            )}
            {session.session_type === "interview" && (
              <span
                style={{
                  padding: "3px 10px",
                  borderRadius: "var(--radius-pill)",
                  background: "var(--rose-bg, #F9EEF3)",
                  color: "var(--rose, #C77E9C)",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                }}
              >
                {t("patientHome.interview")}
              </span>
            )}
          </div>
        </div>
      </div>
      {/* Action row — Reprogramar + Cancelar as proper pill buttons.
          Earlier iteration shipped these as quiet text links so they
          wouldn't compete with the date/time hierarchy, but the
          contrast was too low — patients couldn't find them. Pills
          with border + tint surface the affordance without screaming.
          Color signals function: teal=neutral action, red=destructive.
          These now own the reschedule entry point fully (the duplicate
          outline pill above the card was removed). */}
      {(onRequestReschedule || onRequestCancel) && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px solid var(--border-lt)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {onRequestReschedule && (
            <button
              type="button"
              onClick={() => onRequestReschedule(session)}
              className="btn-tap"
              style={{
                flex: 1,
                height: 38,
                background: "transparent",
                border: "1px solid var(--teal)",
                borderRadius: "var(--radius-pill)",
                cursor: "pointer",
                fontFamily: "var(--font)",
                fontSize: 13,
                fontWeight: 700,
                color: "var(--teal-dark)",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {t("patientHome.rescheduleCta")}
            </button>
          )}
          {onRequestCancel && (
            <button
              type="button"
              onClick={() => onRequestCancel(session)}
              className="btn-tap"
              style={{
                flex: 1,
                height: 38,
                background: "transparent",
                border: "1px solid var(--red)",
                borderRadius: "var(--radius-pill)",
                cursor: "pointer",
                fontFamily: "var(--font)",
                fontSize: 13,
                fontWeight: 700,
                color: "var(--red)",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {t("patientHome.cancelCta")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
