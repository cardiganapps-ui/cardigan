import { useState, useEffect, useCallback } from "react";
import { fetchRevenueOverview, fetchRecentInvoices } from "../../hooks/useCardiganData";
import { StatCard } from "./parts/StatCard";
import { downloadCsv } from "./parts/csv";
import { IconDownload } from "../../components/Icons";

function fmtMoneyCents(cents, currency = "MXN") {
  const amount = (Number(cents) || 0) / 100;
  return amount.toLocaleString("es-MX", { style: "currency", currency, maximumFractionDigits: 0 });
}
function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "2-digit" });
}

/* ── AdminRevenue ──
   v1: KPI band + recent invoices. RPC `admin_revenue_overview` (mig
   046) returns a single JSON aggregate. */
export function AdminRevenue() {
  const [overview, setOverview] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [ov, inv] = await Promise.all([
        fetchRevenueOverview(),
        fetchRecentInvoices({ limit: 50 }),
      ]);
      setOverview(ov);
      setInvoices(inv);
    } catch (e) {
      setError(e.message || "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="admin-empty">Cargando…</div>;
  if (error) return <div className="admin-empty" style={{ color: "var(--red)" }}>{error}</div>;

  const onExport = () => {
    downloadCsv("cardigan-invoices-{date}.csv", invoices, [
      { label: "Fecha", get: (r) => r.created_at || "" },
      { label: "User ID", get: (r) => r.user_id },
      { label: "Monto", get: (r) => ((r.amount_cents || 0) / 100).toFixed(2) },
      { label: "Moneda", get: (r) => r.currency || "MXN" },
      { label: "Pagada", get: (r) => r.paid_at ? "sí" : "no" },
      { label: "Stripe URL", get: (r) => r.hosted_invoice_url || "" },
    ]);
  };

  return (
    <>
      <div className="admin-kpi-grid">
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
      </div>

      <div className="admin-card">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <div className="admin-card-title">Facturas recientes</div>
            <div className="admin-card-sub">Últimas {invoices.length} facturas registradas.</div>
          </div>
          <button type="button" className="admin-filter-pill" onClick={onExport}
            style={{ background: "var(--teal-pale)", borderColor: "var(--teal)", color: "var(--teal-dark)" }}>
            <IconDownload size={13} /> CSV
          </button>
        </div>
        {invoices.length === 0 ? (
          <div className="admin-empty">Sin facturas registradas.</div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>User ID</th>
                <th style={{ textAlign: "right" }}>Monto</th>
                <th>Estado</th>
                <th>Stripe</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(inv.created_at)}</td>
                  <td style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11 }}>
                    {(inv.user_id || "").slice(0, 8)}…
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {fmtMoneyCents(inv.amount_cents, inv.currency || "MXN")}
                  </td>
                  <td>
                    {inv.paid_at
                      ? <span className="badge badge-green">Pagada</span>
                      : <span className="badge badge-gray">—</span>
                    }
                  </td>
                  <td>
                    {inv.hosted_invoice_url ? (
                      <a href={inv.hosted_invoice_url} target="_blank" rel="noopener noreferrer"
                        style={{ color: "var(--teal-dark)", fontWeight: 600 }}>
                        Abrir →
                      </a>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
