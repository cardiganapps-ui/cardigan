import { clientColors } from "../data/seedData";
import { IconX, IconCheck } from "./Icons";

export function SessionSheet({ session, patients, onClose, onMarkCompleted, onCancelSession, mutating }) {
  if (!session) return null;
  const patientData = patients?.find(p => p.name === session.patient);
  const rate = patientData ? `$${patientData.rate.toLocaleString()}` : "—";
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
            <div className="row-avatar" style={{ background: clientColors[session.colorIdx], width:52, height:52, fontSize:16 }}>{session.initials}</div>
            <div>
              <div style={{ fontFamily:"var(--font-d)", fontSize:17, fontWeight:800, color:"var(--charcoal)" }}>{session.patient}</div>
              <div style={{ fontSize:13, color:"var(--charcoal-xl)", marginTop:2 }}>{session.day} {session.date} · {session.time}</div>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
            {[
              { label:"Estado",    value: session.status==="cancelled" ? "Cancelada" : "Agendada", highlight: session.status!=="cancelled" },
              { label:"Tarifa",    value:rate },
              { label:"¿Se cobra?",value:"Sí" },
              { label:"Tipo",      value:"Individual" },
            ].map((item,i) => (
              <div key={i} style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 14px" }}>
                <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:4 }}>{item.label}</div>
                <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:700, color: item.highlight ? "var(--teal-dark)" : "var(--charcoal)" }}>{item.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <button
              className="btn btn-primary"
              style={{ height:48 }}
              onClick={() => onMarkCompleted(session)}
              disabled={mutating || session.status === "completed"}
            >
              {session.status === "completed" ? "Ya completada" : (mutating ? "Guardando..." : "Marcar como completada")}
            </button>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <button className="btn btn-secondary" style={{ height:44, fontSize:13 }}>Reagendar</button>
              <button
                className="btn"
                style={{ height:44, fontSize:13, background:"var(--red-bg)", color:"var(--red)", boxShadow:"none" }}
                onClick={() => onCancelSession(session)}
                disabled={mutating || session.status === "cancelled"}
              >
                {session.status === "cancelled" ? "Cancelada" : "Cancelar"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
