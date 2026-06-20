import { useMemo, useCallback } from "react";
import { TODAY } from "../../data/seedData";
import { collapseGroupOccurrences } from "../../utils/groups";
import { formatShortDate } from "../../utils/dates";
import { GroupSessionRow } from "../../components/GroupSessionRow";
import { IconSun } from "../../components/Icons";
import { useSwipe } from "../../hooks/useSwipe";
import { useT } from "../../i18n/index";
import { SessionRow } from "./SessionRow";
import { MonthGridPanel } from "./MonthGridPanel";
import { HeaderLabel } from "./HeaderLabel";
import { sortByTime } from "./agendaShared";

/* ── MONTH VIEW ── */
export function MonthView({ onSelectSession, selectedDate, setSelectedDate, upcomingSessions, jumpToToday, filterPatientName, onMoveDay, canMoveDay, onSwipeComplete, groupsById }) {
  const { t, strings } = useT();
  const MONTH_NAMES = strings.months;
  const DOW = strings.daysShort;
  const displayMonth = selectedDate.getMonth();
  const displayYear  = selectedDate.getFullYear();
  const isCurrent = displayMonth === TODAY.getMonth() && displayYear === TODAY.getFullYear();

  const goMonth = useCallback((delta) => {
    setSelectedDate(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }, [setSelectedDate]);

  const sessionsByDate = useMemo(() => {
    const map = new Map();
    for (const s of upcomingSessions) {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date).push(s);
    }
    return map;
  }, [upcomingSessions]);
  const swipe = useSwipe(
    useCallback(() => goMonth(1), [goMonth]),
    useCallback(() => goMonth(-1), [goMonth])
  );

  const prevMonth = displayMonth === 0 ? 11 : displayMonth - 1;
  const prevYear = displayMonth === 0 ? displayYear - 1 : displayYear;
  const nextMonth = displayMonth === 11 ? 0 : displayMonth + 1;
  const nextYear = displayMonth === 11 ? displayYear + 1 : displayYear;
  const shared = { selectedDate, setSelectedDate, sessionsByDate, onMoveDay, canDrag: canMoveDay };

  const selectedDateStr = formatShortDate(selectedDate);
  const daySessions = collapseGroupOccurrences(
    sortByTime(upcomingSessions.filter(s => s.date === selectedDateStr)),
    groupsById
  );

  return (
    <>
      <div className="month-header">
        <button className="month-nav-btn" onClick={() => goMonth(-1)}>‹</button>
        <HeaderLabel isCurrent={isCurrent} onJumpToday={jumpToToday} t={t}>
          <span className="month-title">{MONTH_NAMES[displayMonth]} {displayYear}</span>
        </HeaderLabel>
        <button className="month-nav-btn" onClick={() => goMonth(1)}>›</button>
      </div>
      <div className="month-grid">
        <div className="month-dow-row">{DOW.map(d => <div key={d} className="month-dow">{d}</div>)}</div>
        <div {...swipe.containerProps}>
          <div style={swipe.stripStyle}>
            <div style={swipe.panelStyle}><MonthGridPanel year={prevYear} month={prevMonth} {...shared} /></div>
            <div style={swipe.panelStyle}><MonthGridPanel year={displayYear} month={displayMonth} {...shared} /></div>
            <div style={swipe.panelStyle}><MonthGridPanel year={nextYear} month={nextMonth} {...shared} /></div>
          </div>
        </div>
      </div>
      <div style={{ padding:"16px 16px 0" }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:10 }}>
          <div className="section-title">{selectedDateStr}</div>
          <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)" }}>{daySessions.length===0?t("sessions.noSessions"):t("sessions.sessionsCount", { count: daySessions.length })}</div>
        </div>
        {daySessions.length === 0
          ? filterPatientName
            ? <div className="card" style={{ padding:"20px 16px", textAlign:"center" }}>
                <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)" }}>{t("agenda.noSessionsForPatient", { name: filterPatientName })}</div>
              </div>
            : <div className="card" style={{ padding:"20px 16px", textAlign:"center" }}>
                <div style={{ marginBottom:6, color:"var(--teal-light)" }}><IconSun size={32} /></div>
                <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)" }}>{t("sessions.freeDay")}</div>
              </div>
          : <div className="card">
              {daySessions.map(s => s._groupOccurrence
                ? <GroupSessionRow key={s.id} occ={s} onClick={() => onSelectSession(s)} />
                : <SessionRow key={s.id} s={s} onClick={onSelectSession} compact onSwipeComplete={onSwipeComplete} />)}
            </div>
        }
      </div>
    </>
  );
}
