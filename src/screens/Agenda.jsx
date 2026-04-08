import { useState, useMemo, useRef, useCallback } from "react";
import { clientColors, MONTH_NAMES, DOW, HOURS, TODAY } from "../data/seedData";
import { SessionSheet } from "../components/SessionSheet";
import { IconLeaf } from "../components/Icons";

/* ── INTERACTIVE SWIPE HOOK ── */
function useSwipe(onLeft, onRight) {
  const ref = useRef(null);
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const onTouchStart = useCallback((e) => {
    if (e.touches[0].clientX < 30) return; // reserve left edge for drawer
    ref.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, active: false };
  }, []);

  const onTouchMove = useCallback((e) => {
    if (!ref.current) return;
    const dx = e.touches[0].clientX - ref.current.x;
    const dy = e.touches[0].clientY - ref.current.y;
    if (!ref.current.active) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        ref.current.active = true;
        setSwiping(true);
      } else if (Math.abs(dy) > 10) {
        ref.current = null;
        return;
      } else return;
    }
    if (ref.current.active) setOffset(dx);
  }, []);

  const onTouchEnd = useCallback((e) => {
    if (!ref.current?.active) { ref.current = null; return; }
    const dx = e.changedTouches[0].clientX - ref.current.x;
    ref.current = null;
    setSwiping(false);
    setOffset(0);
    if (dx < -80) onLeft();
    else if (dx > 80) onRight();
  }, [onLeft, onRight]);

  const style = swiping
    ? { transform: `translateX(${offset}px)`, transition: "none", willChange: "transform" }
    : undefined;

  return { onTouchStart, onTouchMove, onTouchEnd, style };
}

/* ── DATE HELPERS ── */
const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function formatDateStr(d) {
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}

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

function isCancelledStatus(s) {
  return s === "cancelled" || s === "charged";
}

function statusClass(s) {
  if (s === "scheduled") return "status-scheduled";
  if (s === "completed") return "status-completed";
  return "status-cancelled";
}

function statusLabel(s) {
  if (isCancelledStatus(s)) return "Cancelada";
  if (s === "completed") return "Completada";
  return "Agendada";
}

/* ── SESSION ROW (shared) ── */
function SessionRow({ s, onClick, compact }) {
  return (
    <div className="row-item" key={s.id} onClick={() => onClick(s)}>
      <div style={{ width: compact ? 40 : 44, textAlign:"center", flex:"none" }}>
        <div style={{ fontFamily:"var(--font-d)", fontSize: compact ? 13 : 14, fontWeight:800, color:"var(--teal-dark)" }}>{s.time}</div>
      </div>
      <div className="row-avatar" style={{ background: clientColors[s.colorIdx], width: compact ? 34 : 36, height: compact ? 34 : 36, fontSize:11 }}>{s.initials}</div>
      <div className="row-content">
        <div className="row-title">{s.patient}</div>
        <div className="row-sub">{s.day}</div>
      </div>
      <span className={`session-status ${statusClass(s.status)}`}>{statusLabel(s.status)}</span>
      {!compact && <span className="row-chevron">›</span>}
    </div>
  );
}

