import { useState, useEffect, useCallback, useMemo } from "react";
import { fetchBugReports, deleteBugReport, archiveBugReports } from "../../hooks/useCardiganData";
import { useT } from "../../i18n/index";
import { IconCheck, IconDownload, IconSearch } from "../../components/Icons";
import { BugReportRow } from "./parts/BugReportRow";
import { downloadCsv } from "./parts/csv";

function formatReportText(r) {
  const date = r.created_at ? new Date(r.created_at).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "—";
  const logs = Array.isArray(r.logs)
    ? r.logs.map(l => typeof l === "string" ? l : `[${l.level}] ${l.timestamp || ""} ${l.message}`).join("\n")
    : typeof r.logs === "string" ? r.logs : r.logs ? JSON.stringify(r.logs, null, 2) : "";
  let text = `## Bug Report — ${date}\n`;
  text += `User: ${r.user_email || "Anónimo"}\n`;
  text += `Screen: ${r.screen || "—"}\n`;
  text += `Description: ${r.description || "(sin descripción)"}\n`;
  if (r.user_agent) text += `User-Agent: ${r.user_agent}\n`;
  if (logs) text += `\nLogs:\n${logs}\n`;
  return text;
}

function downloadReportsTxt(reports) {
  const text = reports.map(formatReportText).join("\n---\n\n");
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bug-reports-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── AdminReports ──
   Bug-report inbox lifted from BugsTab in AdminPanel.jsx with search
   + CSV export added. */
export function AdminReports() {
  const { t } = useT();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetchBugReports({ archived: showArchived })
      .then(r => { setReports(r); setError(""); setLoading(false); })
      .catch(e => { setError(e.message || t("admin.bugsLoadError")); setLoading(false); });
  }, [t, showArchived]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    await deleteBugReport(id);
    setReports(prev => prev.filter(r => r.id !== id));
  };

  const handleArchiveAll = async () => {
    setArchiving(true);
    setError("");
    try {
      const ids = reports.map(r => r.id);
      await archiveBugReports(ids);
      const fresh = await fetchBugReports({ archived: false });
      const stillPending = fresh.filter(r => ids.includes(r.id));
      if (stillPending.length > 0) throw new Error(t("admin.bugsArchiveFailed"));
      setReports(fresh);
      setConfirmArchive(false);
    } catch (e) {
      setError(e.message || "Error");
    } finally {
      setArchiving(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) => {
      const hay = `${r.description || ""} ${r.user_email || ""} ${r.screen || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [reports, search]);

  const onCsv = () => {
    downloadCsv("cardigan-reports-{date}.csv", filtered, [
      { label: "Fecha", get: (r) => r.created_at },
      { label: "Email", get: (r) => r.user_email || "" },
      { label: "Pantalla", get: (r) => r.screen || "" },
      { label: "Descripción", get: (r) => r.description || "" },
      { label: "User-Agent", get: (r) => r.user_agent || "" },
    ]);
  };

  return (
    <div className="admin-card">
      <div style={{ display: "flex", background: "var(--cream)", borderRadius: "var(--radius-pill)", padding: 3, gap: 2, marginBottom: 12 }}>
        {[{ k: false, l: t("admin.bugsActive") }, { k: true, l: t("admin.bugsArchived") }].map(tb => (
          <button key={String(tb.k)} onClick={() => { setShowArchived(tb.k); setConfirmArchive(false); }}
            style={{
              flex: 1, padding: "5px 10px", fontSize: 11, fontWeight: 700,
              borderRadius: "var(--radius-pill)", border: "none", cursor: "pointer",
              fontFamily: "var(--font)", minHeight: 28,
              background: showArchived === tb.k ? "var(--white)" : "transparent",
              color: showArchived === tb.k ? "var(--charcoal)" : "var(--charcoal-xl)",
              boxShadow: showArchived === tb.k ? "var(--shadow-sm)" : "none",
              transition: "all 0.4s",
            }}>
            {tb.l}
          </button>
        ))}
      </div>

      <div className="admin-filters">
        <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--charcoal-xl)", display: "inline-flex" }}>
            <IconSearch size={14} />
          </span>
          <input className="admin-search-input" type="search"
            placeholder="Buscar mensaje, email o pantalla…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 32 }} />
        </div>
        <button type="button" onClick={() => downloadReportsTxt(filtered)}
          className="admin-filter-pill"
          style={{ background: "var(--teal-pale)", borderColor: "var(--teal)", color: "var(--teal-dark)" }}>
          <IconDownload size={13} /> .txt
        </button>
        <button type="button" onClick={onCsv}
          className="admin-filter-pill"
          style={{ background: "var(--teal-pale)", borderColor: "var(--teal)", color: "var(--teal-dark)" }}>
          <IconDownload size={13} /> CSV
        </button>
        {!showArchived && (
          confirmArchive ? (
            <>
              <button onClick={handleArchiveAll} disabled={archiving}
                className="admin-filter-pill"
                style={{ background: "var(--green)", color: "var(--white)", borderColor: "var(--green)" }}>
                {archiving ? "..." : t("admin.bugsArchiveConfirm")}
              </button>
              <button onClick={() => setConfirmArchive(false)} className="admin-filter-pill">
                {t("cancel")}
              </button>
            </>
          ) : (
            <button onClick={() => setConfirmArchive(true)}
              className="admin-filter-pill"
              style={{ background: "var(--green-bg)", color: "var(--green)", borderColor: "var(--green)" }}>
              <IconCheck size={13} /> {t("admin.bugsArchiveAll")}
            </button>
          )
        )}
      </div>

      {loading && <div className="admin-empty">{t("admin.bugsLoading")}</div>}
      {error && (
        <div style={{ background: "var(--red-bg)", color: "var(--red)", padding: "10px 14px", borderRadius: "var(--radius-sm)", fontSize: 13, marginBottom: 10 }}>
          {error}
        </div>
      )}
      {!loading && filtered.length === 0 && !error && (
        <div className="admin-empty">
          {showArchived ? t("admin.bugsArchivedEmpty") : t("admin.bugsEmpty")}
        </div>
      )}
      {!loading && filtered.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: "var(--charcoal-xl)", marginBottom: 8 }}>
            {t("admin.bugsCount", { count: filtered.length })}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.map(r => <BugReportRow key={r.id} report={r} onDelete={handleDelete} />)}
          </div>
        </>
      )}
    </div>
  );
}
