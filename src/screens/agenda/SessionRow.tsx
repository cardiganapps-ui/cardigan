import { memo } from "react";
import { getClientColor } from "../../data/seedData";
import { IconCheck } from "../../components/Icons";
import { isTutorSession, isInterviewSession, tutorDisplayInitials, statusClass, railClass } from "../../utils/sessions";
import { SESSION_STATUS } from "../../data/constants";
import { SwipeRevealRow } from "../../components/SwipeRevealRow";
import { Avatar } from "../../components/Avatar";
import { clickableProps } from "../../utils/a11y";
import { useT } from "../../i18n/index";

/* ── SESSION ROW (shared) ──
   Rail color comes from .session-row + rail-* classes (see styles.css).
   Avatar sizing is unified via the shared <Avatar /> component.

   Selection mode: when `selectionMode` is true, taps toggle membership
   in the parent's selected set instead of opening the session detail.
   The row gets a subtle selected highlight + a check pill replaces the
   chevron so the affordance is unambiguous. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed session row
type Row = any;

export const SessionRow = memo(function SessionRow({ s, onClick, compact, selectionMode, selected, onToggleSelect, onSwipeComplete }: {
  s: Row;
  onClick?: (s: Row) => void;
  compact?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (s: Row) => void;
  onSwipeComplete?: (s: Row) => void;
}) {
  const { t } = useT();
  const tutor = isTutorSession(s);
  const interview = isInterviewSession(s);
  const isVirtual = s.modality === "virtual";
  const isTelefonica = s.modality === "telefonica";
  const isADomicilio = s.modality === "a-domicilio";
  // Interview sessions get the rose avatar regardless of modality —
  // matches the Home stream and signals "interview lane" at a glance.
  const avatarBg = interview ? "var(--rose)" : tutor ? "var(--purple)" : isVirtual ? "var(--blue)" : isTelefonica ? "var(--green)" : isADomicilio ? "var(--amber)" : getClientColor(s.colorIdx);
  const modalityColor = isVirtual ? "var(--blue)" : isTelefonica ? "var(--green)" : isADomicilio ? "var(--amber)" : "var(--teal-dark)";
  const modalityKey = isVirtual ? "sessions.virtual" : isTelefonica ? "sessions.telefonica" : isADomicilio ? "sessions.aDomicilio" : "sessions.presencial";
  const handleClick = () => {
    if (selectionMode) onToggleSelect?.(s);
    else onClick?.(s);
  };
  // Swipe-reveal eligibility — same predicate as Home so the gesture
  // is consistent across surfaces: scheduled, non-interview, and the
  // parent has wired a complete handler (i.e. not readOnly). Selection
  // mode disables the gesture because taps in that mode toggle a
  // checkbox; swipe would compete and confuse.
  const swipeEnabled = !!onSwipeComplete && !selectionMode && !interview && s.status === SESSION_STATUS.SCHEDULED;
  const rowBody = (
    <div
      className={`row-item session-row ${railClass(s.status)}`}
      {...(swipeEnabled ? {} : clickableProps(handleClick))}
      style={selectionMode && selected ? { background: "var(--teal-pale)" } : undefined}
    >
      <Avatar initials={tutor ? tutorDisplayInitials(s) : s.initials} color={avatarBg} size="sm" />
      <div className="row-content">
        <div className="row-title">
          {s.patient}
          {tutor && (
            <span
              className="badge badge-purple"
              style={{
                marginLeft: 6,
                fontSize: "var(--text-eyebrow)",
                textTransform: "uppercase",
                letterSpacing: 0.3,
              }}
            >
              {t("sessions.tutor")}
            </span>
          )}
          {interview && (
            <span
              className="badge badge-rose"
              style={{
                marginLeft: 6,
                fontSize: "var(--text-eyebrow)",
                textTransform: "uppercase",
                letterSpacing: 0.3,
              }}
            >
              {t("sessions.interview")}
            </span>
          )}
        </div>
        <div className="row-sub">
          {s.time} - {(() => { const [h,m] = (s.time||"0:0").split(":"); const end = new Date(0,0,0,+h,+m); end.setMinutes(end.getMinutes()+(s.duration||60)); return `${String(end.getHours()).padStart(2,"0")}:${String(end.getMinutes()).padStart(2,"0")}`; })()}
          <span style={{ fontSize:"var(--text-eyebrow)", fontWeight:700, color: modalityColor, marginLeft:6, textTransform:"uppercase" }}>
            {t(modalityKey)}
          </span>
        </div>
      </div>
      <span className={`session-status ${statusClass(s.status)}`}>{t(`sessions.${s.status}`)}</span>
      {selectionMode ? (
        <span style={{
          width: 22, height: 22, borderRadius: "50%", marginLeft: 8,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: selected ? "var(--teal)" : "transparent",
          border: selected ? "none" : "1.5px solid var(--charcoal-xl)",
          color: "var(--white)", flexShrink: 0,
        }}>
          {selected && <IconCheck size={12} />}
        </span>
      ) : !compact ? <span className="row-chevron">›</span> : null}
    </div>
  );
  if (!swipeEnabled) return rowBody;
  return (
    <SwipeRevealRow
      onClick={handleClick}
      actions={[{
        key: "complete",
        icon: <IconCheck size={20} />,
        label: t("sessions.swipeComplete"),
        color: "var(--green)",
        onAction: () => onSwipeComplete?.(s),
      }]}>
      {rowBody}
    </SwipeRevealRow>
  );
});
