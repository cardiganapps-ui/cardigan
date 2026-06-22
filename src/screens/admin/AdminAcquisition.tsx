import { useCallback } from "react";
import { fetchSignupSources, fetchInfluencerCodes } from "../../hooks/useCardiganData";
import { AcquisitionSection } from "./parts/AcquisitionSection";
import { useAdminQuery } from "./useAdminQuery";
import { useT } from "../../i18n/index";
import { AdminPage } from "./parts/AdminPage";
import { AdminTable } from "./parts/AdminTable";
import { AdminBadge } from "./parts/AdminBadge";
import { AdminEmpty } from "./parts/AdminEmpty";

/* ── AdminAcquisition ───────────────────────────────────────────────────
   Source breakdown + influencer code attribution. Cohort matrix is v2.
   Composed via AdminPage + AdminTable so the attribution table inherits
   the dense look + mobile fallback. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed admin code/source rows
type Row = any;

export function AdminAcquisition() {
  const { t } = useT();

  const fetcher = useCallback(() => Promise.all([
    fetchSignupSources(),
    fetchInfluencerCodes(),
  ]).then(([sources, codes]) => ({ sources, codes })), []);
  const { data, loading, error } = useAdminQuery("acquisition", fetcher);

  const sources = data?.sources;
  const codes = data?.codes || [];
  const initialLoading = loading && !data;
  const hasError = !!error && !data;

  const totalAttribSignups = codes.reduce((sum: number, c: Row) => sum + (c.signup_count || 0), 0);
  const totalAttribPaid = codes.reduce((sum: number, c: Row) => sum + (c.paid_count || 0), 0);

  const columns = [
    {
      key: "code", label: t("admin.acquisition.colCode"), mono: true, width: 130,
      render: (c: Row) => <span style={{ fontWeight: 700 }}>{c.code}</span>,
    },
    {
      key: "influencer_name", label: t("admin.acquisition.colInfluencer"),
      render: (c: Row) => c.influencer_name || "—",
    },
    {
      key: "active", label: "Estado", width: 100,
      render: (c: Row) => c.active
        ? <AdminBadge tone="success">Activo</AdminBadge>
        : <AdminBadge tone="neutral">Inactivo</AdminBadge>,
    },
    {
      key: "signup_count", label: t("admin.acquisition.colSignups"), align: "right", width: 80,
      render: (c: Row) => c.signup_count || 0,
    },
    {
      key: "paid_count", label: t("admin.acquisition.colPaid"), align: "right", width: 80,
      render: (c: Row) => c.paid_count || 0,
    },
    {
      key: "conv", label: "%", align: "right", width: 70,
      render: (c: Row) => {
        const conv = c.signup_count > 0 ? Math.round((c.paid_count / c.signup_count) * 100) : 0;
        return `${conv}%`;
      },
    },
  ];

  const mobileLayout = (c: Row) => {
    const conv = c.signup_count > 0 ? Math.round((c.paid_count / c.signup_count) * 100) : 0;
    return {
      primary: <span style={{ fontFamily: "var(--admin-mono)" }}>{c.code}</span>,
      secondary: c.influencer_name || null,
      meta: [
        <span key="s">{c.signup_count || 0} altas</span>,
        <span key="p">{c.paid_count || 0} pagaron</span>,
        <span key="c">{conv}%</span>,
      ],
      badges: c.active
        ? <AdminBadge tone="success">Activo</AdminBadge>
        : <AdminBadge tone="neutral">Inactivo</AdminBadge>,
    };
  };

  return (
    <AdminPage
      title={t("admin.acquisition.title")}
      subtitle={t("admin.acquisition.subtitle")}
    >
      <AcquisitionSection sources={sources} />

      <AdminPage.Section
        title={t("admin.acquisition.sectionCodes")}
        headerExtra={(
          <span style={{ fontSize: 11.5, color: "var(--admin-text-faint)" }}>
            {codes.length} códigos · {totalAttribSignups} altas · {totalAttribPaid} pagaron
          </span>
        )}
      >
        {hasError ? (
          <AdminEmpty title={t("admin.ui.error")} body={String(error)} />
        ) : (
          <AdminTable
            columns={columns}
            rows={codes}
            rowKey={(c: Row) => c.id}
            loading={initialLoading}
            skeletonRows={6}
            empty={(
              <AdminEmpty
                title={t("admin.acquisition.empty")}
                body={t("admin.acquisition.emptyBody")}
              />
            )}
            mobileLayout={mobileLayout}
            ariaLabel={t("admin.acquisition.sectionCodes")}
          />
        )}
      </AdminPage.Section>
    </AdminPage>
  );
}
