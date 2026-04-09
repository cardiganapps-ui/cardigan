import { useState, useEffect } from "react";
import { fetchAllAccounts } from "../hooks/useCardiganData";
import { IconX } from "../components/Icons";

export function AdminPanel({ onViewAs, onClose }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAllAccounts().then(a => { setAccounts(a); setLoading(false); });
  }, []);

  return (
    <div style={{ position:"fixed", inset:0, background:"var(--white)", zIndex:500, display:"flex", flexDirection:"column" }}>
      <div style={{ background:"#1a1a2e", padding:"calc(var(--sat, 0px) + 14px) 16px 16px", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ fontFamily:"var(--font-d)", fontSize:18, fontWeight:800, color:"white" }}>Panel de Admin</div>
          <button onClick={onClose}
            style={{ background:"none", border:"none", color:"rgba(255,255,255,0.6)", cursor:"pointer" }}>
            <IconX size={18} />
          </button>
        </div>
        <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", marginTop:4 }}>
          {accounts.length} cuenta{accounts.length !== 1 ? "s" : ""} registrada{accounts.length !== 1 ? "s" : ""}
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:16 }}>
        {loading ? (
          <div style={{ textAlign:"center", padding:40, color:"var(--charcoal-xl)", fontSize:13 }}>Cargando cuentas...</div>
        ) : accounts.length === 0 ? (
          <div style={{ textAlign:"center", padding:40, color:"var(--charcoal-xl)", fontSize:13 }}>Sin cuentas registradas</div>
        ) : (
          <div className="card">
            {accounts.map(a => (
              <div key={a.userId} className="row-item" style={{ cursor:"pointer" }} onClick={() => onViewAs(a.userId)}>
                <div className="row-avatar" style={{ background:"var(--teal)", width:40, height:40, fontSize:14 }}>
                  {(a.fullName || a.email || "?").charAt(0).toUpperCase()}
                </div>
                <div className="row-content">
                  <div className="row-title">{a.fullName || "Sin nombre"}</div>
                  <div className="row-sub">{a.email || `ID: ${a.userId.slice(0, 8)}...`} · {a.patientCount} paciente{a.patientCount !== 1 ? "s" : ""}</div>
                </div>
                <span style={{ fontSize:11, fontWeight:600, color:"var(--teal-dark)", padding:"4px 10px", background:"var(--teal-pale)", borderRadius:"var(--radius-pill)", flexShrink:0 }}>
                  Ver
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
