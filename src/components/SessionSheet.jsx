import { useState } from "react";
import { clientColors } from "../data/seedData";
import { IconX } from "./Icons";

export function SessionSheet({ session, patients, onClose, onMarkCompleted, onCancelSession, onDelete, mutating }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!session) return null;
  const patientData = patients?.find(p => p.name === session.patient);
  const rate = patientData ? `$${patientData.rate.toLocaleString()}` : "—";
  const statusLabel = session.status === "cancelled" ? "Cancelada" : session.status === "completed" ? "Completada" : "Agendada";

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
            <div className="row-avatar" style={{ background: clientColors[(session.colorIdx || 0) % clientColors.length], width:52, height:52, fontSize:16 }}>{session.initials}</div>
            <div>
              <div style={{ fontFamily:"var(--font-d)", fontSize:17, fontWeight:800, color:"var(--charcoal)" }}>{session.patient}</div>
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
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {session.status === "scheduled" && (
                <button className="btn btn-primary" style={{ height:48 }} onClick={() => onMarkCompleted(session)} disabled={mutating}>
                  {mutating ? "Guardando..." : "Marcar como completada"}
                </button>
              )}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                {session.status === "scheduled" && (
                  <button className="btn" style={{ height:44, fontSize:13, background:"var(--amber-bg)", color:"var(--amber)", boxShadow:"none" }}
                    onClick={() => onCancelSession(session)} disabled={mutating}>
                    Cancelar cita
                  </button>
                )}
                <button className="btn" style={{ height:44, fontSize:13, background:"var(--red-bg)", color:"var(--red)", boxShadow:"none", gridColumn: session.status !== "scheduled" ? "1 / -1" : undefined }}
                  onClick={() => setConfirmDelete(true)}>
                  Eliminar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
