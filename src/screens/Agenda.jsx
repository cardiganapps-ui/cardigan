import { useState, useMemo } from "react";
import { clientColors, calDays, MONTH_NAMES, DOW, HOURS } from "../data/seedData";
import { SessionSheet } from "../components/SessionSheet";

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

function DayView({ selectedDay, setSelectedDay, onSelectSession, upcomingSessions }) {
  const daySessions = upcomingSessions.filter(s => s.date === selectedDay);
  const dayNums = calDays.map(d => parseInt(d.num));
  const curNum  = parseInt(selectedDay);
  const curIdx  = dayNums.indexOf(curNum);
  const goDay   = (delta) => { const next = dayNums[curIdx + delta]; if (next !== undefined) setSelectedDay(`${next} Abr`); };
  const dayLabel = calDays.find(d => `${d.num} Abr` === selectedDay);

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px 12px" }}>
        <button className="month-nav-btn" onClick={() => goDay(-1)} disabled={curIdx<=0} style={{ opacity: curIdx<=0?0.3:1 }}>‹</button>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:800, color:"var(--charcoal)" }}>{dayLabel ? dayLabel.name : ""} {selectedDay}</div>
          <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginTop:2 }}>{daySessions.length===0 ? "Sin sesiones" : `${daySessions.length} sesión${daySessions.length>1?"es":""}`}</div>
        </div>
        <button className="month-nav-btn" onClick={() => goDay(1)} disabled={curIdx>=dayNums.length-1} style={{ opacity: curIdx>=dayNums.length-1?0.3:1 }}>›</button>
      </div>
      <div style={{ paddingBottom:8 }}>
        <div className="cal-strip">
          {calDays.map((d,i) => {
            const dateStr = `${d.num} Abr`;
            return (
              <div key={i} className={`cal-day ${selectedDay===dateStr?"active":""} ${d.hasS?"has-sessions":""}`} onClick={() => setSelectedDay(dateStr)}>
                <span className="cal-day-name">{d.name}</span>
                <span className="cal-day-num">{d.num}</span>
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

function WeekView({ selectedDay, onSelectDay, setView, onSelectSession, upcomingSessions }) {
  const weekDays = calDays.map(d => ({ ...d, dateStr:`${d.num} Abr` }));
  const hourIndex = (t) => parseInt(t.split(":")[0]) - 8;

  return (
    <div>
      <div className="week-header-row">
        <div />
        {weekDays.map((d,i) => (
          <div key={i} className="week-day-head" style={{ cursor:"pointer" }} onClick={() => { onSelectDay(d.dateStr); setView("day"); }}>
            <span className="week-day-name">{d.name}</span>
            <span className={`week-day-num ${d.dateStr===selectedDay?"active":""} ${d.num==="7"&&d.dateStr!==selectedDay?"today":""}`}>{d.num}</span>
          </div>
        ))}
      </div>
      <div className="week-body">
        {HOURS.map((hour, hIdx) => (
          <div className="week-time-row" key={hour}>
            <div className="week-time-label">{hour}</div>
            {weekDays.map((d, dIdx) => {
              const sess = upcomingSessions.filter(s => s.date===d.dateStr).find(s => hourIndex(s.time)===hIdx);
              return (
                <div key={dIdx} className="week-cell" onClick={() => !sess && onSelectDay(d.dateStr)}>
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

function MonthView({ onSelectSession, selectedDay, onSelectDay, upcomingSessions }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const base = new Date(2026, 3);
  base.setMonth(base.getMonth() + monthOffset);
  const displayMonth = base.getMonth();
  const displayYear  = base.getFullYear();
  const cells   = buildMonthGrid(displayYear, displayMonth);
  const isApril = displayMonth === 3 && displayYear === 2026;
  const daySessions = isApril ? upcomingSessions.filter(s => s.date === selectedDay) : [];
  const sessionDays = useMemo(() => new Set(upcomingSessions.map(s => parseInt(s.date))), [upcomingSessions]);
  const selectedNum  = parseInt(selectedDay);

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
            const isToday  = isApril && cell.current && cell.num === 7;
            const isActive = isApril && cell.current && cell.num === selectedNum;
            const hasSess  = isApril && cell.current && sessionDays.has(cell.num);
            return (
              <div key={i} className={`month-cell ${isActive?"active":""} ${isToday&&!isActive?"today":""} ${!cell.current?"other-month":""}`}
                onClick={() => cell.current && isApril && onSelectDay(`${cell.num} Abr`)}>
                <span className="month-cell-num">{cell.num}</span>
                {hasSess && <div className="month-dot" />}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ padding:"16px 16px 0" }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:10 }}>
          <div className="section-title">{selectedDay}</div>
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

export function Agenda({ upcomingSessions, onMarkSessionCompleted, onCancelSession, mutating }) {
  const [view, setView]               = useState("day");
  const [selectedDay, setSelectedDay] = useState("7 Abr");
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
      {view==="day"   && <DayView   selectedDay={selectedDay} setSelectedDay={setSelectedDay} onSelectSession={setSelectedSession} upcomingSessions={upcomingSessions} />}
      {view==="week"  && <WeekView  selectedDay={selectedDay} onSelectDay={setSelectedDay} setView={setView} onSelectSession={setSelectedSession} upcomingSessions={upcomingSessions} />}
      {view==="month" && <MonthView selectedDay={selectedDay} onSelectDay={setSelectedDay} onSelectSession={setSelectedSession} upcomingSessions={upcomingSessions} />}
      <SessionSheet
        session={selectedSession}
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
