import { useState, useMemo } from "react";
import { clientColors, MONTH_NAMES, DOW, HOURS, TODAY } from "../data/seedData";
import { SessionSheet } from "../components/SessionSheet";

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

/* ── DAY VIEW ── */
function DayView({ selectedDate, setSelectedDate, onSelectSession, upcomingSessions }) {
  const dateStr = formatDateStr(selectedDate);
  const daySessions = upcomingSessions.filter(s => s.date === dateStr);
  const weekDays = getWeekDays(selectedDate);
  const dayName = DOW[(selectedDate.getDay() + 6) % 7];
  const sessionDateSet = useMemo(() => new Set(upcomingSessions.map(s => s.date)), [upcomingSessions]);

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px 12px" }}>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, -1))}>‹</button>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:800, color:"var(--charcoal)" }}>{dayName} {dateStr}</div>
          <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginTop:2 }}>{daySessions.length===0 ? "Sin sesiones" : `${daySessions.length} sesión${daySessions.length>1?"es":""}`}</div>
        </div>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, 1))}>›</button>
      </div>
      <div style={{ paddingBottom:8 }}>
        <div className="cal-strip">
          {weekDays.map((d,i) => {
            const ds = formatDateStr(d);
            const isActive = isSameDay(d, selectedDate);
            const hasSess = sessionDateSet.has(ds);
            return (
              <div key={i} className={`cal-day ${isActive?"active":""} ${hasSess?"has-sessions":""}`} onClick={() => setSelectedDate(d)}>
                <span className="cal-day-name">{DOW[i]}</span>
                <span className="cal-day-num">{d.getDate()}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ padding:"4px 16px 12px" }}>
        {daySessions.length === 0
          ? <div className="card" style={{ padding:32, textAlign:"center" }}>
              <div style={{ fontSize:32, marginBottom:10 }}>🌿</div>
              <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:700, color:"var(--charcoal)", marginBottom:4 }}>Día libre</div>
              <div style={{ fontSize:13, color:"var(--charcoal-xl)" }}>No hay sesiones este día.</div>
            </div>
          : <div className="card">
              {daySessions.map(s => (
                <div className="row-item" key={s.id} onClick={() => onSelectSession(s)}>
                  <div style={{ width:44, textAlign:"center", flex:"none" }}>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:14, fontWeight:800, color:"var(--teal-dark)" }}>{s.time}</div>
                  </div>
                  <div className="row-avatar" style={{ background: clientColors[s.colorIdx], width:36, height:36, fontSize:11 }}>{s.initials}</div>
                  <div className="row-content">
                    <div className="row-title">{s.patient}</div>
                    <div className="row-sub">{s.day}</div>
                  </div>
                  <span className={`session-status ${s.status==="scheduled"?"status-scheduled":s.status==="completed"?"status-completed":"status-cancelled"}`}>
                    {s.status==="scheduled"?"Agendada":s.status==="completed"?"Completada":"Cancelada"}
                  </span>
                  <span className="row-chevron">›</span>
                </div>
              ))}
            </div>
        }
      </div>
    </div>
  );
}

