import { useState, useEffect } from "react";
import { clientColors, DAY_ORDER } from "../data/seedData";
import { formatShortDate } from "../data/api";

const ACTIONS = [
  { key:"patient", icon:"👤", label:"Nuevo paciente",   color:"var(--teal)" },
  { key:"payment", icon:"💰", label:"Registrar pago",   color:"var(--green)" },
  { key:"session", icon:"📅", label:"Agendar sesión",   color:"var(--purple)" },
  { key:"status",  icon:"✏️",  label:"Actualizar cita",  color:"var(--amber)" },
];

/* ── NEW PATIENT FORM ── */
function NewPatientSheet({ onClose, onSubmit, mutating }) {
  const [name, setName]     = useState("");
  const [parent, setParent] = useState("");
  const [rate, setRate]     = useState("700");
  const [day, setDay]       = useState("Lunes");
  const [time, setTime]     = useState("16:00");
  const [err, setErr]       = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setErr("Ingresa el nombre del paciente."); return; }
    setErr("");
    const ok = await onSubmit({ name, parent, rate: Number(rate), day, time });
    if (ok) onClose();
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">Nuevo paciente</span>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit} style={{ padding:"0 20px 22px" }}>
          <div className="input-group">
            <label className="input-label">Nombre completo</label>
            <input className="input" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="María López" autoFocus />
          </div>
          <div className="input-group">
            <label className="input-label">Tutor / contacto</label>
            <input className="input" type="text" value={parent} onChange={e => setParent(e.target.value)} placeholder="Nombre del tutor" />
          </div>
          <div className="input-group">
            <label className="input-label">Tarifa por sesión</label>
            <input className="input" type="number" min="0" step="50" value={rate} onChange={e => setRate(e.target.value)} placeholder="700" />
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div className="input-group">
              <label className="input-label">Día de sesión</label>
              <select className="input" value={day} onChange={e => setDay(e.target.value)}>
                {DAY_ORDER.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">Hora</label>
              <input className="input" type="time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
          </div>
          {err && <div style={{ fontSize:12, color:"var(--red)", marginBottom:10 }}>{err}</div>}
          <button className="btn btn-primary" type="submit" disabled={mutating}>
            {mutating ? "Guardando..." : "Agregar paciente"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ── NEW SESSION FORM ── */
function NewSessionSheet({ onClose, onSubmit, patients, mutating }) {
  const [patientName, setPatientName] = useState("");
  const [date, setDate] = useState(formatShortDate());
  const [time, setTime] = useState("16:00");
  const [err, setErr]   = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!patientName) { setErr("Selecciona un paciente."); return; }
    if (!date.trim())  { setErr("Ingresa una fecha."); return; }
    if (!time.trim())  { setErr("Ingresa una hora."); return; }
    setErr("");
    const ok = await onSubmit({ patientName, date, time });
    if (ok) onClose();
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">Agendar sesión</span>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit} style={{ padding:"0 20px 22px" }}>
          <div className="input-group">
            <label className="input-label">Paciente</label>
            <select className="input" value={patientName} onChange={e => setPatientName(e.target.value)}>
              <option value="">Seleccionar paciente</option>
              {patients.filter(p => p.status === "active").map(p => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div className="input-group">
              <label className="input-label">Fecha</label>
              <input className="input" type="text" value={date} onChange={e => setDate(e.target.value)} placeholder="7 Abr" />
            </div>
            <div className="input-group">
              <label className="input-label">Hora</label>
              <input className="input" type="time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
          </div>
          {err && <div style={{ fontSize:12, color:"var(--red)", marginBottom:10 }}>{err}</div>}
          <button className="btn btn-primary" type="submit" disabled={mutating}>
            {mutating ? "Guardando..." : "Agendar sesión"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ── UPDATE STATUS SHEET ── */
function UpdateStatusSheet({ onClose, upcomingSessions, onUpdateStatus, mutating }) {
  const scheduled = upcomingSessions.filter(s => s.status === "scheduled");

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">Actualizar cita</span>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding:"0 20px 22px" }}>
          {scheduled.length === 0
            ? <div style={{ textAlign:"center", padding:"24px 0", color:"var(--charcoal-xl)", fontSize:13 }}>No hay citas pendientes</div>
            : scheduled.map(s => (
              <div key={s.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 0", borderBottom:"1px solid var(--border-lt)" }}>
                <div className="row-avatar" style={{ background: clientColors[s.colorIdx % clientColors.length], width:36, height:36, fontSize:11, flexShrink:0 }}>{s.initials}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:600, color:"var(--charcoal)" }}>{s.patient}</div>
                  <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginTop:1 }}>{s.day} {s.date} · {s.time}</div>
                </div>
                <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                  <button
                    style={{ padding:"5px 10px", fontSize:11, fontWeight:700, borderRadius:"var(--radius-pill)", border:"none", background:"var(--green-bg)", color:"var(--green)", cursor:"pointer", fontFamily:"var(--font)" }}
                    onClick={() => onUpdateStatus(s.id, "completed")}
                    disabled={mutating}
                  >✓</button>
                  <button
                    style={{ padding:"5px 10px", fontSize:11, fontWeight:700, borderRadius:"var(--radius-pill)", border:"none", background:"var(--red-bg)", color:"var(--red)", cursor:"pointer", fontFamily:"var(--font)" }}
                    onClick={() => onUpdateStatus(s.id, "cancelled")}
                    disabled={mutating}
                  >✕</button>
                </div>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}

/* ── QUICK ACTIONS (FAB + MENU + SHEETS) ── */
export function QuickActions({
  patients,
  upcomingSessions,
  onOpenPaymentModal,
  createPatient,
  createSession,
  updateSessionStatus,
  mutating,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSheet, setActiveSheet] = useState(null);

  const handleAction = (key) => {
    setMenuOpen(false);
    if (key === "payment") {
      onOpenPaymentModal();
    } else {
      setActiveSheet(key);
    }
  };

  const closeSheet = () => setActiveSheet(null);

  return (
    <>
      {menuOpen && <div className="fab-overlay" onClick={() => setMenuOpen(false)} />}
      {menuOpen && (
        <div className="fab-menu">
          {ACTIONS.map((a, i) => (
            <button key={a.key} className="fab-action" style={{ animationDelay:`${i * 0.04}s` }} onClick={() => handleAction(a.key)}>
              <span className="fab-action-label">{a.label}</span>
              <span className="fab-action-icon" style={{ background: a.color }}>{a.icon}</span>
            </button>
          ))}
        </div>
      )}
      <button
        className={`fab ${menuOpen ? "fab-open" : ""}`}
        onClick={() => setMenuOpen(o => !o)}
        aria-label={menuOpen ? "Cerrar" : "Agregar"}
      >+</button>

      {activeSheet === "patient" && (
        <NewPatientSheet onClose={closeSheet} onSubmit={createPatient} mutating={mutating} />
      )}
      {activeSheet === "session" && (
        <NewSessionSheet onClose={closeSheet} onSubmit={createSession} patients={patients} mutating={mutating} />
      )}
      {activeSheet === "status" && (
        <UpdateStatusSheet onClose={closeSheet} upcomingSessions={upcomingSessions} onUpdateStatus={updateSessionStatus} mutating={mutating} />
      )}
    </>
  );
}
