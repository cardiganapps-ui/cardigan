import { StatCard } from "./StatCard";

/* ── AdminKPIGrid ───────────────────────────────────────────────────────
   Auto-fit KPI tile grid. Wraps existing StatCard children, with a
   `loading` mode that renders placeholder tiles so the band doesn't
   pop into existence after the data resolves.

   Props:
     children: <StatCard /> elements
     loading:  when true, renders `loadingCount` placeholder tiles
     loadingCount: default 6 */
export function AdminKPIGrid({ children, loading = false, loadingCount = 6 }) {
  if (loading) {
    return (
      <div className="admin-kpi-grid-v2" aria-busy="true">
        {Array.from({ length: loadingCount }, (_, i) => (
          <div className="admin-card admin-stat" key={i} style={{ padding: "16px 18px" }} aria-hidden="true">
            <span className="sk-bar sk-bar-xs" style={{ display: "inline-block", width: "55%" }} />
            <div style={{ marginTop: 10 }}>
              <span className="sk-bar sk-bar-lg" style={{ display: "inline-block", width: "70%" }} />
            </div>
            <div style={{ marginTop: 6 }}>
              <span className="sk-bar sk-bar-xs" style={{ display: "inline-block", width: "42%" }} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return <div className="admin-kpi-grid-v2">{children}</div>;
}

// Re-export for callers that want to compose tile + grid together.
AdminKPIGrid.Tile = StatCard;
