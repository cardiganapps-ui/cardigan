import { useState, useMemo, useCallback } from "react";
import { clientColors, TODAY } from "../data/seedData";
import { SessionSheet } from "../components/SessionSheet";
import { NoteEditor } from "../components/NoteEditor";
import { IconLeaf } from "../components/Icons";
import { formatShortDate, SHORT_MONTHS } from "../utils/dates";
import { isCancelledStatus, statusClass, statusLabel, isTutorSession, tutorDisplayInitials } from "../utils/sessions";
import { useSwipe } from "../hooks/useSwipe";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";

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
function SessionRow({ s, onClick, compact }) {
  const tutor = isTutorSession(s);
  const sz = compact ? 34 : 36;
  return (
    <div className="row-item" key={s.id} onClick={() => onClick(s)}>
      <div style={{ width: compact ? 40 : 44, textAlign:"center", flex:"none" }}>
        <div style={{ fontFamily:"var(--font-d)", fontSize: compact ? 13 : 14, fontWeight:800, color:"var(--teal-dark)" }}>{s.time}</div>
      </div>
      <div className="row-avatar" style={{ background: tutor ? "var(--purple)" : clientColors[s.colorIdx], width:sz, height:sz, fontSize:11, border: tutor ? "2px dashed var(--purple-bg)" : undefined }}>
        {tutor ? tutorDisplayInitials(s) : s.initials}
      </div>
      <div className="row-content">
        <div className="row-title">{s.patient}{tutor && <span style={{ fontSize:10, fontWeight:700, color:"var(--purple)", marginLeft:6, textTransform:"uppercase" }}>Tutor</span>}</div>
        <div className="row-sub">{s.day}</div>
      </div>
      <span className={`session-status ${statusClass(s.status)}`}>{statusLabel(s.status)}</span>
      {!compact && <span className="row-chevron">›</span>}
    </div>
  );
}

