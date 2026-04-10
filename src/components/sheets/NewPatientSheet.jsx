import { useState } from "react";
import { DAY_ORDER } from "../../data/seedData";
import { todayISO } from "../../utils/dates";
import { Toggle } from "../Toggle";
import { IconX } from "../Icons";

export function NewPatientSheet({ onClose, onSubmit, mutating, patients }) {
  const [name, setName]       = useState("");
  const [isMinor, setIsMinor] = useState(false);
  const [parent, setParent]   = useState("");
  const [rate, setRate]       = useState("");
  const [recurring, setRecurring] = useState(true);
  const [schedules, setSchedules] = useState([{ day: "Lunes", time: "16:00" }]);
  const [startDate, setStartDate] = useState(todayISO());
  const [hasEndDate, setHasEndDate] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [err, setErr]         = useState("");

  const updateSched = (i, f, v) => setSchedules(prev => prev.map((s, idx) => idx === i ? { ...s, [f]: v } : s));
  const removeSched = (i) => setSchedules(prev => prev.filter((_, idx) => idx !== i));

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setErr("Ingresa el nombre del paciente."); return; }
    if (patients?.some(p => p.name.toLowerCase() === name.trim().toLowerCase())) {
      setErr("Ya existe un paciente con ese nombre."); return;
    }
    setErr("");
    const ok = await onSubmit({
      name, parent: isMinor ? parent : "", rate: Number(rate) || 0,
      schedules, recurring,
      startDate: recurring ? startDate : null,
      endDate: recurring && hasEndDate ? endDate : null,
    });
    if (ok) onClose();
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{ maxHeight:"92vh", overflowY:"auto" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">Nuevo paciente</span>
          <button className="sheet-close" aria-label="Cerrar" onClick={onClose}><IconX size={14} /></button>
        </div>
        <form onSubmit={submit} style={{ padding:"0 20px 22px" }}>
          <div className="input-group">
            <label className="input-label">Nombre completo</label>
            <input className="input" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="María López" />
          </div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: isMinor ? 6 : 14 }}>
            <span style={{ fontSize:12, fontWeight:600, color:"var(--charcoal-md)" }}>Es menor de edad</span>
            <Toggle on={isMinor} onToggle={() => setIsMinor(v => !v)} />
          </div>
          {isMinor && (
            <div className="input-group">
              <label className="input-label">Tutor / contacto</label>
              <input className="input" type="text" value={parent} onChange={e => setParent(e.target.value)} placeholder="Nombre del tutor" />
            </div>
          )}
          <div className="input-group">
            <label className="input-label">Tarifa por sesión</label>
            <input className="input" type="number" min="0" step="50" value={rate} onChange={e => setRate(e.target.value)} placeholder="Ej: 700" />
          </div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <span style={{ fontSize:13, fontWeight:700, color:"var(--charcoal)" }}>Citas recurrentes</span>
            <Toggle on={recurring} onToggle={() => setRecurring(v => !v)} />
          </div>
          {schedules.map((s, i) => (
            <div key={i} style={{ display:"grid", gridTemplateColumns: schedules.length > 1 ? "1fr 1fr 28px" : "1fr 1fr", gap:8, marginBottom:8, alignItems:"end" }}>
              <div className="input-group" style={{ marginBottom:0 }}>
                {i === 0 && <label className="input-label">Día</label>}
                <select className="input" value={s.day} onChange={e => updateSched(i, "day", e.target.value)}>
                  {DAY_ORDER.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="input-group" style={{ marginBottom:0 }}>
                {i === 0 && <label className="input-label">Hora</label>}
                <input className="input" type="time" value={s.time} onChange={e => updateSched(i, "time", e.target.value)} />
              </div>
              {schedules.length > 1 && (
                <button type="button" onClick={() => removeSched(i)}
                  style={{ width:28, height:28, borderRadius:"50%", border:"none", background:"var(--red-bg)", color:"var(--red)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <IconX size={12} />
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setSchedules(prev => [...prev, { day: "Lunes", time: "16:00" }])}
            style={{ fontSize:12, fontWeight:600, color:"var(--teal-dark)", background:"none", border:"none", cursor:"pointer", padding:"4px 0 12px", fontFamily:"var(--font)" }}>
            + Agregar otro horario
          </button>
          {recurring && (
            <div style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 14px", marginBottom:14 }}>
              <div className="input-group" style={{ marginBottom:10 }}>
                <label className="input-label">Inicio</label>
                <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: hasEndDate ? 8 : 0 }}>
                <span style={{ fontSize:12, fontWeight:600, color:"var(--charcoal-md)" }}>Fecha de fin</span>
                <Toggle on={hasEndDate} onToggle={() => setHasEndDate(v => !v)} />
              </div>
              {hasEndDate ? (
                <div className="input-group" style={{ marginBottom:0 }}>
                  <input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              ) : (
                <div style={{ fontSize:11, color:"var(--charcoal-xl)", marginTop:4 }}>Permanente — se renuevan automáticamente</div>
              )}
            </div>
          )}
          {err && <div style={{ fontSize:12, color:"var(--red)", marginBottom:10 }}>{err}</div>}
          <button className="btn btn-primary" type="submit" disabled={mutating}>
            {mutating ? "Guardando..." : "Agregar paciente"}
          </button>
        </form>
      </div>
    </div>
  );
}
