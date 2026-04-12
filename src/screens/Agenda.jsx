import { useState, useMemo, useCallback, useEffect } from "react";
import { getClientColor, TODAY } from "../data/seedData";
import { SESSION_STATUS } from "../data/constants";
import { SessionSheet } from "../components/SessionSheet";
import { NoteEditor } from "../components/NoteEditor";
import { NewSessionSheet } from "../components/sheets/NewSessionSheet";
import { IconSun, IconSearch, IconX } from "../components/Icons";
import { formatShortDate, toISODate } from "../utils/dates";
import { isCancelledStatus, statusClass, isTutorSession, tutorDisplayInitials, shortName } from "../utils/sessions";
import { useSwipe } from "../hooks/useSwipe";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";
import { Toggle } from "../components/Toggle";

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

/* ── SESSION ROW (shared) ── */
const STATUS_BORDER = {
  [SESSION_STATUS.SCHEDULED]: "var(--teal)",
  [SESSION_STATUS.COMPLETED]: "var(--green)",
  [SESSION_STATUS.CANCELLED]: "var(--charcoal-xl)",
  [SESSION_STATUS.CHARGED]:   "var(--amber)",
};

function SessionRow({ s, onClick, compact }) {
  const { t } = useT();
  const tutor = isTutorSession(s);
  const sz = compact ? 34 : 36;
  const borderColor = STATUS_BORDER[s.status] || "var(--teal)";
  return (
    <div className="row-item" key={s.id} onClick={() => onClick(s)}
      style={{ borderLeft: `3px solid ${borderColor}` }}>
      <div style={{ width: compact ? 40 : 44, textAlign:"center", flex:"none" }}>
        <div style={{ fontFamily:"var(--font-d)", fontSize: compact ? 13 : 14, fontWeight:800, color:"var(--teal-dark)" }}>{s.time}</div>
      </div>
      <div className="row-avatar" style={{ background: tutor ? "var(--purple)" : getClientColor(s.colorIdx), width:sz, height:sz, fontSize:11, border: tutor ? "2px dashed var(--purple-bg)" : undefined }}>
        {tutor ? tutorDisplayInitials(s) : s.initials}
      </div>
      <div className="row-content">
        <div className="row-title">{s.patient}{tutor && <span style={{ fontSize:10, fontWeight:700, color:"var(--purple)", marginLeft:6, textTransform:"uppercase" }}>{t("sessions.tutor")}</span>}</div>
        <div className="row-sub">{s.day}</div>
      </div>
      <span className={`session-status ${statusClass(s.status)}`}>{t(`sessions.${s.status}`)}</span>
      {!compact && <span className="row-chevron">›</span>}
    </div>
  );
}