/* ── DAY PANEL (renders one week's day-view content) ── */
function DayPanel({ baseDate, selectedDate, setSelectedDate, onSelectSession, upcomingSessions, sessionDateSet }) {
  const { t, strings } = useT();
  const DOW = strings.daysShort;
  const weekDays = getWeekDays(baseDate);
  // In the current panel, show the selected day; in prev/next panels show the same weekday
  const dayIdx = (selectedDate.getDay() + 6) % 7;
  const panelDate = isSameDay(getMonday(baseDate), getMonday(selectedDate)) ? selectedDate : weekDays[dayIdx];
  const dateStr = formatShortDate(panelDate);
  const daySessions = sortByTime(upcomingSessions.filter(s => s.date === dateStr));
  const dayName = DOW[(panelDate.getDay() + 6) % 7];

  const monday = weekDays[0];
  const sunday = weekDays[6];
  const weekLabel = monday.getMonth() === sunday.getMonth()
    ? `${monday.getDate()}–${sunday.getDate()} ${SHORT_MONTHS[monday.getMonth()]}`
    : `${formatShortDate(monday)} – ${formatShortDate(sunday)}`;

  return (
    <>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px 10px" }}>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, -7))}>‹</button>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:12, color:"var(--charcoal-xl)", fontWeight:600 }}>{weekLabel}</div>
        </div>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, 7))}>›</button>
      </div>
      <div style={{ paddingBottom:4 }}>
        <div className="cal-strip">
          {weekDays.map((d,i) => {
            const ds = formatShortDate(d);
            const isActive = isSameDay(d, panelDate);
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
      <div style={{ padding:"0 16px 4px" }}>
        <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:800, color:"var(--charcoal)", marginBottom:2 }}>{dayName} {dateStr}</div>
        <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginBottom:10 }}>{daySessions.length===0 ? t("sessions.noSessions") : t("sessions.sessionsCount", { count: daySessions.length })}</div>
      </div>
      <div style={{ padding:"0 16px 12px" }}>
        {daySessions.length === 0
          ? <div className="card" style={{ padding:32, textAlign:"center" }}>
              <div style={{ marginBottom:10, color:"var(--teal-light)" }}><IconLeaf size={32} /></div>
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

/* ── DAY VIEW ── */
function DayView({ selectedDate, setSelectedDate, onSelectSession, upcomingSessions }) {
  const sessionDateSet = useMemo(() => new Set(upcomingSessions.map(s => s.date)), [upcomingSessions]);
  const swipe = useSwipe(
    useCallback(() => setSelectedDate(d => addDays(d, 7)), [setSelectedDate]),
    useCallback(() => setSelectedDate(d => addDays(d, -7)), [setSelectedDate])
  );
  const prevWeek = addDays(selectedDate, -7);
  const nextWeek = addDays(selectedDate, 7);
  const shared = { setSelectedDate, onSelectSession, upcomingSessions, sessionDateSet };

  return (
    <div {...swipe.containerProps}>
      <div style={swipe.stripStyle}>
        <div style={swipe.panelStyle}><DayPanel baseDate={prevWeek} selectedDate={selectedDate} {...shared} /></div>
        <div style={swipe.panelStyle}><DayPanel baseDate={selectedDate} selectedDate={selectedDate} {...shared} /></div>
        <div style={swipe.panelStyle}><DayPanel baseDate={nextWeek} selectedDate={selectedDate} {...shared} /></div>
      </div>
    </div>
  );
}

/* ── WEEK PANEL (renders one week's grid) ── */
function WeekPanel({ baseDate, selectedDate, setSelectedDate, setView, onSelectSession, upcomingSessions, showWeekends }) {
  const { t, strings } = useT();
  const DOW = strings.daysShort;
  const HOURS = strings.hours;
  const weekDays = getWeekDays(baseDate);
  const visibleDays = showWeekends ? weekDays : weekDays.slice(0, 5);
  const visibleDow = showWeekends ? DOW : DOW.slice(0, 5);
  const monday = weekDays[0];
  const weekLabel = `${t("sessions.weekOf")} ${formatShortDate(monday)}`;
  const hourIndex = (t) => parseInt(t.split(":")[0]) - 8;
  const gridCols = `44px repeat(${visibleDays.length}, 1fr)`;

  return (
    <>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px 8px" }}>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, -7))}>‹</button>
        <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:800, color:"var(--charcoal)" }}>{weekLabel}</div>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, 7))}>›</button>
      </div>
      <div className="week-header-row" style={{ gridTemplateColumns: gridCols }}>
        <div />
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
      <div className="week-body">
        {HOURS.map((hour, hIdx) => (
          <div className="week-time-row" key={hour} style={{ gridTemplateColumns: gridCols }}>
            <div className="week-time-label">{hour}</div>
            {visibleDays.map((d, dIdx) => {
              const ds = formatShortDate(d);
              const sess = upcomingSessions.filter(s => s.date===ds).find(s => hourIndex(s.time)===hIdx);
              return (
                <div key={dIdx} className="week-cell" role="button" tabIndex={0} onClick={() => !sess && setSelectedDate(d)}>
                  {sess && (
                    <div className={`week-event ${isCancelledStatus(sess.status)?"cancelled":""}`}
                      style={isTutorSession(sess) ? { background:"var(--purple)", borderStyle:"dashed" } : undefined}
                      onClick={e => { e.stopPropagation(); onSelectSession(sess); }}>
                      {isTutorSession(sess) ? tutorDisplayInitials(sess) : sess.initials}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

/* ── WEEK VIEW ── */
function WeekView({ selectedDate, setSelectedDate, setView, onSelectSession, upcomingSessions }) {
  const [showWeekends, setShowWeekends] = useState(false);
  const swipe = useSwipe(
    useCallback(() => setSelectedDate(d => addDays(d, 7)), [setSelectedDate]),
    useCallback(() => setSelectedDate(d => addDays(d, -7)), [setSelectedDate])
  );
  const prevWeek = addDays(selectedDate, -7);
  const nextWeek = addDays(selectedDate, 7);
  const shared = { selectedDate, setSelectedDate, setView, onSelectSession, upcomingSessions, showWeekends };

  return (
    <div {...swipe.containerProps}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", padding:"0 16px 8px", gap:8 }}>
        <span style={{ fontSize:11, fontWeight:600, color:"var(--charcoal-xl)" }}>{t("sessions.weekends")}</span>
        <button
          onClick={() => setShowWeekends(v => !v)}
          style={{ width:36, height:20, borderRadius:10, border:"none", cursor:"pointer", padding:2, background: showWeekends ? "var(--teal)" : "var(--cream-deeper)", transition:"background 0.2s", position:"relative", flexShrink:0 }}
        >
          <div style={{ width:16, height:16, borderRadius:"50%", background:"white", boxShadow:"0 1px 3px rgba(0,0,0,0.2)", transform: showWeekends ? "translateX(16px)" : "translateX(0)", transition:"transform 0.2s" }} />
        </button>
      </div>
      <div style={swipe.stripStyle}>
        <div style={swipe.panelStyle}><WeekPanel baseDate={prevWeek} {...shared} /></div>
        <div style={swipe.panelStyle}><WeekPanel baseDate={selectedDate} {...shared} /></div>
        <div style={swipe.panelStyle}><WeekPanel baseDate={nextWeek} {...shared} /></div>
      </div>
    </div>
  );
}

/* ── MONTH PANEL (renders one month's calendar grid) ── */
function MonthPanel({ year, month, selectedDate, setSelectedDate, onSelectSession, upcomingSessions, sessionDateSet, goMonth }) {
  const { t, strings } = useT();
  const MONTH_NAMES = strings.months;
  const DOW = strings.daysShort;
  const cells = buildMonthGrid(year, month);
  const selectedDateStr = formatShortDate(selectedDate);
  const isCurrentMonth = selectedDate.getMonth() === month && selectedDate.getFullYear() === year;
  const daySessions = isCurrentMonth ? sortByTime(upcomingSessions.filter(s => s.date === selectedDateStr)) : [];

  return (
    <>
      <div className="month-header">
        <button className="month-nav-btn" onClick={() => goMonth(-1)}>‹</button>
        <span className="month-title">{MONTH_NAMES[month]} {year}</span>
        <button className="month-nav-btn" onClick={() => goMonth(1)}>›</button>
      </div>
      <div className="month-grid">
        <div className="month-dow-row">{DOW.map(d => <div key={d} className="month-dow">{d}</div>)}</div>
        <div className="month-days-grid">
          {cells.map((cell, i) => {
            const cellDate = new Date(year, month + (cell.current ? 0 : (i < 7 ? -1 : 1)), cell.num);
            const cellStr = formatShortDate(cellDate);
            const isToday  = isSameDay(cellDate, TODAY);
            const isActive = isCurrentMonth && cellStr === selectedDateStr;
            const hasSess  = sessionDateSet.has(cellStr);
            return (
              <div key={i} className={`month-cell ${isActive?"active":""} ${isToday&&!isActive?"today":""} ${!cell.current?"other-month":""}`}
                role="button" tabIndex={0} onClick={() => setSelectedDate(cellDate)}>
                <span className="month-cell-num">{cell.num}</span>
                {hasSess && <div className="month-dot" />}
              </div>
            );
          })}
        </div>
      </div>
      {isCurrentMonth && (
        <div style={{ padding:"16px 16px 0" }}>
          <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:10 }}>
            <div className="section-title">{selectedDateStr}</div>
            <div style={{ fontSize:12, color:"var(--charcoal-xl)" }}>{daySessions.length===0?t("sessions.noSessions"):t("sessions.sessionsCount", { count: daySessions.length })}</div>
          </div>
          {daySessions.length === 0
            ? <div className="card" style={{ padding:"20px 16px", textAlign:"center" }}>
                <div style={{ marginBottom:6, color:"var(--teal-light)" }}><IconLeaf size={24} /></div>
                <div style={{ fontSize:13, color:"var(--charcoal-xl)" }}>{t("sessions.freeDay")}</div>
              </div>
            : <div className="card">
                {daySessions.map(s => <SessionRow key={s.id} s={s} onClick={onSelectSession} compact />)}
              </div>
          }
        </div>
      )}
    </>
  );
}

/* ── MONTH VIEW ── */
function MonthView({ onSelectSession, selectedDate, setSelectedDate, upcomingSessions }) {
  const displayMonth = selectedDate.getMonth();
  const displayYear  = selectedDate.getFullYear();

  const goMonth = useCallback((delta) => {
    setSelectedDate(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }, [setSelectedDate]);

  const sessionDateSet = useMemo(() => new Set(upcomingSessions.map(s => s.date)), [upcomingSessions]);
  const swipe = useSwipe(
    useCallback(() => goMonth(1), [goMonth]),
    useCallback(() => goMonth(-1), [goMonth])
  );

  const prevMonth = displayMonth === 0 ? 11 : displayMonth - 1;
  const prevYear = displayMonth === 0 ? displayYear - 1 : displayYear;
  const nextMonth = displayMonth === 11 ? 0 : displayMonth + 1;
  const nextYear = displayMonth === 11 ? displayYear + 1 : displayYear;
  const shared = { selectedDate, setSelectedDate, onSelectSession, upcomingSessions, sessionDateSet, goMonth };

  return (
    <div {...swipe.containerProps}>
      <div style={swipe.stripStyle}>
        <div style={swipe.panelStyle}><MonthPanel year={prevYear} month={prevMonth} {...shared} /></div>
        <div style={swipe.panelStyle}><MonthPanel year={displayYear} month={displayMonth} {...shared} /></div>
        <div style={swipe.panelStyle}><MonthPanel year={nextYear} month={nextMonth} {...shared} /></div>
      </div>
    </div>
  );
}

/* ── AGENDA ROOT ── */
export function Agenda() {
  const { upcomingSessions, patients, onCancelSession, onMarkCompleted, deleteSession, rescheduleSession, notes, createNote, updateNote, deleteNote, mutating } = useCardigan();
  const { t, strings } = useT();
  const MONTH_NAMES = strings.months;
  const DOW = strings.daysShort;
  const HOURS = strings.hours;
  const [view, setView] = useState("day");
  const [selectedDate, setSelectedDate] = useState(new Date(TODAY));
  const [selectedSession, setSelectedSession] = useState(null);
  const [editingNote, setEditingNote] = useState(null);
  const [filterPatient, setFilterPatient] = useState("");

  const isToday = isSameDay(selectedDate, TODAY);
  const filteredSessions = filterPatient
    ? upcomingSessions.filter(s => s.patient_id === filterPatient)
    : upcomingSessions;

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

  if (editingNote) {
    return (
      <NoteEditor
        note={editingNote}
        onSave={async ({ title, content }) => await updateNote(editingNote.id, { title, content })}
        onDelete={async () => { await deleteNote(editingNote.id); }}
        onClose={() => setEditingNote(null)}
      />
    );
  }

  return (
    <div className="page">
      <div style={{ paddingTop:16 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"0 16px 14px" }}>
          <div className="view-toggle" style={{ flex:1, margin:0 }}>
            {[{k:"day",l:"Día"},{k:"week",l:"Semana"},{k:"month",l:"Mes"}].map(v => (
              <button key={v.k} className={`view-btn ${view===v.k?"active":""}`} onClick={() => setView(v.k)}>{v.l}</button>
            ))}
          </div>
          {!isToday && (
            <button onClick={() => setSelectedDate(new Date(TODAY))}
              style={{ padding:"7px 12px", fontSize:11, fontWeight:700, borderRadius:"var(--radius-pill)", border:"1.5px solid var(--teal)", background:"var(--white)", color:"var(--teal-dark)", cursor:"pointer", fontFamily:"var(--font)", whiteSpace:"nowrap", flexShrink:0 }}>
              {t("sessions.today")}
            </button>
          )}
        </div>
        {patients.length > 0 && (
          <div style={{ padding:"0 16px 10px" }}>
            <select className="input" value={filterPatient} onChange={e => setFilterPatient(e.target.value)}
              style={{ fontSize:12, padding:"7px 10px", color: filterPatient ? "var(--teal-dark)" : "var(--charcoal-xl)" }}>
              <option value="">Todos los pacientes</option>
              {patients.filter(p => p.status === "active").map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      {upcomingSessions.length === 0 && (
        <div style={{ padding:"32px 24px", textAlign:"center" }}>
          <div style={{ color:"var(--teal-light)", marginBottom:10 }}><IconLeaf size={36} /></div>
          <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:700, color:"var(--charcoal)", marginBottom:6 }}>Sin sesiones</div>
          <div style={{ fontSize:13, color:"var(--charcoal-xl)", lineHeight:1.5 }}>Agrega pacientes y citas recurrentes para ver tu agenda aquí.</div>
        </div>
      )}
      {view==="day"   && <DayView   selectedDate={selectedDate} setSelectedDate={setSelectedDate} onSelectSession={setSelectedSession} upcomingSessions={filteredSessions} />}
      {view==="week"  && <WeekView  selectedDate={selectedDate} setSelectedDate={setSelectedDate} setView={setView} onSelectSession={setSelectedSession} upcomingSessions={filteredSessions} />}
      {view==="month" && <MonthView selectedDate={selectedDate} setSelectedDate={setSelectedDate} onSelectSession={setSelectedSession} upcomingSessions={filteredSessions} />}
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
  );
}
