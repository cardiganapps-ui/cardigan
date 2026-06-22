import { useState } from "react";
import { IconTrash } from "../../../components/Icons";
import { useT } from "../../../i18n/index";
import { formatDate } from "../../../utils/format";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed bug-report row
type Row = any;

function relativeTime(dateStr?: string | null) {
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
  return formatDate(dateStr, "short");
}

/* ── BugReportRow ──
   Lifted from AdminPanel.jsx (legacy modal). Single row of the bug
   report list with collapsible details (UA + logs) and per-row
   delete confirmation. */
export function BugReportRow({ report, onDelete }: {
  report: Row;
  onDelete: (id: Row) => void | Promise<void>;
}) {
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
      ? report.logs.map((l: Row) => typeof l === "string" ? l : JSON.stringify(l)).join("\n")
      : report.logs ? JSON.stringify(report.logs, null, 2) : "";

  return (
    <div className="admin-card" style={{ padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--charcoal)", marginBottom: 2, wordBreak: "break-word" }}>
            {report.description || <span style={{ color: "var(--charcoal-xl)", fontWeight: 500, fontStyle: "italic" }}>{t("admin.bugNoDescription")}</span>}
          </div>
          <div style={{ fontSize: 11, color: "var(--charcoal-xl)", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span>{relativeTime(report.created_at)}</span>
            <span>·</span>
            <span style={{ wordBreak: "break-all" }}>{report.user_email || t("admin.bugAnonymous")}</span>
            {report.screen && (<>
              <span>·</span>
              <span style={{ background: "var(--teal-pale)", color: "var(--teal-dark)", padding: "1px 7px", borderRadius: "var(--radius-pill)", fontWeight: 700 }}>{report.screen}</span>
            </>)}
          </div>
        </div>
        {confirmDel ? (
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button onClick={handleDelete} disabled={deleting}
              style={{ padding: "4px 10px", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--white)", background: "var(--red)", border: "none", borderRadius: "var(--radius-pill)", cursor: "pointer", fontFamily: "var(--font)", minHeight: 28 }}>
              {deleting ? "..." : t("delete")}
            </button>
            <button onClick={() => setConfirmDel(false)}
              style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, color: "var(--charcoal-md)", background: "var(--cream)", border: "none", borderRadius: "var(--radius-pill)", cursor: "pointer", fontFamily: "var(--font)", minHeight: 28 }}>
              {t("cancel")}
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmDel(true)} aria-label={t("delete")}
            style={{ width: 30, height: 30, minHeight: 30, borderRadius: "50%", background: "var(--red-bg)", color: "var(--red)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, padding: 0 }}>
            <IconTrash size={14} />
          </button>
        )}
      </div>

      <button onClick={() => setExpanded(e => !e)}
        style={{ fontSize: 11, fontWeight: 600, color: "var(--teal-dark)", background: "none", border: "none", cursor: "pointer", padding: "2px 0", fontFamily: "var(--font)", minHeight: 24 }}>
        {expanded ? t("admin.bugHideDetails") : t("admin.bugShowDetails")} {expanded ? "▴" : "▾"}
      </button>

      {expanded && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-lt)", fontSize: 11, color: "var(--charcoal-md)" }}>
          {report.user_agent && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--charcoal-xl)", marginBottom: 2 }}>{t("admin.bugUserAgent")}</div>
              <div style={{ wordBreak: "break-all", fontFamily: "monospace", fontSize: 10, color: "var(--charcoal-lt)" }}>{report.user_agent}</div>
            </div>
          )}
          {logsText && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--charcoal-xl)", marginBottom: 2 }}>{t("admin.bugLogs")}</div>
              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace", fontSize: 10, color: "var(--charcoal-lt)", background: "var(--cream)", padding: "6px 8px", borderRadius: "var(--radius-sm)", maxHeight: 240, overflowY: "auto", margin: 0 }}>{logsText}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
