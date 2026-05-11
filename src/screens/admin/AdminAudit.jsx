import { useState, useMemo, useCallback } from "react";
import { fetchAuditLog } from "../../hooks/useCardiganData";
import { downloadCsv } from "./parts/csv";
import { IconDownload } from "../../components/Icons";
import { useAdminQuery } from "./useAdminQuery";
import { useT } from "../../i18n/index";
import { AdminPage } from "./parts/AdminPage";
import { AdminTable } from "./parts/AdminTable";
import { AdminFilterBar } from "./parts/AdminFilterBar";
import { AdminEmpty } from "./parts/AdminEmpty";
import { useAuditLabel } from "./parts/auditLabels";

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

/* ── AdminAudit ─────────────────────────────────────────────────────────
   Chronological dump of admin_audit_log. Filters: action type + free
   text. CSV export supplies the raw rows for offline analysis. Now
   rendered through the v2 admin primitives so the table is dense at
   ≥700px and stacks into cards on phone. */
export function AdminAudit() {
  const { t } = useT();
  const auditLabel = useAuditLabel();
  const [actionFilter, setActionFilter] = useState("all");
  const [search, setSearch] = useState("");

  const fetcher = useCallback(() => fetchAuditLog({ limit: 500 }), []);
  const { data: rows = [], loading, error } = useAdminQuery("audit", fetcher);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (actionFilter !== "all" && r.action !== actionFilter) return false;
      if (q) {
        const hay = `${r.action} ${r.actor_id || ""} ${r.target_user_id || ""} ${JSON.stringify(r.payload || {})}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, actionFilter, search]);

  const onCsv = () => {
    downloadCsv("cardigan-audit-{date}.csv", filtered, [
      { label: t("admin.audit.colDate"), get: (r) => r.created_at },
      { label: t("admin.audit.colAction"), get: (r) => r.action },
      { label: t("admin.audit.colActor"), get: (r) => r.actor_id },
      { label: t("admin.audit.colTarget"), get: (r) => r.target_user_id || "" },
      { label: t("admin.audit.colPayload"), get: (r) => r.payload ? JSON.stringify(r.payload) : "" },
      { label: "IP", get: (r) => r.ip || "" },
      { label: "User-Agent", get: (r) => r.ua || "" },
    ]);
  };

  const filterDefs = [
    { k: "all", l: t("admin.audit.filter.all") },
    { k: "block_user", l: t("admin.audit.filter.blocks") },
    { k: "delete_user", l: t("admin.audit.filter.deletes") },
    { k: "grant_comp", l: t("admin.audit.filter.comp") },
    { k: "view_as", l: t("admin.audit.filter.viewAs") },
    { k: "create_code", l: t("admin.audit.filter.codes") },
    { k: "recover_encryption", l: t("admin.audit.filter.recovery") },
    { k: "update_profession", l: t("admin.audit.filter.profession") },
  ];

  const columns = [
    {
      key: "created_at", label: t("admin.audit.colDate"), width: 170,
      render: (r) => <span style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.created_at)}</span>,
    },
    {
      key: "action", label: t("admin.audit.colAction"), width: 180,
      render: (r) => <span style={{ fontWeight: 600 }}>{auditLabel(r.action)}</span>,
    },
    {
      key: "actor_id", label: t("admin.audit.colActor"), mono: true, width: 110,
      render: (r) => (r.actor_id ? `${r.actor_id.slice(0, 8)}…` : "—"),
    },
    {
      key: "target_user_id", label: t("admin.audit.colTarget"), mono: true, width: 110,
      render: (r) => (r.target_user_id ? `${r.target_user_id.slice(0, 8)}…` : "—"),
    },
    {
      key: "payload", label: t("admin.audit.colPayload"), mono: true,
      render: (r) => (
        <span
          title={r.payload ? JSON.stringify(r.payload) : ""}
          style={{ display: "inline-block", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {r.payload ? JSON.stringify(r.payload) : "—"}
        </span>
      ),
    },
  ];

  const mobileLayout = (r) => ({
    primary: auditLabel(r.action),
    secondary: r.payload ? JSON.stringify(r.payload) : null,
    meta: [
      <span key="d">{fmtDateTime(r.created_at)}</span>,
      <span key="a" style={{ fontFamily: "var(--admin-mono)" }}>
        {r.actor_id ? `actor ${r.actor_id.slice(0, 8)}…` : ""}
      </span>,
      r.target_user_id ? (
        <span key="t" style={{ fontFamily: "var(--admin-mono)" }}>
          → {r.target_user_id.slice(0, 8)}…
        </span>
      ) : null,
    ].filter(Boolean),
  });

  const isInitialLoading = loading && rows.length === 0;
  const hasError = !!error && rows.length === 0;

  return (
    <AdminPage
      title={t("admin.audit.title")}
      subtitle={t("admin.audit.subtitle")}
      actions={(
        <button
          type="button"
          className="admin-filter-pill"
          onClick={onCsv}
          style={{ background: "var(--admin-accent-soft)", borderColor: "var(--admin-accent)", color: "var(--admin-accent)" }}
        >
          <IconDownload size={13} /> CSV
        </button>
      )}
    >
      <AdminPage.Section title={t("admin.audit.sectionTitle")}>
        <AdminFilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t("admin.audit.searchPlaceholder")}
          pills={filterDefs.map((af) => ({
            key: af.k,
            label: af.l,
            active: actionFilter === af.k,
            onClick: () => setActionFilter(af.k),
          }))}
        />
        {hasError ? (
          <AdminEmpty title={t("admin.ui.error")} body={String(error)} />
        ) : (
          <AdminTable
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            loading={isInitialLoading}
            skeletonRows={10}
            empty={(
              <AdminEmpty
                title={rows.length === 0 ? t("admin.audit.empty") : t("admin.audit.noResults")}
                body={rows.length === 0 ? t("admin.audit.emptyBody") : t("admin.ui.noResultsBody")}
              />
            )}
            mobileLayout={mobileLayout}
            ariaLabel={t("admin.audit.title")}
          />
        )}
      </AdminPage.Section>
    </AdminPage>
  );
}
