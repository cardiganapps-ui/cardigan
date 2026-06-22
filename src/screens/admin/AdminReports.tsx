import { useState, useCallback, useMemo } from "react";
import { fetchBugReports, deleteBugReport, archiveBugReports } from "../../hooks/useCardiganData";
import { useT } from "../../i18n/index";
import { IconCheck, IconDownload } from "../../components/Icons";
import { BugReportRow } from "./parts/BugReportRow";
import { downloadCsv } from "./parts/csv";
import { useAdminQuery, invalidateAdminCache } from "./useAdminQuery";
import { SegmentedControl } from "../../components/SegmentedControl";
import { AdminPage } from "./parts/AdminPage";
import { AdminFilterBar } from "./parts/AdminFilterBar";
import { AdminEmpty } from "./parts/AdminEmpty";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed bug-report rows
type Row = any;

function formatReportText(r: Row) {
  const date = r.created_at ? new Date(r.created_at).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "—";
  const logs = Array.isArray(r.logs)
    ? r.logs.map((l: Row) => typeof l === "string" ? l : `[${l.level}] ${l.timestamp || ""} ${l.message}`).join("\n")
    : typeof r.logs === "string" ? r.logs : r.logs ? JSON.stringify(r.logs, null, 2) : "";
  let text = `## Bug Report — ${date}\n`;
  text += `User: ${r.user_email || "Anónimo"}\n`;
  text += `Screen: ${r.screen || "—"}\n`;
  text += `Description: ${r.description || "(sin descripción)"}\n`;
  if (r.user_agent) text += `User-Agent: ${r.user_agent}\n`;
  if (logs) text += `\nLogs:\n${logs}\n`;
  return text;
}

function downloadReportsTxt(reports: Row[]) {
  const text = reports.map(formatReportText).join("\n---\n\n");
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bug-reports-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── AdminReports ───────────────────────────────────────────────────────
   Bug-report inbox. SegmentedControl now drives the active/archived
   tab (replaces the hand-rolled pill row), search + actions go through
   AdminFilterBar, layout wraps in AdminPage. BugReportRow stays
   unchanged. */
export function AdminReports() {
  const { t } = useT();
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState("");

  const cacheKey = `reports:${showArchived ? "archived" : "active"}`;
  const fetcher = useCallback(() => fetchBugReports({ archived: showArchived }), [showArchived]);
  const { data: reports = [], loading, error: loadError, mutate } = useAdminQuery(cacheKey, fetcher);

  const handleDelete = async (id: string) => {
    await deleteBugReport(id);
    mutate((prev: Row[]) => (prev || []).filter((r: Row) => r.id !== id));
  };

  const handleArchiveAll = async () => {
    setArchiving(true);
    setActionError("");
    try {
      const ids = reports.map((r: Row) => r.id);
      await archiveBugReports(ids);
      const fresh = await fetchBugReports({ archived: false });
      const stillPending = fresh.filter((r: Row) => ids.includes(r.id));
      if (stillPending.length > 0) throw new Error(t("admin.bugsArchiveFailed"));
      mutate(fresh);
      invalidateAdminCache("reports:archived");
      setConfirmArchive(false);
    } catch (e) {
      setActionError((e as Error).message || "Error");
    } finally {
      setArchiving(false);
    }
  };

  const error = loadError || actionError;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r: Row) => {
      const hay = `${r.description || ""} ${r.user_email || ""} ${r.screen || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [reports, search]);

  const onCsv = () => {
    downloadCsv("cardigan-reports-{date}.csv", filtered, [
      { label: "Fecha", get: (r: Row) => r.created_at },
      { label: "Email", get: (r: Row) => r.user_email || "" },
      { label: "Pantalla", get: (r: Row) => r.screen || "" },
      { label: "Descripción", get: (r: Row) => r.description || "" },
      { label: "User-Agent", get: (r: Row) => r.user_agent || "" },
    ]);
  };

  const tabValue = showArchived ? "archived" : "active";
  const initialLoading = loading && reports.length === 0;

  return (
    <AdminPage
      title={t("admin.reports.title")}
      subtitle={t("admin.reports.subtitle")}
    >
      <div>
        <SegmentedControl
          value={tabValue}
          onChange={(k) => { setShowArchived(k === "archived"); setConfirmArchive(false); }}
          items={[
            { k: "active", l: t("admin.reports.tabActive") },
            { k: "archived", l: t("admin.reports.tabArchived") },
          ]}
        />
      </div>

      <AdminPage.Section>
        <AdminFilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t("admin.reports.searchPlaceholder")}
        >
          <button
            type="button"
            onClick={() => downloadReportsTxt(filtered)}
            className="admin-filter-bar-v2-pill"
            title=".txt"
          >
            <IconDownload size={13} /> .txt
          </button>
          <button
            type="button"
            onClick={onCsv}
            className="admin-filter-bar-v2-pill"
          >
            <IconDownload size={13} /> CSV
          </button>
          {!showArchived && (
            confirmArchive ? (
              <>
                <button
                  type="button"
                  onClick={handleArchiveAll}
                  disabled={archiving}
                  className="admin-filter-bar-v2-pill admin-filter-bar-v2-pill--active"
                  style={{ background: "var(--admin-success)", color: "white", borderColor: "var(--admin-success)" }}
                >
                  {archiving ? "..." : t("admin.bugsArchiveConfirm")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmArchive(false)}
                  className="admin-filter-bar-v2-pill"
                >
                  {t("cancel")}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmArchive(true)}
                className="admin-filter-bar-v2-pill"
              >
                <IconCheck size={13} /> {t("admin.bugsArchiveAll")}
              </button>
            )
          )}
        </AdminFilterBar>

        {error && (
          <div
            role="alert"
            style={{
              margin: "12px 16px",
              background: "rgba(197, 68, 59, 0.10)",
              color: "var(--admin-danger)",
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 12.5,
              border: "1px solid rgba(197, 68, 59, 0.20)",
            }}
          >
            {error}
          </div>
        )}

        {initialLoading ? (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="admin-row-card" aria-hidden="true">
                <span className="sk-bar sk-bar-md" style={{ width: "62%" }} />
                <span className="sk-bar sk-bar-sm" style={{ width: "40%", marginTop: 4 }} />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 && !error ? (
          <AdminEmpty
            title={showArchived ? t("admin.reports.emptyArchived") : t("admin.reports.empty")}
            body={!showArchived ? t("admin.reports.emptyBody") : undefined}
          />
        ) : (
          <div style={{ padding: "12px 16px 16px" }}>
            <div style={{ fontSize: 11.5, color: "var(--admin-text-faint)", marginBottom: 8 }}>
              {t("admin.bugsCount", { count: filtered.length })}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filtered.map((r: Row) => <BugReportRow key={r.id} report={r} onDelete={handleDelete} />)}
            </div>
          </div>
        )}
      </AdminPage.Section>
    </AdminPage>
  );
}
