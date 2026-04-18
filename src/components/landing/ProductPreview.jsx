import { LogoIcon } from "../LogoMark";

/* Landing "product preview" — a phone frame showing real Cardigan primitives
   (KPI tiles, session rows with 3px left-rail status color, teal-pale avatars,
   FAB). Purely presentational — no data wiring. Mirrors the Home screen so the
   landing page feels like the same product, not a generic marketing mock. */
const PREVIEW_SESSIONS = [
  { time: "09:00", name: "Andrea M.", initial: "A", status: "completed" },
  { time: "10:30", name: "Carlos R.", initial: "C", status: "scheduled", now: true },
  { time: "12:00", name: "Sofia L.",  initial: "S", status: "scheduled" },
  { time: "15:00", name: "David K.",  initial: "D", status: "scheduled" },
];

const KPIS = [
  { label: "Sesiones",         value: "6" },
  { label: "Pacientes",        value: "24" },
  { label: "Cobrado",          value: "$4,820" },
];

export function ProductPreview({ floatingKpi = true }) {
  return (
    <div className="lp-preview" aria-hidden="true">
      {floatingKpi && (
        <div className="lp-float-kpi">
          <div className="lp-float-kpi-label">Ingresos del mes</div>
          <div className="lp-float-kpi-value">$18,240</div>
          <div className="lp-float-kpi-trend">
            <svg width="56" height="18" viewBox="0 0 56 18" fill="none">
              <path d="M1 14 L12 10 L22 12 L32 6 L44 8 L55 2" stroke="var(--teal)"
                strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </div>
        </div>
      )}

      <div className="lp-phone">
        <div className="lp-phone-notch" />
        <div className="lp-phone-screen">
          <div className="lp-phone-status">
            <span>9:41</span>
            <span className="lp-phone-status-right">
              <span className="lp-phone-bar" />
              <span className="lp-phone-bar lp-phone-bar--tall" />
              <span className="lp-phone-bar" />
            </span>
          </div>

          <div className="lp-phone-topbar">
            <div className="lp-phone-brand">
              <LogoIcon size={14} color="var(--charcoal)" />
              <span>cardigan</span>
            </div>
            <div className="lp-phone-avatar">D</div>
          </div>

          <div className="lp-phone-content">
            <div className="lp-phone-greeting">Hoy, martes</div>

            <div className="lp-phone-kpis">
              {KPIS.map((k) => (
                <div className="lp-phone-kpi" key={k.label}>
                  <div className="lp-phone-kpi-label">{k.label}</div>
                  <div className="lp-phone-kpi-value">{k.value}</div>
                </div>
              ))}
            </div>

            <div className="lp-phone-list-title">Próximas sesiones</div>
            <div className="lp-phone-list">
              {PREVIEW_SESSIONS.map((r, i) => (
                <div key={i} className={`lp-phone-row lp-phone-row--${r.status}`}>
                  <div className="lp-phone-av">{r.initial}</div>
                  <div className="lp-phone-row-main">
                    <div className="lp-phone-row-name">{r.name}</div>
                    <div className="lp-phone-row-time">{r.time}</div>
                  </div>
                  {r.now && <span className="lp-phone-now" aria-hidden="true" />}
                </div>
              ))}
            </div>
          </div>

          <div className="lp-phone-fab" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
