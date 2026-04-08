import { useState } from "react";
import { clientColors, TODAY, DAY_ORDER } from "../data/seedData";

export function Home({ setScreen, patients, upcomingSessions, payments, onRecordPayment, mutating }) {
  const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const FULL_MONTHS  = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const todayStr     = `${TODAY.getDate()} ${SHORT_MONTHS[TODAY.getMonth()]}`;
  const todayDayName = DAY_ORDER[(TODAY.getDay() + 6) % 7];
  const todayMonthName = FULL_MONTHS[TODAY.getMonth()];

  const totalBilled   = patients.reduce((s,p) => s+p.billed, 0);
  const totalPaid     = patients.reduce((s,p) => s+p.paid, 0);
  const totalOwed     = totalBilled - totalPaid;
  const activeCount   = patients.filter(p=>p.status==="active").length;
  const todaySessions = upcomingSessions.filter(s => s.date === todayStr);

  const currentMonthPayments = payments.filter(p => {
    const parts = p.date.split(" ");
    return parts[1] === SHORT_MONTHS[TODAY.getMonth()];
  });
  const cobradoMes = currentMonthPayments.reduce((s,p) => s+p.amount, 0);

  const [selected, setSelected] = useState(null);

  const openPatient = (name) => {
    const p = patients.find(p => p.name === name);
    if (p) setSelected(p);
  };

  return (
    <div className="page">
      <div style={{ padding:"16px 16px 4px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        <div className="kpi-card" onClick={() => setScreen("agenda")} style={{ cursor:"pointer" }}>
          <div className="kpi-label">Sesiones Hoy</div>
          <div className="kpi-value">{todaySessions.length}</div>
          <div className="kpi-meta">{todayDayName} {todayStr}</div>
        </div>
        <div className="kpi-card" onClick={() => setScreen("patients")} style={{ cursor:"pointer" }}>
          <div className="kpi-label">Pacientes</div>
          <div className="kpi-value">{activeCount}</div>
          <div className="kpi-meta">activos</div>
        </div>
        <div className="kpi-card" onClick={() => setScreen("finances")} style={{ cursor:"pointer" }}>
          <div className="kpi-label">Cobrado (Mes)</div>
          <div className="kpi-value">${cobradoMes.toLocaleString()}</div>
          <div className="kpi-meta">{todayMonthName} {TODAY.getFullYear()}</div>
        </div>
        <div className="kpi-card" onClick={() => setScreen("finances")} style={{ cursor:"pointer" }}>
          <div className="kpi-label">Por Cobrar</div>
          <div className="kpi-value" style={{ color:"var(--red)" }}>${totalOwed.toLocaleString()}</div>
          <div className="kpi-meta">{patients.filter(p=>p.billed>p.paid).length} pacientes</div>
        </div>
      </div>

      <div className="section">
        <div className="section-header">
          <span className="section-title">Hoy — {todayDayName} {todayStr}</span>
          <button className="see-all" onClick={() => setScreen("agenda")}>Ver semana</button>
        </div>
        <div className="card">
          {todaySessions.length === 0
            ? <div style={{ padding:"24px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>Sin sesiones hoy 🎉</div>
            : todaySessions.map(s => (
              <div className="row-item" key={s.id} onClick={() => openPatient(s.patient)}>
                <div className="row-avatar" style={{ background: clientColors[s.colorIdx] }}>{s.initials}</div>
                <div className="row-content">
                  <div className="row-title">{s.patient}</div>
                  <div className="row-sub">{s.time} · {s.day}</div>
                </div>
                <div className="row-right">
                  <span className={`session-status ${s.status==="cancelled"?"status-cancelled":"status-scheduled"}`}>
                    {s.status==="cancelled" ? "Cancelada" : "Agendada"}
                  </span>
                </div>
              </div>
            ))
          }
        </div>
      </div>

      <div className="section" style={{ paddingTop:20 }}>
        <div className="section-header">
          <span className="section-title">Saldos Pendientes</span>
          <button className="see-all" onClick={() => setScreen("finances")}>Ver todos</button>
        </div>
        <div className="card">
          {patients.filter(p => p.billed > p.paid).slice(0,4).map((p,i) => {
            const owed = p.billed - p.paid;
            const pct  = p.billed > 0 ? (p.paid / p.billed) * 100 : 0;
            return (
              <div className="row-item" key={p.id} onClick={() => setSelected(p)}>
                <div className="row-avatar" style={{ background: clientColors[i % clientColors.length] }}>{p.initials}</div>
                <div className="row-content">
                  <div className="row-title">{p.name}</div>
                  <div className="balance-bar"><div className="balance-fill" style={{ width:`${pct}%` }} /></div>
                  <div className="row-sub" style={{ marginTop:3 }}>${p.paid.toLocaleString()} pagado de ${p.billed.toLocaleString()}</div>
                </div>
                <div className="row-right">
                  <div className="row-amount amount-owe">-${owed.toLocaleString()}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="section" style={{ paddingTop:20, paddingBottom:12 }}>
        <div className="section-header">
          <span className="section-title">Últimos Pagos</span>
          <button className="see-all">Ver todos</button>
        </div>
        <div className="card">
          {payments.slice(0,3).map(p => (
            <div className="row-item" key={p.id} onClick={() => openPatient(p.patient)}>
              <div className="row-icon" style={{ background:"var(--green-bg)" }}>💰</div>
              <div className="row-content">
                <div className="row-title">{p.patient}</div>
                <div className="row-sub">{p.date} · {p.method}</div>
              </div>
              <div className="row-right">
                <div className="row-amount amount-paid">+${p.amount.toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <div className="sheet-overlay" onClick={() => setSelected(null)}>
          <div className="sheet-panel" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{selected.name}</span>
              <button className="sheet-close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div style={{ padding:"0 20px 24px" }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:20 }}>
                {[
                  { label:"Vendido", value:`$${selected.billed.toLocaleString()}` },
                  { label:"Cobrado", value:`$${selected.paid.toLocaleString()}`, color:"var(--green)" },
                  { label:"Saldo",   value:`$${(selected.billed-selected.paid).toLocaleString()}`, color: selected.billed>selected.paid?"var(--red)":"var(--charcoal-xl)" },
                ].map((s,i) => (
                  <div key={i} style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 10px", textAlign:"center" }}>
                    <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:4 }}>{s.label}</div>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:800, color:s.color||"var(--charcoal)" }}>{s.value}</div>
                  </div>
                ))}
              </div>
              {[
                { label:"Tutor",            value: selected.parent },
                { label:"Sesión regular",   value:`${selected.day} a las ${selected.time}` },
                { label:"Tarifa",           value:`$${selected.rate} por sesión` },
                { label:"Sesiones totales", value:`${selected.sessions} sesiones` },
                { label:"Estado",           value: selected.status==="active"?"Activo":"Finalizado" },
              ].map((row,i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 0", borderBottom:"1px solid var(--border-lt)" }}>
                  <span style={{ fontSize:13, color:"var(--charcoal-xl)" }}>{row.label}</span>
                  <span style={{ fontSize:13, fontWeight:600, color:"var(--charcoal)" }}>{row.value}</span>
                </div>
              ))}
              <div style={{ marginTop:20, display:"flex", flexDirection:"column", gap:10 }}>
                <button className="btn btn-primary" style={{ height:48 }} onClick={() => onRecordPayment(selected)} disabled={mutating}>
                  {mutating ? "Guardando..." : "💰 Registrar pago"}
                </button>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <button className="btn btn-secondary" style={{ height:44, fontSize:13 }}>Ver sesiones</button>
                  <button className="btn btn-secondary" style={{ height:44, fontSize:13 }}>Editar</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
