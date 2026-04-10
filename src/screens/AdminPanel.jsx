import { useState, useEffect } from "react";
import { fetchAllAccounts } from "../hooks/useCardiganData";
import { IconX } from "../components/Icons";
import { useT } from "../i18n/index";

export function AdminPanel({ onViewAs, onClose }) {
  const { t } = useT();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchAllAccounts()
      .then(a => { setAccounts(a); setLoading(false); })
      .catch(e => { setError(e.message || t("admin.loadError")); setLoading(false); });
  }, []);

  return (
    <div style={{ position:"fixed", inset:0, background:"var(--white)", zIndex:"var(--z-expediente)", display:"flex", flexDirection:"column" }}>
      <div style={{ background:"#1a1a2e", padding:"calc(var(--sat, 0px) + 14px) 16px 16px", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ fontFamily:"var(--font-d)", fontSize:18, fontWeight:800, color:"white" }}>{t("admin.title")}</div>
          <button onClick={onClose} aria-label={t("close")}
            style={{ background:"none", border:"none", color:"rgba(255,255,255,0.6)", cursor:"pointer" }}>
            <IconX size={18} />
          </button>
        </div>
        <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", marginTop:4 }}>
          {t("admin.accounts", { count: accounts.length })}
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:16 }}>
        {loading ? (
          <div style={{ textAlign:"center", padding:40, color:"var(--charcoal-xl)", fontSize:13 }}>{t("admin.loadingAccounts")}</div>
        ) : error ? (
          <div style={{ textAlign:"center", padding:40, color:"var(--red)", fontSize:13 }}>{error}</div>
        ) : accounts.length === 0 ? (
          <div style={{ textAlign:"center", padding:40, color:"var(--charcoal-xl)", fontSize:13 }}>{t("admin.noAccounts")}</div>
        ) : (
          <div className="card">
            {accounts.map(a => (
              <div key={a.userId} className="row-item" style={{ cursor:"pointer" }} onClick={() => onViewAs(a.userId)}>
                <div className="row-avatar" style={{ background:"var(--teal)", width:40, height:40, fontSize:14 }}>
                  {(a.fullName || a.email || "?").charAt(0).toUpperCase()}
                </div>
                <div className="row-content">
                  <div className="row-title">{a.fullName || t("admin.noName")}</div>
                  <div className="row-sub">{a.email || `ID: ${a.userId.slice(0, 8)}...`} · {a.patientCount} {t("nav.patients").toLowerCase()}</div>
                </div>
                <span style={{ fontSize:11, fontWeight:600, color:"var(--teal-dark)", padding:"4px 10px", background:"var(--teal-pale)", borderRadius:"var(--radius-pill)", flexShrink:0 }}>
                  {t("admin.view")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
