/* ── HEADER LABEL with "Hoy" affordance ──
   Shared between DayView / WeekView / MonthView: tappable label that
   jumps back to today and shows a "Hoy" pill when the current view
   isn't already on today. */
export function HeaderLabel({ children, isCurrent, onJumpToday, t }) {
  return (
    <button
      type="button"
      onClick={onJumpToday}
      className="agenda-label-btn"
      aria-label={t("sessions.today")}
    >
      {children}
      {!isCurrent && <span className="agenda-today-pill">{t("sessions.today")}</span>}
    </button>
  );
}
