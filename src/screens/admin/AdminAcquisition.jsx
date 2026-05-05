import { useState, useEffect, useCallback } from "react";
import { fetchSignupSources, fetchInfluencerCodes } from "../../hooks/useCardiganData";
import { AcquisitionSection } from "./parts/AcquisitionSection";

/* ── AdminAcquisition ──
   Full-page acquisition surface. Today: source breakdown + influencer
   code attribution table. Cohort matrix is v2. */
export function AdminAcquisition() {
  const [sources, setSources] = useState(null);
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [s, c] = await Promise.all([fetchSignupSources(), fetchInfluencerCodes()]);
      setSources(s);
      setCodes(c);
    } catch (e) {
      setError(e.message || "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="admin-empty">Cargando…</div>;
  if (error) return <div className="admin-empty" style={{ color: "var(--red)" }}>{error}</div>;

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
          <div className="admin-empty">Sin códigos creados.</div>
        ) : (
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
                      <span className="badge" style={{
                        background: c.active ? "var(--green-bg)" : "var(--cream)",
                        color: c.active ? "var(--green)" : "var(--charcoal-xl)",
                      }}>
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
        )}
      </div>
    </>
  );
}
