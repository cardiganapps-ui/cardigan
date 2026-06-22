import { useMemo, useCallback } from "react";
import { TODAY } from "../../data/seedData";
import { formatShortDate } from "../../utils/dates";
import { useSwipe } from "../../hooks/useSwipe";
import { useT } from "../../i18n/index";
import { DayPanel } from "./DayPanel";
import { HeaderLabel } from "./HeaderLabel";
import { getWeekDays, addDays, isSameDay } from "./agendaShared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed session/group rows
type Row = any;

/* ── DAY VIEW ── */
export function DayView({ selectedDate, setSelectedDate, onSelectSession, upcomingSessions, jumpToToday, filterPatientName, selectionMode, selectedSet, onToggleSelect, onSwipeComplete, groupsById }: {
  selectedDate: Date;
  setSelectedDate: (d: Date | ((prev: Date) => Date)) => void;
  onSelectSession: (s: Row) => void;
  upcomingSessions: Row[];
  jumpToToday?: () => void;
  filterPatientName?: string | null;
  selectionMode?: boolean;
  selectedSet?: Set<string>;
  onToggleSelect?: (s: Row) => void;
  onSwipeComplete?: (s: Row) => void;
  groupsById?: Map<string, Row>;
}) {
  const { t, strings } = useT();
  const DOW = strings.daysShort;
  const sessionDateSet = useMemo(() => new Set(upcomingSessions.map((s: Row) => s.date)), [upcomingSessions]);
  const swipe = useSwipe(
    useCallback(() => setSelectedDate(d => addDays(d, 1)), [setSelectedDate]),
    useCallback(() => setSelectedDate(d => addDays(d, -1)), [setSelectedDate])
  );
  // Separate swipe for the week strip: ±7 days so horizontal drags on
  // the day-of-week row jump a whole week instead of a single day.
  const weekSwipe = useSwipe(
    useCallback(() => setSelectedDate(d => addDays(d, 7)), [setSelectedDate]),
    useCallback(() => setSelectedDate(d => addDays(d, -7)), [setSelectedDate])
  );
  const prevDay = addDays(selectedDate, -1);
  const nextDay = addDays(selectedDate, 1);
  const shared = { onSelectSession, upcomingSessions, filterPatientName, selectionMode, selectedSet, onToggleSelect, onSwipeComplete, groupsById };

  const weekDays = getWeekDays(selectedDate);
  const prevWeekDays = getWeekDays(addDays(selectedDate, -7));
  const nextWeekDays = getWeekDays(addDays(selectedDate, 7));
  const monday = weekDays[0];
  const sunday = weekDays[6];
  const weekLabel = monday.getMonth() === sunday.getMonth()
    ? `${monday.getDate()}–${sunday.getDate()} ${strings.monthsShort[monday.getMonth()]}`
    : `${formatShortDate(monday)} – ${formatShortDate(sunday)}`;
  const isCurrent = isSameDay(selectedDate, TODAY);

  const renderCalStrip = (days: Date[]) => (
    <div className="cal-strip">
      {days.map((d: Date, i: number) => {
        const ds = formatShortDate(d);
        const isActive = isSameDay(d, selectedDate);
        const isToday = isSameDay(d, TODAY);
        const hasSess = sessionDateSet.has(ds);
        return (
          <div key={i} className={`cal-day ${isActive?"active":""} ${hasSess?"has-sessions":""} ${isToday&&!isActive?"today":""}`} role="button" tabIndex={0} onClick={() => setSelectedDate(d)}>
            <span className="cal-day-name">{DOW[i]}</span>
            <span className="cal-day-num">{d.getDate()}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px 10px" }}>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, -1))}>‹</button>
        <HeaderLabel isCurrent={isCurrent} onJumpToday={jumpToToday} t={t}>
          <span style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)", fontWeight:600 }}>{weekLabel}</span>
        </HeaderLabel>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, 1))}>›</button>
      </div>
      <div {...weekSwipe.containerProps} style={{ ...weekSwipe.containerProps.style, paddingBottom: 8 }}>
        <div style={weekSwipe.stripStyle}>
          <div style={weekSwipe.panelStyle}>{renderCalStrip(prevWeekDays)}</div>
          <div style={weekSwipe.panelStyle}>{renderCalStrip(weekDays)}</div>
          <div style={weekSwipe.panelStyle}>{renderCalStrip(nextWeekDays)}</div>
        </div>
      </div>
      <div {...swipe.containerProps}>
        <div style={swipe.stripStyle}>
          <div style={swipe.panelStyle}><DayPanel panelDate={prevDay} {...shared} /></div>
          <div style={swipe.panelStyle}><DayPanel panelDate={selectedDate} {...shared} /></div>
          <div style={swipe.panelStyle}><DayPanel panelDate={nextDay} {...shared} /></div>
        </div>
      </div>
    </>
  );
}
