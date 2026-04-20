import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { getClientColor, TODAY } from "../data/seedData";
import { haptic } from "../utils/haptics";
import { SessionSheet } from "../components/SessionSheet";
import { NoteEditor } from "../components/NoteEditor";
import { NewSessionSheet } from "../components/sheets/NewSessionSheet";
import { IconSun, IconCheck, IconX, IconTrash, IconCalendar } from "../components/Icons";
import ContextMenu, { useContextMenu } from "../components/ContextMenu";
import { formatShortDate, toISODate } from "../utils/dates";
import { isCancelledStatus, statusClass, isTutorSession, tutorDisplayInitials, shortName, railClass } from "../utils/sessions";
import { Avatar } from "../components/Avatar";
import { useSwipe } from "../hooks/useSwipe";
import { useViewport } from "../hooks/useViewport";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";
import { Toggle } from "../components/Toggle";
import { SegmentedControl } from "../components/SegmentedControl";

/* ── LongPressEvent ──
   Mobile users can't drag HTML5 draggables; this wraps the week-event so a
   500 ms long-press opens SessionSheet straight into reschedule mode
   (parity with the desktop drag-and-drop gesture, just touch-native).
   Desktop still uses the native draggable path on the same element. */
function LongPressEvent({ session, eventStyle, startF, dur, isDraggable, touchLongPressable, onSelectSession, onEventContextMenu }) {
  const timer = useRef(null);
  const firedRef = useRef(false);
  const startPos = useRef(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const onTouchStart = (e) => {
    if (!touchLongPressable) return;
    firedRef.current = false;
    const t0 = e.touches[0];
    startPos.current = { x: t0.clientX, y: t0.clientY };
    timer.current = setTimeout(() => {
      firedRef.current = true;
      haptic.warn();
      onSelectSession(session, "reschedule");
    }, 500);
  };
  const onTouchMove = (e) => {
    if (!timer.current || !startPos.current) return;
    const dx = e.touches[0].clientX - startPos.current.x;
    const dy = e.touches[0].clientY - startPos.current.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimer();
  };
  const onTouchEnd = () => { clearTimer(); };
  const onTouchCancel = () => { clearTimer(); firedRef.current = false; };

  return (
    <div
      className={`week-event ${isCancelledStatus(session.status)?"cancelled":""} ${isDraggable ? "week-event--draggable" : ""} ${touchLongPressable ? "week-event--longpress" : ""}`}
      draggable={isDraggable}
      onDragStart={isDraggable ? (e) => {
        e.dataTransfer.setData("text/plain", session.id);
        e.dataTransfer.effectAllowed = "move";
      } : undefined}
      style={{
        ...eventStyle,
        top: `calc(var(--week-row-h) * ${startF} + 2px)`,
        height: `calc(var(--week-row-h) * ${dur} - 4px)`,
      }}
      onClick={(e) => {
        // Suppress the click fired after a long-press (iOS synthesizes
        // it). If the long-press already opened the sheet we don't want
        // a second tap to reset it to normal mode.
        if (firedRef.current) { firedRef.current = false; return; }
        e.stopPropagation();
        onSelectSession(session);
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      onContextMenu={onEventContextMenu ? (e) => { e.stopPropagation(); onEventContextMenu(e, session); } : undefined}>
      <span className="week-event-time">{session.time}</span> {shortName(session.patient)}
    </div>
  );
}

/* ── DATE HELPERS ── */
function getMonday(d) {
  const m = new Date(d);
  const day = m.getDay();
  m.setDate(m.getDate() - ((day + 6) % 7));
  m.setHours(0,0,0,0);
  return m;
}

function getWeekDays(d) {
  const mon = getMonday(d);
  return Array.from({length:7}, (_,i) => {
    const day = new Date(mon);
    day.setDate(mon.getDate() + i);
    return day;
  });
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function isSameDay(a, b) {
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}

function sortByTime(sessions) {
  return [...sessions].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
}

function buildMonthGrid(year, month) {
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev  = new Date(year, month, 0).getDate();
  const startOffset = (firstDay + 6) % 7;
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push({ num: daysInPrev - startOffset + 1 + i, current: false });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ num: d, current: true });
  const remaining = 42 - cells.length;
  for (let i = 1; i <= remaining; i++) cells.push({ num: i, current: false });
  return cells;
}

/* ── SESSION ROW (shared) ──
   Rail color comes from .session-row + rail-* classes (see styles.css).
   Avatar sizing is unified via the shared <Avatar /> component. */
function SessionRow({ s, onClick, compact }) {
  const { t } = useT();
  const tutor = isTutorSession(s);
  const isVirtual = s.modality === "virtual";
  const avatarBg = tutor ? "var(--purple)" : isVirtual ? "var(--blue)" : getClientColor(s.colorIdx);
  return (
    <div className={`row-item session-row ${railClass(s.status)}`} key={s.id} onClick={() => onClick(s)}>
      <div style={{ width: compact ? 40 : 44, textAlign:"center", flex:"none" }}>
        <div style={{ fontFamily:"var(--font-d)", fontSize: compact ? "var(--text-sm)" : "var(--text-md)", fontWeight:800, color:"var(--teal-dark)" }}>{s.time}</div>
      </div>
      <Avatar initials={tutor ? tutorDisplayInitials(s) : s.initials} color={avatarBg} size="sm" />
      <div className="row-content">
        <div className="row-title">
          {s.patient}
          {tutor && <span style={{ fontSize:"var(--text-eyebrow)", fontWeight:700, color:"var(--purple)", marginLeft:6, textTransform:"uppercase" }}>{t("sessions.tutor")}</span>}
        </div>
        <div className="row-sub">
          {s.time} - {(() => { const [h,m] = (s.time||"0:0").split(":"); const end = new Date(0,0,0,+h,+m); end.setMinutes(end.getMinutes()+(s.duration||60)); return `${String(end.getHours()).padStart(2,"0")}:${String(end.getMinutes()).padStart(2,"0")}`; })()}
          <span style={{ fontSize:"var(--text-eyebrow)", fontWeight:700, color: isVirtual ? "var(--blue)" : "var(--teal-dark)", marginLeft:6, textTransform:"uppercase" }}>
            {isVirtual ? t("sessions.virtual") : t("sessions.presencial")}
          </span>
        </div>
      </div>
      <span className={`session-status ${statusClass(s.status)}`}>{t(`sessions.${s.status}`)}</span>
      {!compact && <span className="row-chevron">›</span>}
    </div>
  );
}

/* ── DAY PANEL (just one day's session list, no week strip) ── */
function DayPanel({ panelDate, onSelectSession, upcomingSessions, filterPatientName }) {
  const { t, strings } = useT();
  const DOW = strings.daysShort;
  const dateStr = formatShortDate(panelDate);
  const daySessions = sortByTime(upcomingSessions.filter(s => s.date === dateStr));
  const dayName = DOW[(panelDate.getDay() + 6) % 7];

  return (
    <>
      <div style={{ padding:"0 16px 4px" }}>
        <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:800, color:"var(--charcoal)", marginBottom:2 }}>{dayName} {dateStr}</div>
        <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)", marginBottom:10 }}>{daySessions.length===0 ? t("sessions.noSessions") : t("sessions.sessionsCount", { count: daySessions.length })}</div>
      </div>
      <div style={{ padding:"0 16px 12px" }}>
        {daySessions.length === 0
          ? filterPatientName
            ? <div className="card" style={{ padding:32, textAlign:"center" }}>
                <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)" }}>{t("agenda.noSessionsForPatient", { name: filterPatientName })}</div>
              </div>
            : <div className="card" style={{ padding:32, textAlign:"center" }}>
                <div style={{ marginBottom:10, color:"var(--teal-light)" }}><IconSun size={32} /></div>
                <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:700, color:"var(--charcoal)", marginBottom:4 }}>{t("sessions.freeDay")}</div>
                <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)" }}>{t("sessions.freeDayMessage")}</div>
              </div>
          : <div className="card">
              {daySessions.map(s => <SessionRow key={s.id} s={s} onClick={onSelectSession} />)}
            </div>
        }
      </div>
    </>
  );
}

