import { useCallback } from "react";
import { fetchAdminAnalytics, fetchAuditLog, fetchRevenueOverview } from "../../hooks/useCardiganData";
import { StatCard } from "./parts/StatCard";
import { DailyBars } from "./parts/DailyBars";
import { useAdminQuery } from "./useAdminQuery";
import { useT } from "../../i18n/index";
import { useAuditLabel } from "./parts/auditLabels";
import { AdminPage } from "./parts/AdminPage";
import { AdminKPIGrid } from "./parts/AdminKPIGrid";
import { AdminEmpty } from "./parts/AdminEmpty";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed analytics/audit rows
type Row = any;

function fmtMoney(n: number | null | undefined) {
  return `$${(Number(n) || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
}

function fmtRelative(iso: string | null | undefined) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days}d`;
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

/* ── AdminOverview ──────────────────────────────────────────────────────
   Landing page: hero KPI band + 30-day daily charts + a recent
   activity feed. Composed via AdminPage + AdminKPIGrid; activity feed
   gets a skeleton state instead of a "Cargando…" string. */
export function AdminOverview({ onJump }: { onJump?: (page: string) => void }) {
  const { t } = useT();
  const auditLabel = useAuditLabel();

  const fetcher = useCallback(() => Promise.all([
    fetchAdminAnalytics({ days: 30 }),
    fetchRevenueOverview().catch(() => null),
    fetchAuditLog({ limit: 20 }).catch(() => []),
  ]).then(([analytics, revenue, recent]) => ({ analytics, revenue, recent })), []);
  const { data, loading, error } = useAdminQuery("overview", fetcher);

  const initialLoading = loading && !data;
  const hasError = !!error && !data;

  const ov = data?.analytics?.overview || {};
  const daily = data?.analytics?.daily || [];
  const mrrCents = data?.revenue?.mrr_estimate_cents || 0;
  const activeSubs = data?.revenue?.active_subs || 0;
  const recent = data?.recent || [];

  return (
    <AdminPage
      title={t("admin.overview.title")}
      subtitle={t("admin.overview.subtitle")}
    >
      <AdminKPIGrid loading={initialLoading} loadingCount={6}>
        <StatCard
          label="Usuarios"
          value={ov.users_total ?? 0}
          sub={`${ov.users_active_30d ?? 0} activos · ${ov.users_blocked ?? 0} bloqueados`}
          onClick={() => onJump?.("users")}
        />
        <StatCard
          label="Suscripciones Pro"
          value={activeSubs}
          sub={`${fmtMoney(mrrCents / 100)} MRR`}
          accent="teal-dark"
          onClick={() => onJump?.("revenue")}
        />
        <StatCard
          label="Activos 30d"
          value={ov.users_active_30d ?? 0}
          sub={`${ov.users_signups_30d ?? 0} altas en 30d`}
          onClick={() => onJump?.("acquisition")}
        />
        <StatCard
          label="Sesiones"
          value={ov.sessions_total ?? 0}
          sub={`${ov.sessions_30d ?? 0} en 30 días`}
        />
        <StatCard
          label="Pagos"
          value={ov.payments_total ?? 0}
          sub={`${ov.payments_30d ?? 0} en 30 días`}
          onClick={() => onJump?.("revenue")}
        />
        <StatCard
          label="Pacientes"
          value={ov.patients_total ?? 0}
          sub={`${ov.push_subscriptions ?? 0} con push`}
        />
      </AdminKPIGrid>

      <AdminPage.Section title={t("admin.overview.sectionDaily")} padded>
        {initialLoading ? (
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            {[0, 1, 2].map((i) => (
              <div key={i} aria-hidden="true" style={{ height: 100, display: "flex", alignItems: "flex-end", gap: 4 }}>
                {Array.from({ length: 30 }, (_, j) => (
                  <span key={j} className="sk-bar" style={{ width: 6, height: `${30 + ((i + j) % 7) * 8}%`, borderRadius: 2 }} />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            <DailyBars daily={daily} accessor={(r: Row) => r.active_users} label="Usuarios activos" />
            <DailyBars daily={daily} accessor={(r: Row) => r.signups} label="Altas" color="var(--admin-success)" />
            <DailyBars daily={daily} accessor={(r: Row) => r.sessions_created} label="Sesiones creadas" color="var(--admin-text-meta)" />
          </div>
        )}
      </AdminPage.Section>

      <AdminPage.Section
        title={t("admin.overview.sectionActivity")}
        headerExtra={(
          <button
            type="button"
            onClick={() => onJump?.("audit")}
            style={{
              background: "none", border: "none",
              color: "var(--admin-accent)", fontSize: 12, fontWeight: 700,
              cursor: "pointer", padding: 0,
            }}
          >
            {t("admin.overview.activityViewAll")} →
          </button>
        )}
      >
        {hasError ? (
          <AdminEmpty title={t("admin.ui.error")} body={String(error)} />
        ) : initialLoading ? (
          <div role="status" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="admin-activity-row" aria-hidden="true">
                <span className="sk-circle" style={{ width: 24, height: 24, flexShrink: 0 }} />
                <span className="sk-bar sk-bar-sm" style={{ flex: 1, maxWidth: "55%" }} />
                <span className="sk-bar sk-bar-xs" style={{ width: 56 }} />
              </div>
            ))}
          </div>
        ) : recent.length === 0 ? (
          <AdminEmpty
            title="Aún no hay actividad"
            body="Las acciones administrativas (bloqueos, cambios de profesión, comp) aparecerán aquí cuando ocurran."
          />
        ) : (
          <div>
            {recent.slice(0, 12).map((r: Row) => (
              <div key={r.id} className="admin-activity-row">
                <span className="admin-activity-row-body">
                  <span className="admin-activity-row-actor">{auditLabel(r.action)}</span>
                  {r.target_user_id && (
                    <>
                      {" "}
                      <span className="admin-activity-row-target">{r.target_user_id.slice(0, 8)}…</span>
                    </>
                  )}
                </span>
                <span className="admin-activity-row-time">{fmtRelative(r.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </AdminPage.Section>
    </AdminPage>
  );
}
