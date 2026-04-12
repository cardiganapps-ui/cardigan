import { LogoIcon } from "../LogoMark";

// Placeholder "dashboard" used in the Product Preview section of the
// landing page. Pure presentation — no data wiring, no interaction. The
// shape is meant to echo the real app (topbar + KPI tiles + a sessions
// list) while staying minimal enough not to distract from the surrounding
// copy.
const PREVIEW_SESSIONS = [
  { time: "09:00", name: "Andrea M." },
  { time: "10:30", name: "Carlos R." },
  { time: "12:00", name: "Sofia L." },
  { time: "15:00", name: "David K." },
];

export function ProductPreview() {
  return (
    <div className="lp-preview" aria-hidden="true">
      <div className="lp-preview-window">
        <div className="lp-preview-chrome">
          <span className="lp-preview-dot" />
          <span className="lp-preview-dot" />
          <span className="lp-preview-dot" />
        </div>
        <div className="lp-preview-topbar">
          <div className="lp-preview-brand">
            <LogoIcon size={14} color="var(--teal-dark)" />
            <span>cardigan</span>
          </div>
          <div className="lp-preview-avatar">D</div>
        </div>
        <div className="lp-preview-content">
          <div className="lp-preview-greeting">Hoy</div>
          <div className="lp-preview-kpis">
            <div className="lp-preview-kpi">
              <div className="lp-preview-kpi-label">Sesiones</div>
              <div className="lp-preview-kpi-value">6</div>
            </div>
            <div className="lp-preview-kpi">
              <div className="lp-preview-kpi-label">Pacientes activos</div>
              <div className="lp-preview-kpi-value">24</div>
            </div>
            <div className="lp-preview-kpi">
              <div className="lp-preview-kpi-label">Cobrado</div>
              <div className="lp-preview-kpi-value">$4,820</div>
            </div>
          </div>
          <div className="lp-preview-list-title">Próximas sesiones</div>
          <div className="lp-preview-list">
            {PREVIEW_SESSIONS.map((row, i) => (
              <div key={i} className="lp-preview-row">
                <span className="lp-preview-time">{row.time}</span>
                <span className="lp-preview-name">{row.name}</span>
                <span className="lp-preview-status" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