/* ── HEADER LABEL with "Hoy" affordance ── */
function HeaderLabel({ children, isCurrent, onJumpToday, t }) {
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

/* ── DAY VIEW ── */
function DayView({ selectedDate, setSelectedDate, onSelectSession, upcomingSessions, jumpToToday, filterPatientName }) {
  const { t, strings } = useT();
  const DOW = strings.daysShort;
  const sessionDateSet = useMemo(() => new Set(upcomingSessions.map(s => s.date)), [upcomingSessions]);
  const swipe = useSwipe(
    useCallback(() => setSelectedDate(d => addDays(d, 1)), [setSelectedDate]),
    useCallback(() => setSelectedDate(d => addDays(d, -1)), [setSelectedDate])
  );
  const prevDay = addDays(selectedDate, -1);
  const nextDay = addDays(selectedDate, 1);
  const shared = { onSelectSession, upcomingSessions, filterPatientName };

  const weekDays = getWeekDays(selectedDate);
  const monday = weekDays[0];
  const sunday = weekDays[6];
  const weekLabel = monday.getMonth() === sunday.getMonth()
    ? `${monday.getDate()}–${sunday.getDate()} ${strings.monthsShort[monday.getMonth()]}`
    : `${formatShortDate(monday)} – ${formatShortDate(sunday)}`;
  const isCurrent = isSameDay(selectedDate, TODAY);

  return (
    <>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px 10px" }}>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, -1))}>‹</button>
        <HeaderLabel isCurrent={isCurrent} onJumpToday={jumpToToday} t={t}>
          <span style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)", fontWeight:600 }}>{weekLabel}</span>
        </HeaderLabel>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, 1))}>›</button>
      </div>
      {/* Static week strip — does NOT swipe with the day list */}
      <div style={{ paddingBottom:8 }}>
        <div className="cal-strip">
          {weekDays.map((d,i) => {
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

/* ── Helper: parse "HH:MM" to fractional hours from grid start (8:00) ── */
function timeToFloat(time) {
  const [h, m] = (time || "08:00").split(":").map(Number);
  return (h || 8) + (m || 0) / 60 - 8;
}

/* ── WEEK DAYS PANEL (just the day headers + grid cells, no time labels) ── */
function WeekDaysPanel({ weekDate, selectedDate, setSelectedDate, setView, onSelectSession, onCellTap, onDropSession, canDrag, onEventContextMenu, upcomingSessions, showWeekends, hours }) {
  const { strings } = useT();
  const DOW = strings.daysShort;
  const weekDays = getWeekDays(weekDate);
  const visibleDays = showWeekends ? weekDays : weekDays.slice(0, 5);
  const visibleDow = showWeekends ? DOW : DOW.slice(0, 5);
  const cols = `repeat(${visibleDays.length}, 1fr)`;
  const [dropTarget, setDropTarget] = useState(null); // `${dayIdx}:${hourIdx}`

  // Group sessions by date for quick lookup
  const sessionsByDate = useMemo(() => {
    const map = new Map();
    for (const s of upcomingSessions) {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date).push(s);
    }
    return map;
  }, [upcomingSessions]);

  return (
    <div>
      <div className="week-header-row" style={{ gridTemplateColumns: cols, padding: 0 }}>
        {visibleDays.map((d,i) => {
          const isActive = isSameDay(d, selectedDate);
          const isToday = isSameDay(d, TODAY);
          return (
            <div key={i} className="week-day-head" style={{ cursor:"pointer" }} onClick={() => { setSelectedDate(d); setView("day"); }}>
              <span className="week-day-name">{visibleDow[i]}</span>
              <span className={`week-day-num ${isActive?"active":""} ${isToday&&!isActive?"today":""}`}>{d.getDate()}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display:"grid", gridTemplateColumns: cols }}>
        {visibleDays.map((d, dIdx) => {
          const ds = formatShortDate(d);
          const daySess = sessionsByDate.get(ds) || [];
          return (
            <div key={dIdx} className="week-day-col" style={{ position:"relative", borderLeft: dIdx > 0 ? "1px solid var(--border-lt)" : undefined }}>
              {/* Background hour grid lines */}
              {hours.map((hour, hIdx) => {
                const isDropTarget = dropTarget === `${dIdx}:${hIdx}`;
                return (
                  <div key={hIdx} className={`week-cell ${isDropTarget ? "week-cell--drop-target" : ""}`}
                    role="button" tabIndex={0}
                    onClick={() => onCellTap && onCellTap(d, hour)}
                    onDragOver={canDrag ? (e) => { e.preventDefault(); setDropTarget(`${dIdx}:${hIdx}`); } : undefined}
                    onDragLeave={canDrag ? () => setDropTarget(prev => prev === `${dIdx}:${hIdx}` ? null : prev) : undefined}
                    onDrop={canDrag ? (e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData("text/plain");
                      setDropTarget(null);
                      if (id && onDropSession) onDropSession(id, d, hour);
                    } : undefined}
                  />
                );
              })}
              {/* Session events positioned absolutely */}
              {daySess.map(sess => {
                const startF = timeToFloat(sess.time);
                const dur = (sess.duration || 60) / 60; // hours
                if (startF < 0 || startF >= hours.length) return null;
                const eventStyle = (() => {
                  if (isCancelledStatus(sess.status)) return undefined;
                  if (isTutorSession(sess)) return { background:"var(--purple-bg)", borderLeftColor:"var(--purple)", color:"var(--charcoal)" };
                  if (sess.modality === "virtual") return { background:"var(--blue-bg)", borderLeftColor:"var(--blue)", color:"var(--charcoal)" };
                  const c = getClientColor(sess.colorIdx);
                  return { background: `${c}26`, borderLeftColor: c, color: "var(--charcoal)" };
                })();
                const isDraggable = canDrag && !isCancelledStatus(sess.status);
                const touchLongPressable = !canDrag && !isCancelledStatus(sess.status);
                return (
                  <LongPressEvent key={sess.id}
                    session={sess}
                    eventStyle={eventStyle}
                    startF={startF}
                    dur={dur}
                    isDraggable={isDraggable}
                    touchLongPressable={touchLongPressable}
                    onSelectSession={onSelectSession}
                    onEventContextMenu={onEventContextMenu} />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── WEEK VIEW ── */
function WeekView({ selectedDate, setSelectedDate, setView, onSelectSession, onCellTap, onDropSession, canDrag, onEventContextMenu, upcomingSessions, now, jumpToToday }) {
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
  const shared = { selectedDate, setSelectedDate, setView, onSelectSession, onCellTap, onDropSession, canDrag, onEventContextMenu, upcomingSessions, showWeekends, hours: HOURS };

  // "Ahora" line: only when today is in the visible week and within work hours
  const visibleDays = (showWeekends ? weekDays : weekDays.slice(0, 5));
  const todayIdx = visibleDays.findIndex(d => isSameDay(d, now));
  const nowHourFloat = now.getHours() + now.getMinutes() / 60;
  const showNow = todayIdx >= 0 && nowHourFloat >= 8 && nowHourFloat <= 21;
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
              top: `calc(52px + var(--week-row-h) * ${nowHourFloat - 8})`,
            }} />
        )}
      </div>
    </>
  );
}

/* ── MONTH GRID PANEL (just the calendar cells, no header/dow/sessions) ── */
function MonthGridPanel({ year, month, selectedDate, setSelectedDate, sessionsByDate }) {
  const cells = buildMonthGrid(year, month);
  const selectedDateStr = formatShortDate(selectedDate);
  const isCurrentMonth = selectedDate.getMonth() === month && selectedDate.getFullYear() === year;

  return (
    <div className="month-days-grid">
      {cells.map((cell, i) => {
        const cellDate = new Date(year, month + (cell.current ? 0 : (i < 7 ? -1 : 1)), cell.num);
        const cellStr = formatShortDate(cellDate);
        const isToday  = isSameDay(cellDate, TODAY);
        const isActive = isCurrentMonth && cellStr === selectedDateStr;
        const sessions = sessionsByDate.get(cellStr) || [];
        const hasPresencial = sessions.some(s => !isTutorSession(s) && s.modality !== "virtual");
        const hasVirtual = sessions.some(s => !isTutorSession(s) && s.modality === "virtual");
        const hasTutor = sessions.some(s => isTutorSession(s));
        return (
          <div key={i} className={`month-cell ${isActive?"active":""} ${isToday&&!isActive?"today":""} ${!cell.current?"other-month":""}`}
            role="button" tabIndex={0} onClick={() => setSelectedDate(cellDate)}>
            <span className="month-cell-num">{cell.num}</span>
            {(hasPresencial || hasVirtual || hasTutor) && (
              <div className="month-dots">
                {/* Saturated dot-only variants: brand teal/blue/purple all land
                    in the same cool-blue band at this size and become
                    indistinguishable. Deeper teal + true blue + magenta-leaning
                    purple pull each hue into its own corner of the wheel. */}
                {hasPresencial && <span className="month-dot-color" style={{ background: "#1F7A8C" }} />}
                {hasVirtual && <span className="month-dot-color" style={{ background: "#2550C7" }} />}
                {hasTutor && <span className="month-dot-color" style={{ background: "#A347C9" }} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── MONTH VIEW ── */
function MonthView({ onSelectSession, selectedDate, setSelectedDate, upcomingSessions, jumpToToday, filterPatientName }) {
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
  const shared = { selectedDate, setSelectedDate, sessionsByDate };

  const selectedDateStr = formatShortDate(selectedDate);
  const daySessions = sortByTime(upcomingSessions.filter(s => s.date === selectedDateStr));

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
              {daySessions.map(s => <SessionRow key={s.id} s={s} onClick={onSelectSession} compact />)}
            </div>
        }
      </div>
    </>
  );
}

/* ── AGENDA ROOT ── */
export function Agenda() {
  const { upcomingSessions, patients, createSession, onCancelSession, onMarkCompleted, deleteSession, rescheduleSession, updateSessionModality, updateSessionRate, updateCancelReason, notes, createNote, updateNote, deleteNote, mutating, consumeAgendaView } = useCardigan();
  const { t } = useT();
  const { isDesktop } = useViewport();
  // Default to week view on desktop (more horizontal room) and day view on
  // mobile. A cross-screen pending view (consumeAgendaView) always wins.
  const [view, setView] = useState(() => consumeAgendaView?.() || (isDesktop ? "week" : "day"));
  const [selectedDate, setSelectedDate] = useState(new Date(TODAY));
  const [selectedSession, setSelectedSession] = useState(null);
  // "reschedule" when the sheet was opened via a long-press on a week
  // event (mobile drag-reschedule replacement); cleared on close. Null
  // for all other entry points.
  const [selectedSessionMode, setSelectedSessionMode] = useState(null);
  const [editingNote, setEditingNote] = useState(null);
  const [filterPatientId, setFilterPatientId] = useState("");
  const [newSessionPrefill, setNewSessionPrefill] = useState(null);

  // "Ahora" tick — re-render every minute so the now-line stays current
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const filteredSessions = useMemo(() => {
    if (!filterPatientId) return upcomingSessions;
    return upcomingSessions.filter(s => s.patient_id === filterPatientId);
  }, [upcomingSessions, filterPatientId]);

  const filterPatientName = filterPatientId ? patients.find(p => p.id === filterPatientId)?.name || "" : "";

  const handleCellTap = useCallback((date, hour) => {
    setNewSessionPrefill({ date: toISODate(date), time: hour });
  }, []);

  // Drag-and-drop reschedule (desktop week view): accept drops on any
  // hour cell, move the session to that slot. Keeps duration intact;
  // uses formatShortDate + the hour string which already matches the
  // project's "D MMM" + "HH:MM" format.
  const handleDropSession = useCallback(async (sessionId, date, hour) => {
    const sess = upcomingSessions.find(s => s.id === sessionId);
    if (!sess) return;
    const newShortDate = formatShortDate(date);
    if (sess.date === newShortDate && sess.time === hour) return;
    await rescheduleSession(sessionId, newShortDate, hour, sess.duration || 60);
  }, [upcomingSessions, rescheduleSession]);

  const ctxMenu = useContextMenu();
  const handleEventContextMenu = useCallback((e, sess) => {
    const isCancelled = isCancelledStatus(sess.status);
    const isCompleted = sess.status === "completed";
    const items = [
      { key: "open", label: t("sessions.session"), icon: <IconCalendar size={15} />, onSelect: () => setSelectedSession(sess) },
      { divider: true },
    ];
    if (!isCompleted) {
      items.push({ key: "complete", label: t("sessions.markCompleted"), icon: <IconCheck size={15} />,
        onSelect: async () => { await onMarkCompleted(sess); } });
    }
    if (!isCancelled) {
      items.push({ key: "cancel", label: t("sessions.markCancelled") || "Cancelar sesión", icon: <IconX size={15} />,
        onSelect: async () => { await onCancelSession(sess, false, null); } });
    }
    items.push({ divider: true });
    items.push({ key: "delete", label: t("delete"), icon: <IconTrash size={15} />, destructive: true,
      onSelect: async () => { await deleteSession(sess.id); } });
    ctxMenu.openAt(e, items);
  }, [ctxMenu, onMarkCompleted, onCancelSession, deleteSession, t]);

  const jumpToToday = useCallback(() => {
    setSelectedDate(new Date(TODAY));
  }, []);

  const handleOpenNote = async (session) => {
    const existing = notes?.find(n => n.session_id === session.id);
    if (existing) {
      setEditingNote(existing);
    } else {
      const patient = patients?.find(p => p.name === session.patient);
      const note = await createNote({ patientId: patient?.id || session.patient_id, sessionId: session.id });
      if (note) setEditingNote(note);
    }
    setSelectedSession(null);
  };

  return (
    <>
    {editingNote && (
      <NoteEditor
        note={editingNote}
        onSave={async ({ title, content }) => await updateNote(editingNote.id, { title, content })}
        onDelete={async () => { await deleteNote(editingNote.id); }}
        onClose={() => setEditingNote(null)}
      />
    )}
    <div className="page" data-tour="agenda-section">
      <div style={{ paddingTop:16 }}>
        <div style={{ padding:"0 16px 14px" }}>
          <SegmentedControl
            dataTour="agenda-toggle"
            value={view}
            onChange={setView}
            items={[
              { k: "day",   l: t("agenda.dayView") },
              { k: "week",  l: t("agenda.weekView") },
              { k: "month", l: t("agenda.monthView") },
            ]}
          />
        </div>
        {patients.length > 0 && (
          <div style={{ padding:"0 16px 10px" }}>
            <select
              value={filterPatientId}
              onChange={e => setFilterPatientId(e.target.value)}
              style={{ width:"100%", fontSize:"var(--text-sm)", fontWeight:600, fontFamily:"var(--font)", padding:"8px 12px", borderRadius:"var(--radius-pill)", border:"1.5px solid var(--border)", background:"var(--white)", color:"var(--charcoal-md)", cursor:"pointer", appearance:"auto" }}
            >
              <option value="">{t("agenda.allPatients")}</option>
              {patients.filter(p => p.status === "active").sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      {upcomingSessions.length === 0 && (
        <div style={{ padding:"32px 24px", textAlign:"center" }}>
          <div style={{ color:"var(--teal-light)", marginBottom:10 }}><IconSun size={32} /></div>
          <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-lg)", fontWeight:700, color:"var(--charcoal)", marginBottom:6 }}>{t("sessions.noSessions")}</div>
          <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)", lineHeight:1.5 }}>{t("agenda.emptyHint")}</div>
        </div>
      )}
      {view==="day"   && <DayView   selectedDate={selectedDate} setSelectedDate={setSelectedDate} onSelectSession={setSelectedSession} upcomingSessions={filteredSessions} jumpToToday={jumpToToday} filterPatientName={filterPatientName} />}
      {view==="week"  && <WeekView  selectedDate={selectedDate} setSelectedDate={setSelectedDate} setView={setView} onSelectSession={(s, mode) => { setSelectedSession(s); setSelectedSessionMode(mode || null); }} onCellTap={handleCellTap} onDropSession={handleDropSession} canDrag={isDesktop} onEventContextMenu={isDesktop ? handleEventContextMenu : undefined} upcomingSessions={filteredSessions} now={now} jumpToToday={jumpToToday} />}
      {view==="month" && <MonthView selectedDate={selectedDate} setSelectedDate={setSelectedDate} onSelectSession={setSelectedSession} upcomingSessions={filteredSessions} jumpToToday={jumpToToday} filterPatientName={filterPatientName} />}
      {newSessionPrefill && (
        <NewSessionSheet
          onClose={() => setNewSessionPrefill(null)}
          onSubmit={createSession}
          patients={patients}
          sessions={upcomingSessions}
          mutating={mutating}
          initialDate={newSessionPrefill.date}
          initialTime={newSessionPrefill.time}
        />
      )}
      <SessionSheet
        session={selectedSession}
        patients={patients}
        notes={notes}
        initialMode={selectedSessionMode}
        onClose={() => { setSelectedSession(null); setSelectedSessionMode(null); }}
        onOpenNote={handleOpenNote}
        onCancelSession={async (session, charge, reason) => {
          const ok = await onCancelSession(session, charge, reason);
          if (ok) setSelectedSession(prev => (prev ? { ...prev, status: charge ? "charged" : "cancelled", cancel_reason: reason || null } : prev));
        }}
        onMarkCompleted={async (session, overrideStatus) => {
          const st = overrideStatus || "completed";
          const ok = await onMarkCompleted(session, overrideStatus);
          if (ok) setSelectedSession(prev => (prev ? { ...prev, status: st, cancel_reason: null } : prev));
        }}
        onDelete={async (id) => { await deleteSession(id); setSelectedSession(null); }}
        onReschedule={async (id, date, time, duration) => {
          const ok = await rescheduleSession(id, date, time, duration);
          if (ok) setSelectedSession(prev => prev ? { ...prev, date, time, duration, status: "scheduled" } : prev);
          return ok;
        }}
        onUpdateModality={async (id, modality) => {
          const ok = await updateSessionModality(id, modality);
          if (ok) setSelectedSession(prev => prev ? { ...prev, modality } : prev);
          return ok;
        }}
        onUpdateRate={async (id, rate) => {
          const ok = await updateSessionRate(id, rate);
          if (ok) setSelectedSession(prev => prev ? { ...prev, rate: Number(rate) } : prev);
          return ok;
        }}
        onUpdateCancelReason={async (id, reason) => {
          const ok = await updateCancelReason(id, reason);
          if (ok) setSelectedSession(prev => prev ? { ...prev, cancel_reason: reason.trim() || null } : prev);
          return ok;
        }}
        mutating={mutating}
      />
      <ContextMenu {...ctxMenu.state} onClose={ctxMenu.close} />
    </div>
    </>
  );
}
