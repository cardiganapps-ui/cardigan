import { useCallback } from "react";
import { fetchSignupSources, fetchInfluencerCodes } from "../../hooks/useCardiganData";
import { AcquisitionSection } from "./parts/AcquisitionSection";
import { useAdminQuery } from "./useAdminQuery";

/* ── AdminAcquisition ──
   Full-page acquisition surface. Today: source breakdown + influencer
   code attribution table. Cohort matrix is v2. */
export function AdminAcquisition() {
  const fetcher = useCallback(() => Promise.all([
    fetchSignupSources(),
    fetchInfluencerCodes(),
  ]).then(([sources, codes]) => ({ sources, codes })), []);
  const { data, loading, error } = useAdminQuery("acquisition", fetcher);

  if (loading && !data) return <div className="admin-empty">Cargando…</div>;
  if (error && !data) return <div className="admin-empty" style={{ color: "var(--red)" }}>{error}</div>;

  const sources = data?.sources;
  const codes = data?.codes || [];
  const totalAttribSignups = codes.reduce((sum, c) => sum + (c.signup_count || 0), 0);
  const totalAttribPaid = codes.reduce((sum, c) => sum + (c.paid_count || 0), 0);

  return (
    <>
      <AcquisitionSection sources={sources} />

      <div className="admin-card">
        <div className="admin-card-title">Atribución por código</div>
        <div className="admin-card-sub">
          {codes.length} códigos · {totalAttribSignups} altas · {totalAttribPaid} conversiones a pago.
        </div>
        {codes.length === 0 ? (
          <div className="admin-empty">
            <span className="admin-empty-title">Aún no hay códigos</span>
            <span className="admin-empty-body">Cuando crees códigos de descuento desde la sección Códigos, podrás ver aquí cuántas altas y conversiones aporta cada uno.</span>
          </div>
        ) : (
          <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Influencer</th>
                <th>Estado</th>
                <th style={{ textAlign: "right" }}>Altas</th>
                <th style={{ textAlign: "right" }}>Pagaron</th>
                <th style={{ textAlign: "right" }}>%</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => {
                const conv = c.signup_count > 0 ? Math.round((c.paid_count / c.signup_count) * 100) : 0;
                return (
                  <tr key={c.id}>
                    <td style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 700 }}>{c.code}</td>
                    <td>{c.influencer_name || "—"}</td>
                    <td>
                      <span className={`badge ${c.active ? "badge-green" : "badge-gray"}`}>
                        {c.active ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.signup_count || 0}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.paid_count || 0}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{conv}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </>
  );
}