/* ── DAY VIEW ── */
function DayView({ selectedDate, setSelectedDate, onSelectSession, upcomingSessions }) {
  const dateStr = formatDateStr(selectedDate);
  const daySessions = sortByTime(upcomingSessions.filter(s => s.date === dateStr));
  const weekDays = getWeekDays(selectedDate);
  const dayName = DOW[(selectedDate.getDay() + 6) % 7];
  const sessionDateSet = useMemo(() => new Set(upcomingSessions.map(s => s.date)), [upcomingSessions]);
  const swipe = useSwipe(
    useCallback(() => setSelectedDate(d => addDays(d, 7)), [setSelectedDate]),
    useCallback(() => setSelectedDate(d => addDays(d, -7)), [setSelectedDate])
  );

  const monday = weekDays[0];
  const sunday = weekDays[6];
  const weekLabel = monday.getMonth() === sunday.getMonth()
    ? `${monday.getDate()}–${sunday.getDate()} ${SHORT_MONTHS[monday.getMonth()]}`
    : `${formatDateStr(monday)} – ${formatDateStr(sunday)}`;

  return (
    <div onTouchStart={swipe.onTouchStart} onTouchMove={swipe.onTouchMove} onTouchEnd={swipe.onTouchEnd} style={{ overflow:"hidden" }}>
      <div style={swipe.style}>
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
            const ds = formatDateStr(d);
            const isActive = isSameDay(d, selectedDate);
            const isToday = isSameDay(d, TODAY);
            const hasSess = sessionDateSet.has(ds);
            return (
              <div key={i} className={`cal-day ${isActive?"active":""} ${hasSess?"has-sessions":""} ${isToday&&!isActive?"today":""}`} onClick={() => setSelectedDate(d)}>
                <span className="cal-day-name">{DOW[i]}</span>
                <span className="cal-day-num">{d.getDate()}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ padding:"0 16px 4px" }}>
        <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:800, color:"var(--charcoal)", marginBottom:2 }}>{dayName} {dateStr}</div>
        <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginBottom:10 }}>{daySessions.length===0 ? "Sin sesiones" : `${daySessions.length} sesión${daySessions.length>1?"es":""}`}</div>
      </div>
      <div style={{ padding:"0 16px 12px" }}>
        {daySessions.length === 0
          ? <div className="card" style={{ padding:32, textAlign:"center" }}>
              <div style={{ marginBottom:10, color:"var(--teal-light)" }}><IconLeaf size={32} /></div>
              <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:700, color:"var(--charcoal)", marginBottom:4 }}>Día libre</div>
              <div style={{ fontSize:13, color:"var(--charcoal-xl)" }}>No hay sesiones este día.</div>
            </div>
          : <div className="card">
              {daySessions.map(s => <SessionRow key={s.id} s={s} onClick={onSelectSession} />)}
            </div>
        }
      </div>
      </div>
    </div>
  );
}

