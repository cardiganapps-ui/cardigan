import { useState } from "react";
import { todayISO, isoToShortDate } from "../../utils/dates";
import { IconX } from "../Icons";

export function NewSessionSheet({ onClose, onSubmit, patients, mutating }) {
  const [patientName, setPatientName] = useState("");
  const [sessionType, setSessionType] = useState("patient");
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState("16:00");
  const [customRate, setCustomRate] = useState("");
  const [err, setErr]   = useState("");

  const selectedPatient = patients.find(p => p.name === patientName);
  const isMinor = selectedPatient && !!selectedPatient.parent;
  const isTutor = sessionType === "tutor";

  const handlePatientChange = (name) => {
    setPatientName(name);
    const p = patients.find(pt => pt.name === name);
    setSessionType("patient");
    setCustomRate(p ? String(p.rate) : "");
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!patientName) { setErr("Selecciona un paciente."); return; }
    if (!date) { setErr("Ingresa una fecha."); return; }
    if (!time.trim()) { setErr("Ingresa una hora."); return; }
    setErr("");
    const params = { patientName, date: isoToShortDate(date), time };
    if (isTutor) {
      params.isTutor = true;
      params.tutorName = selectedPatient.parent;
      params.customRate = Number(customRate) || selectedPatient.rate;
    }
    const ok = await onSubmit(params);
    if (ok) onClose();
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ maxHeight:"92vh", overflowY:"auto" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">Agendar sesión</span>
          <button className="sheet-close" onClick={onClose}><IconX size={14} /></button>
        </div>
        <form onSubmit={submit} style={{ padding:"0 20px 22px" }}>
          <div className="input-group">
            <label className="input-label">Paciente</label>
            <select className="input" value={patientName} onChange={e => handlePatientChange(e.target.value)}>
              <option value="">Seleccionar paciente</option>
              {patients.filter(p => p.status === "active").map(p => (
                <option key={p.id} value={p.name}>{p.name}{p.parent ? " (menor)" : ""}</option>
              ))}
            </select>
          </div>
          {isMinor && (
            <div className="input-group">
              <label className="input-label">Tipo de sesión</label>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                <button type="button" onClick={() => setSessionType("patient")}
                  style={{ padding:"10px", fontSize:12, fontWeight:700, borderRadius:"var(--radius)", border: sessionType==="patient" ? "2px solid var(--teal)" : "1.5px solid var(--border)", background: sessionType==="patient" ? "var(--teal-pale)" : "var(--white)", color: sessionType==="patient" ? "var(--teal-dark)" : "var(--charcoal-lt)", cursor:"pointer", fontFamily:"var(--font)", textAlign:"center" }}>
                  Paciente
                </button>
                <button type="button" onClick={() => { setSessionType("tutor"); setCustomRate(String(selectedPatient.rate)); }}
                  style={{ padding:"10px", fontSize:12, fontWeight:700, borderRadius:"var(--radius)", border: sessionType==="tutor" ? "2px solid var(--purple)" : "1.5px solid var(--border)", background: sessionType==="tutor" ? "var(--purple-bg)" : "var(--white)", color: sessionType==="tutor" ? "var(--purple)" : "var(--charcoal-lt)", cursor:"pointer", fontFamily:"var(--font)", textAlign:"center" }}>
                  Tutor: {selectedPatient.parent}
                </button>
              </div>
            </div>
          )}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div className="input-group">
              <label className="input-label">Fecha</label>
              <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="input-group">
              <label className="input-label">Hora</label>
              <input className="input" type="time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
          </div>
          {isTutor && (
            <div className="input-group">
              <label className="input-label">Tarifa de esta sesión</label>
              <input className="input" type="number" min="0" step="50" value={customRate} onChange={e => setCustomRate(e.target.value)} placeholder="Ej: 700" />
            </div>
          )}
          {err && <div style={{ fontSize:12, color:"var(--red)", marginBottom:10 }}>{err}</div>}
          <button className={`btn ${isTutor ? "" : "btn-primary"}`} type="submit" disabled={mutating}
            style={isTutor ? { background:"var(--purple)", color:"white", boxShadow:"none", width:"100%" } : undefined}>
            {mutating ? "Agendando..." : isTutor ? `Agendar con tutor · $${(Number(customRate) || selectedPatient?.rate || 0).toLocaleString()}` : "Agendar sesión"}
          </button>
        </form>
      </div>
    </div>
  );
}
