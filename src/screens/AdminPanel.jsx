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
          Cuentas registradas en Cardigan
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:16 }}>
        {loading ? (
          <div style={{ textAlign:"center", padding:40, color:"var(--charcoal-xl)", fontSize:13 }}>Cargando cuentas...</div>
        ) : accounts.length === 0 ? (
          <div style={{ textAlign:"center", padding:40, color:"var(--charcoal-xl)", fontSize:13 }}>Sin cuentas registradas</div>
        ) : (
          <>
            <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:"var(--charcoal-xl)", marginBottom:10 }}>
              {accounts.length} cuenta{accounts.length !== 1 ? "s" : ""} de usuario
            </div>
            {accounts.map(a => (
              <div key={a.userId} className="card" style={{ marginBottom:12, padding:0 }}>
                <div style={{ padding:"14px 16px 10px", borderBottom:"1px solid var(--border-lt)" }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:800, color:"var(--charcoal)" }}>
                      Cuenta de usuario
                    </div>
                    <button onClick={() => onViewAs(a.userId)}
                      style={{ fontSize:12, fontWeight:700, color:"white", background:"var(--teal)", border:"none", borderRadius:"var(--radius-pill)", padding:"6px 14px", cursor:"pointer", fontFamily:"var(--font)" }}>
                      Ver como usuario
                    </button>
                  </div>
                  <div style={{ fontSize:11, color:"var(--charcoal-xl)", fontFamily:"monospace" }}>
                    ID: {a.userId.slice(0, 8)}...
                  </div>
                  <div style={{ fontSize:11, color:"var(--charcoal-xl)", marginTop:2 }}>
                    Registrado: {new Date(a.firstSeen).toLocaleDateString("es-MX", { day:"numeric", month:"long", year:"numeric" })}
                  </div>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", textAlign:"center", padding:"10px 0" }}>
                  <div>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:800, color:"var(--charcoal)" }}>{a.patients.length}</div>
                    <div style={{ fontSize:10, color:"var(--charcoal-xl)" }}>Pacientes</div>
                  </div>
                  <div>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:800, color:"var(--charcoal)" }}>{a.sessions}</div>
                    <div style={{ fontSize:10, color:"var(--charcoal-xl)" }}>Sesiones</div>
                  </div>
                  <div>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:800, color:"var(--green)" }}>${a.totalPaid.toLocaleString()}</div>
                    <div style={{ fontSize:10, color:"var(--charcoal-xl)" }}>Cobrado</div>
                  </div>
                </div>
                <div style={{ padding:"0 16px 12px" }}>
                  <div style={{ fontSize:11, color:"var(--charcoal-md)" }}>
                    Pacientes: {a.patients.join(", ")}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