/* ── WEEK VIEW ── */
function WeekView({ selectedDate, setSelectedDate, setView, onSelectSession, upcomingSessions }) {
  const [showWeekends, setShowWeekends] = useState(false);
  const weekDays = getWeekDays(selectedDate);
  const visibleDays = showWeekends ? weekDays : weekDays.slice(0, 5);
  const visibleDow = showWeekends ? DOW : DOW.slice(0, 5);
  const monday = weekDays[0];
  const weekLabel = `Semana del ${formatDateStr(monday)}`;
  const hourIndex = (t) => parseInt(t.split(":")[0]) - 8;
  const gridCols = `44px repeat(${visibleDays.length}, 1fr)`;
  const swipe = useSwipe(
    useCallback(() => setSelectedDate(d => addDays(d, 7)), [setSelectedDate]),
    useCallback(() => setSelectedDate(d => addDays(d, -7)), [setSelectedDate])
  );

  return (
    <div onTouchStart={swipe.onTouchStart} onTouchMove={swipe.onTouchMove} onTouchEnd={swipe.onTouchEnd} style={{ overflow:"hidden" }}>
      <div style={swipe.style}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px 8px" }}>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, -7))}>‹</button>
        <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:800, color:"var(--charcoal)" }}>{weekLabel}</div>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, 7))}>›</button>
      </div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", padding:"0 16px 8px", gap:8 }}>
        <span style={{ fontSize:11, fontWeight:600, color:"var(--charcoal-xl)" }}>Fines de semana</span>
        <button
          onClick={() => setShowWeekends(v => !v)}
          style={{ width:36, height:20, borderRadius:10, border:"none", cursor:"pointer", padding:2, background: showWeekends ? "var(--teal)" : "var(--cream-deeper)", transition:"background 0.2s", position:"relative", flexShrink:0 }}
        >
          <div style={{ width:16, height:16, borderRadius:"50%", background:"white", boxShadow:"0 1px 3px rgba(0,0,0,0.2)", transform: showWeekends ? "translateX(16px)" : "translateX(0)", transition:"transform 0.2s" }} />
        </button>
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
              const ds = formatDateStr(d);
              const sess = upcomingSessions.filter(s => s.date===ds).find(s => hourIndex(s.time)===hIdx);
              return (
                <div key={dIdx} className="week-cell" onClick={() => !sess && setSelectedDate(d)}>
                  {sess && (
                    <div className={`week-event ${isCancelledStatus(sess.status)?"cancelled":""}`} onClick={e => { e.stopPropagation(); onSelectSession(sess); }}>
                      {sess.initials}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}

/* ── MONTH VIEW ── */
function MonthView({ onSelectSession, selectedDate, setSelectedDate, upcomingSessions }) {
  const displayMonth = selectedDate.getMonth();
  const displayYear  = selectedDate.getFullYear();
  const cells   = buildMonthGrid(displayYear, displayMonth);

  const goMonth = useCallback((delta) => {
    setSelectedDate(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }, [setSelectedDate]);

  const sessionDateSet = useMemo(() => new Set(upcomingSessions.map(s => s.date)), [upcomingSessions]);
  const selectedDateStr = formatDateStr(selectedDate);
  const daySessions = sortByTime(upcomingSessions.filter(s => s.date === selectedDateStr));
  const swipe = useSwipe(
    useCallback(() => goMonth(1), [goMonth]),
    useCallback(() => goMonth(-1), [goMonth])
  );

  return (
    <div onTouchStart={swipe.onTouchStart} onTouchMove={swipe.onTouchMove} onTouchEnd={swipe.onTouchEnd} style={{ overflow:"hidden" }}>
      <div style={swipe.style}>
      <div className="month-header">
        <button className="month-nav-btn" onClick={() => goMonth(-1)}>‹</button>
        <span className="month-title">{MONTH_NAMES[displayMonth]} {displayYear}</span>
        <button className="month-nav-btn" onClick={() => goMonth(1)}>›</button>
      </div>
      <div className="month-grid">
        <div className="month-dow-row">{DOW.map(d => <div key={d} className="month-dow">{d}</div>)}</div>
        <div className="month-days-grid">
          {cells.map((cell, i) => {
            const cellDate = new Date(displayYear, displayMonth + (cell.current ? 0 : (i < 7 ? -1 : 1)), cell.num);
            const cellStr = formatDateStr(cellDate);
            const isToday  = isSameDay(cellDate, TODAY);
            const isActive = cellStr === selectedDateStr;
            const hasSess  = sessionDateSet.has(cellStr);
            return (
              <div key={i} className={`month-cell ${isActive?"active":""} ${isToday&&!isActive?"today":""} ${!cell.current?"other-month":""}`}
                onClick={() => setSelectedDate(cellDate)}>
                <span className="month-cell-num">{cell.num}</span>
                {hasSess && <div className="month-dot" />}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ padding:"16px 16px 0" }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:10 }}>
          <div className="section-title">{selectedDateStr}</div>
          <div style={{ fontSize:12, color:"var(--charcoal-xl)" }}>{daySessions.length===0?"Sin sesiones":`${daySessions.length} sesión${daySessions.length>1?"es":""}`}</div>
        </div>
        {daySessions.length === 0
          ? <div className="card" style={{ padding:"20px 16px", textAlign:"center" }}>
              <div style={{ marginBottom:6, color:"var(--teal-light)" }}><IconLeaf size={24} /></div>
              <div style={{ fontSize:13, color:"var(--charcoal-xl)" }}>Día libre</div>
            </div>
          : <div className="card">
              {daySessions.map(s => <SessionRow key={s.id} s={s} onClick={onSelectSession} compact />)}
            </div>
        }
      </div>
      </div>
    </div>
  );
}

/* ── AGENDA ROOT ── */
export function Agenda({ upcomingSessions, patients, onCancelSession, deleteSession, rescheduleSession, mutating }) {
  const [view, setView] = useState("day");
  const [selectedDate, setSelectedDate] = useState(new Date(TODAY));
  const [selectedSession, setSelectedSession] = useState(null);

  const isToday = isSameDay(selectedDate, TODAY);

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
              Hoy
            </button>
          )}
        </div>
      </div>
      {view==="day"   && <DayView   selectedDate={selectedDate} setSelectedDate={setSelectedDate} onSelectSession={setSelectedSession} upcomingSessions={upcomingSessions} />}
      {view==="week"  && <WeekView  selectedDate={selectedDate} setSelectedDate={setSelectedDate} setView={setView} onSelectSession={setSelectedSession} upcomingSessions={upcomingSessions} />}
      {view==="month" && <MonthView selectedDate={selectedDate} setSelectedDate={setSelectedDate} onSelectSession={setSelectedSession} upcomingSessions={upcomingSessions} />}
      <SessionSheet
        session={selectedSession}
        patients={patients}
        onClose={() => setSelectedSession(null)}
        onCancelSession={async (session, charge) => {
          const ok = await onCancelSession(session, charge);
          if (ok) setSelectedSession(prev => (prev ? { ...prev, status: charge ? "charged" : "cancelled" } : prev));
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