/* ── DAY PANEL (just one day's session list, no week strip) ── */
function DayPanel({ panelDate, onSelectSession, upcomingSessions }) {
  const { t, strings } = useT();
  const DOW = strings.daysShort;
  const dateStr = formatShortDate(panelDate);
  const daySessions = sortByTime(upcomingSessions.filter(s => s.date === dateStr));
  const dayName = DOW[(panelDate.getDay() + 6) % 7];

  return (
    <>
      <div style={{ padding:"0 16px 4px" }}>
        <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:800, color:"var(--charcoal)", marginBottom:2 }}>{dayName} {dateStr}</div>
        <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginBottom:10 }}>{daySessions.length===0 ? t("sessions.noSessions") : t("sessions.sessionsCount", { count: daySessions.length })}</div>
      </div>
      <div style={{ padding:"0 16px 12px" }}>
        {daySessions.length === 0
          ? <div className="card" style={{ padding:32, textAlign:"center" }}>
              <div style={{ marginBottom:10, color:"var(--teal-light)" }}><IconSun size={32} /></div>
              <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:700, color:"var(--charcoal)", marginBottom:4 }}>{t("sessions.freeDay")}</div>
              <div style={{ fontSize:13, color:"var(--charcoal-xl)" }}>{t("sessions.freeDayMessage")}</div>
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
function DayView({ selectedDate, setSelectedDate, onSelectSession, upcomingSessions, jumpToToday }) {
  const { t, strings } = useT();
  const DOW = strings.daysShort;
  const sessionDateSet = useMemo(() => new Set(upcomingSessions.map(s => s.date)), [upcomingSessions]);
  const swipe = useSwipe(
    useCallback(() => setSelectedDate(d => addDays(d, 1)), [setSelectedDate]),
    useCallback(() => setSelectedDate(d => addDays(d, -1)), [setSelectedDate])
  );
  const prevDay = addDays(selectedDate, -1);
  const nextDay = addDays(selectedDate, 1);
  const shared = { onSelectSession, upcomingSessions };

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
          <span style={{ fontSize:12, color:"var(--charcoal-xl)", fontWeight:600 }}>{weekLabel}</span>
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

/* ── WEEK DAYS PANEL (just the day headers + grid cells, no time labels) ── */
function WeekDaysPanel({ weekDate, selectedDate, setSelectedDate, setView, onSelectSession, onCellTap, upcomingSessions, showWeekends, hours }) {
  const { strings } = useT();
  const DOW = strings.daysShort;
  const weekDays = getWeekDays(weekDate);
  const visibleDays = showWeekends ? weekDays : weekDays.slice(0, 5);
  const visibleDow = showWeekends ? DOW : DOW.slice(0, 5);
  const hourIndex = (time) => parseInt(time.split(":")[0]) - 8;
  const cols = `repeat(${visibleDays.length}, 1fr)`;

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
      <div>
        {hours.map((hour, hIdx) => (
          <div className="week-time-row" key={hour} style={{ gridTemplateColumns: cols }}>
            {visibleDays.map((d, dIdx) => {
              const ds = formatShortDate(d);
              const sess = upcomingSessions.filter(s => s.date===ds).find(s => hourIndex(s.time)===hIdx);
              const eventStyle = sess ? (() => {
                if (isCancelledStatus(sess.status)) return undefined; // .cancelled class handles it
                if (isTutorSession(sess)) return { background:"var(--purple)", borderStyle:"dashed", color:"white", borderLeftColor:"var(--purple)" };
                const c = getClientColor(sess.colorIdx);
                return { background: `${c}26`, borderLeftColor: c, color: "var(--charcoal)" };
              })() : undefined;
              return (
                <div key={dIdx} className="week-cell" role="button" tabIndex={0}
                  onClick={() => !sess && onCellTap && onCellTap(d, hour)}>
                  {sess && (
                    <div className={`week-event ${isCancelledStatus(sess.status)?"cancelled":""}`}
                      style={eventStyle}
                      onClick={e => { e.stopPropagation(); onSelectSession(sess); }}>
                      <span className="week-event-time">{sess.time}</span> {shortName(sess.patient)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── WEEK VIEW ── */
function WeekView({ selectedDate, setSelectedDate, setView, onSelectSession, onCellTap, upcomingSessions, now, jumpToToday }) {
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
  const shared = { selectedDate, setSelectedDate, setView, onSelectSession, onCellTap, upcomingSessions, showWeekends, hours: HOURS };

  // "Ahora" line: only when today is in the visible week and within work hours
  const visibleDays = (showWeekends ? weekDays : weekDays.slice(0, 5));
  const todayIdx = visibleDays.findIndex(d => isSameDay(d, now));
  const nowHourFloat = now.getHours() + now.getMinutes() / 60;
  const showNow = todayIdx >= 0 && nowHourFloat >= 8 && nowHourFloat <= 21;
  const dayCount = visibleDays.length;

  return (
    <>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", padding:"0 16px 8px", gap:8 }}>
        <span style={{ fontSize:11, fontWeight:600, color:"var(--charcoal-xl)" }}>{t("sessions.weekends")}</span>
        <Toggle on={showWeekends} onToggle={() => setShowWeekends(v => !v)} />
      </div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px 8px" }}>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, -7))}>‹</button>
        <HeaderLabel isCurrent={isCurrent} onJumpToday={jumpToToday} t={t}>
          <span style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:800, color:"var(--charcoal)" }}>{weekLabel}</span>
        </HeaderLabel>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, 7))}>›</button>
      </div>
      <div style={{ display:"flex", padding:"0 16px", position:"relative" }}>
        <div style={{ width:44, flexShrink:0 }}>
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
        const visibleDots = sessions.slice(0, 3);
        const extraCount = Math.max(0, sessions.length - 3);
        return (
          <div key={i} className={`month-cell ${isActive?"active":""} ${isToday&&!isActive?"today":""} ${!cell.current?"other-month":""}`}
            role="button" tabIndex={0} onClick={() => setSelectedDate(cellDate)}>
            <span className="month-cell-num">{cell.num}</span>
            {visibleDots.length > 0 && (
              <div className="month-dots">
                {visibleDots.map((s, di) => (
                  <span key={di} className="month-dot-color" style={{ background: getClientColor(s.colorIdx) }} />
                ))}
                {extraCount > 0 && <span className="month-dot-extra">+{extraCount}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── MONTH VIEW ── */
function MonthView({ onSelectSession, selectedDate, setSelectedDate, upcomingSessions, jumpToToday }) {
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
          <div style={{ fontSize:12, color:"var(--charcoal-xl)" }}>{daySessions.length===0?t("sessions.noSessions"):t("sessions.sessionsCount", { count: daySessions.length })}</div>
        </div>
        {daySessions.length === 0
          ? <div className="card" style={{ padding:"20px 16px", textAlign:"center" }}>
              <div style={{ marginBottom:6, color:"var(--teal-light)" }}><IconSun size={24} /></div>
              <div style={{ fontSize:13, color:"var(--charcoal-xl)" }}>{t("sessions.freeDay")}</div>
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
  const { upcomingSessions, patients, createSession, onCancelSession, onMarkCompleted, deleteSession, rescheduleSession, notes, createNote, updateNote, deleteNote, mutating } = useCardigan();
  const { t } = useT();
  const [view, setView] = useState("day");
  const [selectedDate, setSelectedDate] = useState(new Date(TODAY));
  const [selectedSession, setSelectedSession] = useState(null);
  const [editingNote, setEditingNote] = useState(null);
  const [search, setSearch] = useState("");
  const [newSessionPrefill, setNewSessionPrefill] = useState(null);

  // "Ahora" tick — re-render every minute so the now-line stays current
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const filteredSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return upcomingSessions;
    return upcomingSessions.filter(s => (s.patient || "").toLowerCase().includes(q));
  }, [upcomingSessions, search]);

  const handleCellTap = useCallback((date, hour) => {
    setNewSessionPrefill({ date: toISODate(date), time: hour });
  }, []);

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
    <div className="page">
      <div style={{ paddingTop:16 }}>
        <div style={{ padding:"0 16px 14px" }}>
          <div className="view-toggle" data-tour="agenda-toggle" style={{ margin:0 }}>
            {[{k:"day",l:t("agenda.dayView")},{k:"week",l:t("agenda.weekView")},{k:"month",l:t("agenda.monthView")}].map(v => (
              <button key={v.k} className={`view-btn ${view===v.k?"active":""}`} onClick={() => setView(v.k)}>{v.l}</button>
            ))}
          </div>
        </div>
        {patients.length > 0 && (
          <div style={{ padding:"0 16px 10px" }}>
            <div className="search-bar">
              <IconSearch size={16} />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t("patients.searchPlaceholder")}
                aria-label={t("patients.searchPlaceholder")}
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} aria-label={t("close")}
                  style={{ background:"none", border:"none", cursor:"pointer", color:"var(--charcoal-xl)", padding:0, display:"flex", alignItems:"center", minHeight:"unset" }}>
                  <IconX size={14} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {upcomingSessions.length === 0 && (
        <div style={{ padding:"32px 24px", textAlign:"center" }}>
          <div style={{ color:"var(--teal-light)", marginBottom:10 }}><IconSun size={36} /></div>
          <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:700, color:"var(--charcoal)", marginBottom:6 }}>{t("sessions.noSessions")}</div>
          <div style={{ fontSize:13, color:"var(--charcoal-xl)", lineHeight:1.5 }}>{t("agenda.emptyHint")}</div>
        </div>
      )}
      {view==="day"   && <DayView   selectedDate={selectedDate} setSelectedDate={setSelectedDate} onSelectSession={setSelectedSession} upcomingSessions={filteredSessions} jumpToToday={jumpToToday} />}
      {view==="week"  && <WeekView  selectedDate={selectedDate} setSelectedDate={setSelectedDate} setView={setView} onSelectSession={setSelectedSession} onCellTap={handleCellTap} upcomingSessions={filteredSessions} now={now} jumpToToday={jumpToToday} />}
      {view==="month" && <MonthView selectedDate={selectedDate} setSelectedDate={setSelectedDate} onSelectSession={setSelectedSession} upcomingSessions={filteredSessions} jumpToToday={jumpToToday} />}
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
        onClose={() => setSelectedSession(null)}
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
        onReschedule={async (id, date, time) => {
          const ok = await rescheduleSession(id, date, time);
          if (ok) setSelectedSession(prev => prev ? { ...prev, date, time, status: "scheduled" } : prev);
          return ok;
        }}
        mutating={mutating}
      />
    </div>
    </>
  );
}
