import { useState, useCallback } from "react";
import { TODAY } from "../../data/seedData";
import { formatShortDate } from "../../utils/dates";
import { useSwipe } from "../../hooks/useSwipe";
import { useT } from "../../i18n/index";
import { Toggle } from "../../components/Toggle";
import { WeekDaysPanel } from "./WeekDaysPanel";
import { HeaderLabel } from "./HeaderLabel";
import { getWeekDays, addDays, isSameDay } from "./agendaShared";

/* ── WEEK VIEW ── */
export function WeekView({ selectedDate, setSelectedDate, setView, onSelectSession, onCellTap, onDropSession, canDrag, onEventContextMenu, upcomingSessions, now, jumpToToday, groupsById }) {
  const { t, strings } = useT();
  const HOURS = strings.hours;
  const [showWeekends, setShowWeekends] = useState(false);
  const swipe = useSwipe(
    useCallback(() => setSelectedDate(d => addDays(d, 7)), [setSelectedDate]),
    useCallback(() => setSelectedDate(d => addDays(d, -7)), [setSelectedDate])
  );
  const prevWeek = addDays(selectedDate, -7);
  const nextWeek = addDays(selectedDate, 7);
  const weekDays = getWeekDays(selectedDate);
  const monday = weekDays[0];
  const weekLabel = `${t("sessions.weekOf")} ${formatShortDate(monday)}`;
  const isCurrent = weekDays.some(d => isSameDay(d, TODAY));
  const shared = { selectedDate, setSelectedDate, setView, onSelectSession, onCellTap, onDropSession, canDrag, onEventContextMenu, upcomingSessions, showWeekends, hours: HOURS, groupsById };

  // "Ahora" line: only when today is in the visible week and within work hours
  const visibleDays = (showWeekends ? weekDays : weekDays.slice(0, 5));
  const todayIdx = visibleDays.findIndex(d => isSameDay(d, now));
  const nowHourFloat = now.getHours() + now.getMinutes() / 60;
  const showNow = todayIdx >= 0 && nowHourFloat >= 7 && nowHourFloat <= 23;
  const dayCount = visibleDays.length;

  return (
    <>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", padding:"0 16px 8px", gap:8 }}>
        <span style={{ fontSize:"var(--text-xs)", fontWeight:600, color:"var(--charcoal-xl)" }}>{t("sessions.weekends")}</span>
        <Toggle on={showWeekends} onToggle={() => setShowWeekends(v => !v)} />
      </div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px 8px" }}>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, -7))}>‹</button>
        <HeaderLabel isCurrent={isCurrent} onJumpToday={jumpToToday} t={t}>
          <span style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-lg)", fontWeight:800, color:"var(--charcoal)" }}>{weekLabel}</span>
        </HeaderLabel>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, 7))}>›</button>
      </div>
      <div style={{ display:"flex", padding:"0 16px", position:"relative" }}>
        <div className="week-time-col">
          <div className="week-header-spacer" />
          {HOURS.map(hour => (
            <div key={hour} className="week-time-label-static">{hour}</div>
          ))}
        </div>
        <div {...swipe.containerProps} style={{ ...swipe.containerProps.style, flex:1 }}>
          <div style={swipe.stripStyle}>
            <div style={swipe.panelStyle}><WeekDaysPanel weekDate={prevWeek} {...shared} /></div>
            <div style={swipe.panelStyle}><WeekDaysPanel weekDate={selectedDate} {...shared} /></div>
            <div style={swipe.panelStyle}><WeekDaysPanel weekDate={nextWeek} {...shared} /></div>
          </div>
        </div>
        {showNow && (
          <div className="week-now-line"
            aria-hidden="true"
            style={{
              left: `calc(44px + (100% - 44px) * ${todayIdx} / ${dayCount})`,
              width: `calc((100% - 44px) / ${dayCount})`,
              top: `calc(52px + var(--week-row-h) * ${nowHourFloat - 7})`,
            }} />
        )}
      </div>
    </>
  );
}
