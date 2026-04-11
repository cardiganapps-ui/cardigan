import { useState, useEffect, useCallback } from "react";
import { fetchAllAccounts, fetchBugReports, deleteBugReport } from "../hooks/useCardiganData";
import { IconX, IconTrash } from "../components/Icons";
import { useT } from "../i18n/index";

function relativeTime(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days}d`;
  return new Date(dateStr).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

function AccountsTab({ onViewAs }) {
  const { t } = useT();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchAllAccounts()
      .then(a => { setAccounts(a); setLoading(false); })
      .catch(e => { setError(e.message || t("admin.loadError")); setLoading(false); });
  }, [t]);

  if (loading) return <div style={{ textAlign:"center", padding:40, color:"var(--charcoal-xl)", fontSize:13 }}>{t("admin.loadingAccounts")}</div>;
  if (error) return <div style={{ textAlign:"center", padding:40, color:"var(--red)", fontSize:13 }}>{error}</div>;
  if (accounts.length === 0) return <div style={{ textAlign:"center", padding:40, color:"var(--charcoal-xl)", fontSize:13 }}>{t("admin.noAccounts")}</div>;

  return (
    <>
      <div style={{ fontSize:11, color:"var(--charcoal-xl)", marginBottom:8 }}>
        {t("admin.accounts", { count: accounts.length })}
      </div>
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
    </>
  );
}

function BugReportRow({ report, onDelete }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try { await onDelete(report.id); }
    finally { setDeleting(false); }
  };

  const logsText = typeof report.logs === "string"
    ? report.logs
    : Array.isArray(report.logs)
      ? report.logs.map(l => typeof l === "string" ? l : JSON.stringify(l)).join("\n")
      : report.logs ? JSON.stringify(report.logs, null, 2) : "";

  return (
    <div className="card" style={{ padding:"12px 14px", marginBottom:10 }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8, marginBottom:6 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:700, color:"var(--charcoal)", marginBottom:2, wordBreak:"break-word" }}>
            {report.description || <span style={{ color:"var(--charcoal-xl)", fontWeight:500, fontStyle:"italic" }}>{t("admin.bugNoDescription")}</span>}
          </div>
          <div style={{ fontSize:11, color:"var(--charcoal-xl)", display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
            <span>{relativeTime(report.created_at)}</span>
            <span>·</span>
            <span style={{ wordBreak:"break-all" }}>{report.user_email || t("admin.bugAnonymous")}</span>
            {report.screen && (<>
              <span>·</span>
              <span style={{ background:"var(--teal-pale)", color:"var(--teal-dark)", padding:"1px 7px", borderRadius:"var(--radius-pill)", fontWeight:700 }}>{report.screen}</span>
            </>)}
          </div>
        </div>
        {confirmDel ? (
          <div style={{ display:"flex", gap:4, flexShrink:0 }}>
            <button onClick={handleDelete} disabled={deleting}
              style={{ padding:"4px 10px", fontSize:11, fontWeight:700, color:"white", background:"var(--red)", border:"none", borderRadius:"var(--radius-pill)", cursor:"pointer", fontFamily:"var(--font)", minHeight:28 }}>
              {deleting ? "..." : t("delete")}
            </button>
            <button onClick={() => setConfirmDel(false)}
              style={{ padding:"4px 10px", fontSize:11, fontWeight:600, color:"var(--charcoal-md)", background:"var(--cream)", border:"none", borderRadius:"var(--radius-pill)", cursor:"pointer", fontFamily:"var(--font)", minHeight:28 }}>
              {t("cancel")}
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmDel(true)} aria-label={t("delete")}
            style={{ width:30, height:30, minHeight:30, borderRadius:"50%", background:"var(--red-bg)", color:"var(--red)", border:"none", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", flexShrink:0, padding:0 }}>
            <IconTrash size={14} />
          </button>
        )}
      </div>

      <button onClick={() => setExpanded(e => !e)}
        style={{ fontSize:11, fontWeight:600, color:"var(--teal-dark)", background:"none", border:"none", cursor:"pointer", padding:"2px 0", fontFamily:"var(--font)", minHeight:24 }}>
        {expanded ? t("admin.bugHideDetails") : t("admin.bugShowDetails")} {expanded ? "▴" : "▾"}
      </button>

      {expanded && (
        <div style={{ marginTop:8, paddingTop:8, borderTop:"1px solid var(--border-lt)", fontSize:11, color:"var(--charcoal-md)" }}>
          {report.user_agent && (
            <div style={{ marginBottom:6 }}>
              <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em", color:"var(--charcoal-xl)", marginBottom:2 }}>{t("admin.bugUserAgent")}</div>
              <div style={{ wordBreak:"break-all", fontFamily:"monospace", fontSize:10, color:"var(--charcoal-lt)" }}>{report.user_agent}</div>
            </div>
          )}
          {logsText && (
            <div>
              <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em", color:"var(--charcoal-xl)", marginBottom:2 }}>{t("admin.bugLogs")}</div>
              <pre style={{ whiteSpace:"pre-wrap", wordBreak:"break-word", fontFamily:"monospace", fontSize:10, color:"var(--charcoal-lt)", background:"var(--cream)", padding:"6px 8px", borderRadius:"var(--radius-sm)", maxHeight:240, overflowY:"auto", margin:0 }}>{logsText}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BugsTab() {
  const { t } = useT();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetchBugReports()
      .then(r => { setReports(r); setError(""); setLoading(false); })
      .catch(e => { setError(e.message || t("admin.bugsLoadError")); setLoading(false); });
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    await deleteBugReport(id);
    setReports(prev => prev.filter(r => r.id !== id));
  };

  if (loading) return <div style={{ textAlign:"center", padding:40, color:"var(--charcoal-xl)", fontSize:13 }}>{t("admin.bugsLoading")}</div>;
  if (error) return <div style={{ textAlign:"center", padding:40, color:"var(--red)", fontSize:13 }}>{error}</div>;
  if (reports.length === 0) return <div style={{ textAlign:"center", padding:40, color:"var(--charcoal-xl)", fontSize:13 }}>{t("admin.bugsEmpty")}</div>;

  return (
    <>
      <div style={{ fontSize:11, color:"var(--charcoal-xl)", marginBottom:8 }}>
        {t("admin.bugsCount", { count: reports.length })}
      </div>
      {reports.map(r => <BugReportRow key={r.id} report={r} onDelete={handleDelete} />)}
    </>
  );
}

export function AdminPanel({ onViewAs, onClose }) {
  const { t } = useT();
  const [tab, setTab] = useState("accounts");

  return (
    <div style={{ position:"fixed", inset:0, background:"var(--white)", zIndex:"var(--z-expediente)", display:"flex", flexDirection:"column" }}>
      <div style={{ background:"#1a1a2e", padding:"calc(var(--sat, 0px) + 14px) 16px 16px", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
          <div style={{ fontFamily:"var(--font-d)", fontSize:18, fontWeight:800, color:"white" }}>{t("admin.title")}</div>
          <button onClick={onClose} aria-label={t("close")}
            style={{ background:"none", border:"none", color:"rgba(255,255,255,0.6)", cursor:"pointer" }}>
            <IconX size={18} />
          </button>
        </div>
        <div style={{ display:"flex", background:"rgba(255,255,255,0.08)", borderRadius:"var(--radius-pill)", padding:3, gap:2 }}>
          {[{k:"accounts",l:t("admin.tabAccounts")},{k:"bugs",l:t("admin.tabBugs")}].map(tb => (
            <button key={tb.k} onClick={() => setTab(tb.k)}
              style={{
                flex:1, padding:"6px 10px", fontSize:12, fontWeight:700,
                borderRadius:"var(--radius-pill)", border:"none", cursor:"pointer",
                fontFamily:"var(--font)", minHeight:32,
                background: tab===tb.k ? "white" : "transparent",
                color: tab===tb.k ? "#1a1a2e" : "rgba(255,255,255,0.65)",
                transition:"all 0.15s",
              }}>
              {tb.l}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:16 }}>
        {tab === "accounts" ? <AccountsTab onViewAs={onViewAs} /> : <BugsTab />}
      </div>
    </div>
  );
}
