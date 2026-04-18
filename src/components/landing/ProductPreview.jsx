import { LogoIcon } from "../LogoMark";

/* Landing "product preview" — phone-framed snapshot of the real Home screen.
   Mirrors production: white topbar with hamburger-left + centered cardigan
   brand + refresh-right, 2x2 KPI tiles with the exact labels used in the app
   (Sesiones hoy / Pacientes / Cobrado (Mes) / No Cobrado), session rows with
   a 3px left border-rail in status color, PRESENCIAL/VIRTUAL eyebrow under
   the time, status badge on the right, and a 54px charcoal FAB. Zero
   invented UI. */

const PREVIEW_SESSIONS = [
  { time: "09:00 - 09:50", name: "Andrea Morales", initial: "A", status: "completed", badge: "Completada", modality: "presencial", avatarColor: "var(--teal)"   },
  { time: "10:30 - 11:20", name: "Carlos Ruiz",    initial: "C", status: "scheduled", badge: "Agendada",   modality: "virtual",    avatarColor: "var(--blue)"   },
  { time: "12:00 - 12:50", name: "Sofía López",    initial: "S", status: "scheduled", badge: "Agendada",   modality: "presencial", avatarColor: "var(--purple)" },
];

const KPIS = [
  { label: "Sesiones hoy",  value: "6",       meta: "Mar 18 Abr" },
  { label: "Pacientes",     value: "24",      meta: "21 activos" },
  { label: "Cobrado (Mes)", value: "$18,240", meta: "Abril" },
  { label: "No Cobrado",    value: "$2,450",  meta: "3 con saldo", negative: true },
];

export function ProductPreview({ floatingKpi = true }) {
  return (
    <div className="lp-preview" aria-hidden="true">
      {floatingKpi && (
        <div className="lp-float-card">
          <div className="lp-float-row">
            <span className="lp-float-av" style={{ background: "var(--purple-bg)", color: "var(--purple)" }}>D</span>
            <div className="lp-float-main">
              <div className="lp-float-name">David Kim</div>
              <div className="lp-float-sub">Jue 10:30 · Próxima</div>
            </div>
            <span className="lp-float-badge">Al día</span>
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
            <div className="lp-phone-hamburger" aria-hidden="true">
              <span /><span /><span />
            </div>
            <div className="lp-phone-brand">
              <LogoIcon size={14} color="var(--charcoal)" />
              <span>cardigan</span>
            </div>
            <div className="lp-phone-topbar-right" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
            </div>
          </div>

          <div className="lp-phone-content">
            <div className="lp-phone-kpis">
              {KPIS.map((k) => (
                <div className="lp-phone-kpi" key={k.label}>
                  <div className="lp-phone-kpi-label">{k.label}</div>
                  <div className={`lp-phone-kpi-value${k.negative ? " lp-phone-kpi-value--red" : ""}`}>{k.value}</div>
                  <div className="lp-phone-kpi-meta">{k.meta}</div>
                </div>
              ))}
            </div>

            <div className="lp-phone-section-title">Hoy</div>
            <div className="lp-phone-list">
              {PREVIEW_SESSIONS.map((r, i) => (
                <div key={i} className={`lp-phone-row lp-phone-row--${r.status}`}>
                  <div className="lp-phone-av" style={{ background: r.avatarColor }}>{r.initial}</div>
                  <div className="lp-phone-row-main">
                    <div className="lp-phone-row-title">{r.name}</div>
                    <div className="lp-phone-row-sub">
                      <span>{r.time}</span>
                      <span className={`lp-phone-eyebrow lp-phone-eyebrow--${r.modality}`}>
                        {r.modality.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <span className={`lp-phone-badge lp-phone-badge--${r.status}`}>{r.badge}</span>
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
