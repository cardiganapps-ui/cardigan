import { useCallback } from "react";
import { fetchAdminAnalytics, fetchAuditLog, fetchRevenueOverview } from "../../hooks/useCardiganData";
import { StatCard } from "./parts/StatCard";
import { DailyBars } from "./parts/DailyBars";
import { useAdminQuery } from "./useAdminQuery";

function fmtMoney(n) {
  return `$${(Number(n) || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;
}

function fmtRelative(iso) {
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

const ACTION_LABELS = {
  block_user: "Bloqueo de usuario",
  unblock_user: "Desbloqueo",
  delete_user: "Eliminación",
  update_profession: "Cambio de profesión",
  grant_comp: "Comp otorgada",
  revoke_comp: "Comp revocada",
  create_code: "Código creado",
  toggle_code: "Código alternado",
  recover_encryption: "Recuperación de cifrado",
  view_as: "Ver como usuario",
};

/* ── AdminOverview ──
   Landing page: hero KPI band + 30-day daily charts + a recent
   activity feed sourced from the new admin_audit_log table.
   Uses useAdminQuery so revisits (Overview → Users → Overview)
   render instantly from cache and revalidate in the background. */
export function AdminOverview({ onJump }) {
  const fetcher = useCallback(() => Promise.all([
    fetchAdminAnalytics({ days: 30 }),
    fetchRevenueOverview().catch(() => null),
    fetchAuditLog({ limit: 20 }).catch(() => []),
  ]).then(([analytics, revenue, recent]) => ({ analytics, revenue, recent })), []);
  const { data, loading, error } = useAdminQuery("overview", fetcher);

  if (loading && !data) return <div className="admin-empty">Cargando…</div>;
  if (error && !data) return <div className="admin-empty" style={{ color: "var(--red)" }}>{error}</div>;

  const ov = data?.analytics?.overview || {};
  const daily = data?.analytics?.daily || [];
  const mrrCents = data?.revenue?.mrr_estimate_cents || 0;
  const activeSubs = data?.revenue?.active_subs || 0;
  const recent = data?.recent || [];

  return (
    <>
      <div className="admin-kpi-grid">
        <StatCard label="Usuarios" value={ov.users_total ?? 0}
          sub={`${ov.users_active_30d ?? 0} activos · ${ov.users_blocked ?? 0} bloqueados`} />
        <StatCard label="Suscripciones Pro" value={activeSubs}
          sub={fmtMoney(mrrCents / 100) + " MRR"} accent="teal-dark" />
        <StatCard label="Activos 30d" value={ov.users_active_30d ?? 0}
          sub={`${ov.users_signups_30d ?? 0} altas en 30d`} />
        <StatCard label="Sesiones" value={ov.sessions_total ?? 0}
          sub={`${ov.sessions_30d ?? 0} en 30 días`} />
        <StatCard label="Pagos" value={ov.payments_total ?? 0}
          sub={`${ov.payments_30d ?? 0} en 30 días`} />
        <StatCard label="Pacientes" value={ov.patients_total ?? 0}
          sub={`${ov.push_subscriptions ?? 0} con push`} />
      </div>

      <div className="admin-card">
        <div className="admin-card-title">Actividad diaria · 30 días</div>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <DailyBars daily={daily} accessor={(r) => r.active_users} label="Usuarios activos" />
          <DailyBars daily={daily} accessor={(r) => r.signups} label="Altas" color="var(--green)" />
          <DailyBars daily={daily} accessor={(r) => r.sessions_created} label="Sesiones creadas" color="var(--charcoal-md)" />
        </div>
      </div>

      <div className="admin-card">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
          <div className="admin-card-title">Actividad reciente</div>
          <button type="button"
            onClick={() => onJump?.("audit")}
            style={{ background: "none", border: "none", color: "var(--teal-dark)", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>
            Ver registro completo →
          </button>
        </div>
        {recent.length === 0 ? (
          <div className="admin-empty">Sin eventos registrados.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {recent.slice(0, 12).map((r) => (
              <div key={r.id} style={{
                display: "flex", justifyContent: "space-between", gap: 12,
                padding: "8px 0", borderBottom: "1px solid var(--border-lt)", fontSize: 13,
              }}>
                <span style={{ color: "var(--charcoal)", fontWeight: 600 }}>
                  {ACTION_LABELS[r.action] || r.action}
                </span>
                <span style={{ color: "var(--charcoal-xl)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                  {fmtRelative(r.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
