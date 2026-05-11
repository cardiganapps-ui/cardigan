import { useCallback } from "react";
import { fetchRevenueOverview, fetchRecentInvoices } from "../../hooks/useCardiganData";
import { StatCard } from "./parts/StatCard";
import { downloadCsv } from "./parts/csv";
import { IconDownload } from "../../components/Icons";
import { useAdminQuery } from "./useAdminQuery";
import { useT } from "../../i18n/index";
import { AdminPage } from "./parts/AdminPage";
import { AdminKPIGrid } from "./parts/AdminKPIGrid";
import { AdminTable } from "./parts/AdminTable";
import { AdminBadge } from "./parts/AdminBadge";
import { AdminEmpty } from "./parts/AdminEmpty";

function fmtMoneyCents(cents, currency = "MXN") {
  const amount = (Number(cents) || 0) / 100;
  return amount.toLocaleString("es-MX", { style: "currency", currency, maximumFractionDigits: 0 });
}
function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "2-digit" });
}

/* ── AdminRevenue ───────────────────────────────────────────────────────
   KPI band + recent invoices. RPC `admin_revenue_overview` (mig 046)
   returns the aggregate. Now composed via AdminPage + AdminKPIGrid +
   AdminTable so the loading state shows skeletons mirroring the final
   layout instead of a "Cargando…" string. */
export function AdminRevenue() {
  const { t } = useT();

  const fetcher = useCallback(() => Promise.all([
    fetchRevenueOverview(),
    fetchRecentInvoices({ limit: 50 }),
  ]).then(([overview, invoices]) => ({ overview, invoices })), []);
  const { data, loading, error } = useAdminQuery("revenue", fetcher);

  const overview = data?.overview;
  const invoices = data?.invoices || [];
  const initialLoading = loading && !data;

  const onExport = () => {
    downloadCsv("cardigan-invoices-{date}.csv", invoices, [
      { label: t("admin.revenue.colDate"), get: (r) => r.created_at || "" },
      { label: "User ID", get: (r) => r.user_id },
      { label: t("admin.revenue.colAmount"), get: (r) => ((r.amount_cents || 0) / 100).toFixed(2) },
      { label: "Moneda", get: (r) => r.currency || "MXN" },
      { label: t("admin.revenue.colStatus"), get: (r) => r.paid_at ? "Pagada" : "Pendiente" },
      { label: "Stripe URL", get: (r) => r.hosted_invoice_url || "" },
    ]);
  };

  const columns = [
    {
      key: "created_at", label: t("admin.revenue.colDate"), width: 130,
      render: (r) => <span style={{ whiteSpace: "nowrap" }}>{fmtDate(r.created_at)}</span>,
    },
    {
      key: "user_id", label: "User ID", mono: true, width: 110,
      render: (r) => (r.user_id ? `${r.user_id.slice(0, 8)}…` : "—"),
    },
    {
      key: "amount_cents", label: t("admin.revenue.colAmount"), align: "right", width: 110,
      render: (r) => fmtMoneyCents(r.amount_cents, r.currency || "MXN"),
    },
    {
      key: "paid_at", label: t("admin.revenue.colStatus"), width: 110,
      render: (r) => r.paid_at
        ? <AdminBadge tone="success">{t("admin.revenue.statusPaid")}</AdminBadge>
        : <AdminBadge tone="neutral">—</AdminBadge>,
    },
    {
      key: "hosted_invoice_url", label: t("admin.revenue.colInvoice"), width: 80,
      render: (r) => r.hosted_invoice_url ? (
        <a href={r.hosted_invoice_url} target="_blank" rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{ color: "var(--admin-accent)", fontWeight: 600 }}>
          {t("admin.ui.openDetail")} →
        </a>
      ) : "—",
    },
  ];

  const mobileLayout = (r) => ({
    primary: fmtMoneyCents(r.amount_cents, r.currency || "MXN"),
    secondary: r.user_id ? `${r.user_id.slice(0, 8)}…` : null,
    meta: [
      <span key="d">{fmtDate(r.created_at)}</span>,
      r.hosted_invoice_url ? (
        <a key="s" href={r.hosted_invoice_url} target="_blank" rel="noopener noreferrer"
          style={{ color: "var(--admin-accent)" }}>Stripe →</a>
      ) : null,
    ].filter(Boolean),
    badges: r.paid_at
      ? <AdminBadge tone="success">{t("admin.revenue.statusPaid")}</AdminBadge>
      : <AdminBadge tone="neutral">—</AdminBadge>,
  });

  return (
    <AdminPage
      title={t("admin.revenue.title")}
      subtitle={t("admin.revenue.subtitle")}
      actions={(
        <button
          type="button"
          className="admin-filter-pill"
          onClick={onExport}
          style={{ background: "var(--admin-accent-soft)", borderColor: "var(--admin-accent)", color: "var(--admin-accent)" }}
        >
          <IconDownload size={13} /> CSV
        </button>
      )}
    >
      <AdminKPIGrid loading={initialLoading} loadingCount={6}>
        <StatCard
          label="MRR estimado"
          value={fmtMoneyCents(overview?.mrr_estimate_cents || 0)}
          sub={`${overview?.active_subs || 0} suscripciones activas`}
          accent="teal-dark"
        />
        <StatCard
          label="En prueba"
          value={overview?.trialing_subs || 0}
          sub="con tarjeta agregada"
        />
        <StatCard
          label="Comp"
          value={overview?.comp_subs || 0}
          sub="acceso ilimitado otorgado"
        />
        <StatCard
          label="Cancelaron 30d"
          value={overview?.cancelled_30d || 0}
          sub="suscripciones canceladas"
        />
        <StatCard
          label="Ingresos 30d"
          value={fmtMoneyCents(overview?.revenue_30d_cents || 0)}
          sub="facturas pagadas"
        />
        <StatCard
          label="Ingresos totales"
          value={fmtMoneyCents(overview?.revenue_total_cents || 0)}
          sub="histórico"
        />
      </AdminKPIGrid>

      <AdminPage.Section title={t("admin.revenue.sectionInvoices")}>
        {error && !data ? (
          <AdminEmpty title={t("admin.ui.error")} body={String(error)} />
        ) : (
          <AdminTable
            columns={columns}
            rows={invoices}
            rowKey={(r) => r.id}
            loading={initialLoading}
            skeletonRows={8}
            empty={(
              <AdminEmpty
                title={t("admin.revenue.empty")}
                body={t("admin.revenue.emptyBody")}
              />
            )}
            mobileLayout={mobileLayout}
            ariaLabel={t("admin.revenue.sectionInvoices")}
          />
        )}
      </AdminPage.Section>
    </AdminPage>
  );
}