/* ── WEEK VIEW ── */
function WeekView({ selectedDate, setSelectedDate, setView, onSelectSession, upcomingSessions }) {
  const weekDays = getWeekDays(selectedDate);
  const monday = weekDays[0];
  const weekLabel = `Semana del ${formatDateStr(monday)}`;
  const hourIndex = (t) => parseInt(t.split(":")[0]) - 8;

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px 12px" }}>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, -7))}>‹</button>
        <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:800, color:"var(--charcoal)" }}>{weekLabel}</div>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, 7))}>›</button>
      </div>
      <div className="week-header-row">
        <div />
        {weekDays.map((d,i) => {
          const ds = formatDateStr(d);
          const isActive = isSameDay(d, selectedDate);
          const isToday = isSameDay(d, TODAY);
          return (
            <div key={i} className="week-day-head" style={{ cursor:"pointer" }} onClick={() => { setSelectedDate(d); setView("day"); }}>
              <span className="week-day-name">{DOW[i]}</span>
              <span className={`week-day-num ${isActive?"active":""} ${isToday&&!isActive?"today":""}`}>{d.getDate()}</span>
            </div>
          );
        })}
      </div>
      <div className="week-body">
        {HOURS.map((hour, hIdx) => (
          <div className="week-time-row" key={hour}>
            <div className="week-time-label">{hour}</div>
            {weekDays.map((d, dIdx) => {
              const ds = formatDateStr(d);
              const sess = upcomingSessions.filter(s => s.date===ds).find(s => hourIndex(s.time)===hIdx);
              return (
                <div key={dIdx} className="week-cell" onClick={() => !sess && setSelectedDate(d)}>
                  {sess && (
                    <div className={`week-event ${sess.status==="cancelled"?"cancelled":""}`} onClick={e => { e.stopPropagation(); onSelectSession(sess); }}>
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
  );
}

/* ── MONTH VIEW ── */
function MonthView({ onSelectSession, selectedDate, setSelectedDate, upcomingSessions }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const base = new Date(2026, 3);
  base.setMonth(base.getMonth() + monthOffset);
  const displayMonth = base.getMonth();
  const displayYear  = base.getFullYear();
  const cells   = buildMonthGrid(displayYear, displayMonth);

  const sessionDateSet = useMemo(() => new Set(upcomingSessions.map(s => s.date)), [upcomingSessions]);
  const selectedDateStr = formatDateStr(selectedDate);
  const daySessions = upcomingSessions.filter(s => s.date === selectedDateStr);

  return (
    <div>
      <div className="month-header">
        <button className="month-nav-btn" onClick={() => setMonthOffset(o => o-1)}>‹</button>
        <span className="month-title">{MONTH_NAMES[displayMonth]} {displayYear}</span>
        <button className="month-nav-btn" onClick={() => setMonthOffset(o => o+1)}>›</button>
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
                onClick={() => { setSelectedDate(cellDate); if (!cell.current) setMonthOffset(o => o + (i < 7 ? -1 : 1)); }}>
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
              <div style={{ fontSize:24, marginBottom:6 }}>🌿</div>
              <div style={{ fontSize:13, color:"var(--charcoal-xl)" }}>Día libre</div>
            </div>
          : <div className="card">
              {daySessions.map(s => (
                <div className="row-item" key={s.id} onClick={() => onSelectSession(s)}>
                  <div style={{ width:40, textAlign:"center", flex:"none" }}>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:13, fontWeight:800, color:"var(--teal-dark)" }}>{s.time}</div>
                  </div>
                  <div className="row-avatar" style={{ background: clientColors[s.colorIdx], width:34, height:34, fontSize:11 }}>{s.initials}</div>
                  <div className="row-content">
                    <div className="row-title">{s.patient}</div>
                    <div className="row-sub">{s.day}</div>
                  </div>
                  <span className={`session-status ${s.status==="cancelled"?"status-cancelled":"status-scheduled"}`}>
                    {s.status==="cancelled"?"Cancelada":"Agendada"}
                  </span>
                </div>
              ))}
            </div>
        }
      </div>
    </div>
  );
}

/* ── AGENDA ROOT ── */
export function Agenda({ upcomingSessions, patients, onMarkSessionCompleted, onCancelSession, mutating }) {
  const [view, setView] = useState("day");
  const [selectedDate, setSelectedDate] = useState(new Date(TODAY));
  const [selectedSession, setSelectedSession] = useState(null);

  return (
    <div className="page">
      <div style={{ paddingTop:16 }}>
        <div className="view-toggle">
          {[{k:"day",l:"Día"},{k:"week",l:"Semana"},{k:"month",l:"Mes"}].map(v => (
            <button key={v.k} className={`view-btn ${view===v.k?"active":""}`} onClick={() => setView(v.k)}>{v.l}</button>
          ))}
        </div>
      </div>
      {view==="day"   && <DayView   selectedDate={selectedDate} setSelectedDate={setSelectedDate} onSelectSession={setSelectedSession} upcomingSessions={upcomingSessions} />}
      {view==="week"  && <WeekView  selectedDate={selectedDate} setSelectedDate={setSelectedDate} setView={setView} onSelectSession={setSelectedSession} upcomingSessions={upcomingSessions} />}
      {view==="month" && <MonthView selectedDate={selectedDate} setSelectedDate={setSelectedDate} onSelectSession={setSelectedSession} upcomingSessions={upcomingSessions} />}
      <SessionSheet
        session={selectedSession}
        patients={patients}
        onClose={() => setSelectedSession(null)}
        onMarkCompleted={async (session) => {
          const ok = await onMarkSessionCompleted(session);
          if (ok) setSelectedSession(prev => (prev ? { ...prev, status:"completed" } : prev));
        }}
        onCancelSession={async (session) => {
          const ok = await onCancelSession(session);
          if (ok) setSelectedSession(prev => (prev ? { ...prev, status:"cancelled" } : prev));
        }}
        mutating={mutating}
      />
    </div>
  );
}
