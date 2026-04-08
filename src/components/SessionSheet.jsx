import { useState } from "react";
import { clientColors } from "../data/seedData";
import { shortDateToISO, isoToShortDate } from "../data/api";
import { IconX } from "./Icons";

export function SessionSheet({ session, patients, onClose, onCancelSession, onDelete, onReschedule, mutating }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [rescheduleErr, setRescheduleErr] = useState("");
  if (!session) return null;
  const patientData = patients?.find(p => p.name === session.patient);
  const rate = patientData ? `$${patientData.rate.toLocaleString()}` : "—";
  const isCancelled = session.status === "cancelled" || session.status === "charged";
  const statusLabel = isCancelled ? (session.status === "charged" ? "Cancelada (cobrada)" : "Cancelada") : session.status === "completed" ? "Completada" : "Agendada";
  const isTutor = session.initials?.startsWith("T·");
  const displayInitials = isTutor ? session.initials.replace("T·", "") : session.initials;

  const startReschedule = () => {
    setNewDate(shortDateToISO(session.date));
    setNewTime(session.time);
    setRescheduleErr("");
    setRescheduling(true);
  };

  const submitReschedule = async () => {
    if (!newDate) { setRescheduleErr("Selecciona una fecha."); return; }
    if (!newTime.trim()) { setRescheduleErr("Selecciona una hora."); return; }
    setRescheduleErr("");
    const ok = await onReschedule(session.id, isoToShortDate(newDate), newTime);
    if (ok) setRescheduling(false);
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">Sesión</span>
          <button className="sheet-close" onClick={onClose}><IconX size={14} /></button>
        </div>
        <div style={{ padding:"0 20px 20px" }}>
          <div className="flex items-center gap-3" style={{ marginBottom:20 }}>
            <div className="row-avatar" style={{ background: isTutor ? "var(--purple)" : clientColors[(session.colorIdx || 0) % clientColors.length], width:52, height:52, fontSize:16, border: isTutor ? "2px dashed var(--purple-bg)" : undefined }}>{displayInitials}</div>
            <div>
              <div style={{ fontFamily:"var(--font-d)", fontSize:17, fontWeight:800, color:"var(--charcoal)" }}>
                {session.patient}
                {isTutor && <span style={{ fontSize:11, fontWeight:700, color:"var(--purple)", marginLeft:6 }}>TUTOR</span>}
              </div>
              <div style={{ fontSize:13, color:"var(--charcoal-xl)", marginTop:2 }}>{session.day} {session.date} · {session.time}</div>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
            {[
              { label:"Estado", value: statusLabel, highlight: session.status==="scheduled" },
              { label:"Tarifa", value: rate },
            ].map((item,i) => (
              <div key={i} style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 14px" }}>
                <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:4 }}>{item.label}</div>
                <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:700, color: item.highlight ? "var(--teal-dark)" : "var(--charcoal)" }}>{item.value}</div>
              </div>
            ))}
          </div>

          {confirmDelete ? (
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:14, fontWeight:600, color:"var(--charcoal)", marginBottom:14 }}>¿Eliminar esta sesión?</div>
              <button className="btn btn-danger" style={{ marginBottom:10 }} onClick={async () => { await onDelete(session.id); onClose(); }} disabled={mutating}>
                {mutating ? "Eliminando..." : "Sí, eliminar"}
              </button>
              <button className="btn btn-secondary w-full" onClick={() => setConfirmDelete(false)}>Cancelar</button>
            </div>
          ) : rescheduling ? (
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:"var(--charcoal)", marginBottom:12 }}>Reagendar sesión</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div className="input-group">
                  <label className="input-label">Fecha</label>
                  <input className="input" type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
                </div>
                <div className="input-group">
                  <label className="input-label">Hora</label>
                  <input className="input" type="time" value={newTime} onChange={e => setNewTime(e.target.value)} />
                </div>
              </div>
              {rescheduleErr && <div style={{ fontSize:12, color:"var(--red)", marginBottom:10 }}>{rescheduleErr}</div>}
              <button className="btn btn-primary" style={{ marginBottom:10 }} onClick={submitReschedule} disabled={mutating}>
                {mutating ? "Guardando..." : "Confirmar"}
              </button>
              <button className="btn btn-secondary w-full" onClick={() => setRescheduling(false)}>Cancelar</button>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {session.status === "scheduled" && (
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <button className="btn" style={{ height:44, fontSize:12, background:"var(--amber-bg)", color:"var(--amber)", boxShadow:"none" }}
                    onClick={() => onCancelSession(session, true)} disabled={mutating}>
                    Cancelar y cobrar
                  </button>
                  <button className="btn" style={{ height:44, fontSize:12, background:"var(--cream)", color:"var(--charcoal-lt)", boxShadow:"none" }}
                    onClick={() => onCancelSession(session, false)} disabled={mutating}>
                    Cancelar sin cobrar
                  </button>
                </div>
              )}
              <button className="btn btn-primary" style={{ height:44 }} onClick={startReschedule}>
                Reagendar
              </button>
              <button className="btn" style={{ height:44, fontSize:13, background:"var(--red-bg)", color:"var(--red)", boxShadow:"none" }}
                onClick={() => setConfirmDelete(true)}>
                Eliminar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
