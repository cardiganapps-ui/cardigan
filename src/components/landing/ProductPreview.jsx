import { LogoIcon } from "../LogoMark";
import { formatTimeRange, formatMxn, getClientColor } from "./landingMock";

/* Landing "product preview" — phone-framed snapshot of the real Home
   screen, driven by the shared `mock` from landingMock.js. Mirrors
   production: white topbar with hamburger-left + centered cardigan
   brand + refresh-right, 2x2 KPI tiles with the exact labels used in
   the app (Sesiones hoy / Pacientes / Cobrado (Mes) / No Cobrado),
   session rows with a 3px left border-rail in status colour, an
   uppercase modality eyebrow, and a 54px charcoal FAB. Zero invented
   data — every number on the phone is rolled up from the same demo
   seed the mini cards below the hero use. */

function avatarBg(s) {
  if (s.session_type === "tutor" || (typeof s.initials === "string" && s.initials.startsWith("T·"))) {
    return "var(--purple)";
  }
  if (s.modality === "virtual") return "var(--blue)";
  if (s.modality === "telefonica") return "var(--green)";
  if (s.modality === "a-domicilio") return "var(--amber)";
  return getClientColor(s.colorIdx ?? s.color_idx ?? 0);
}

function modalityLabel(modality) {
  if (modality === "virtual") return "VIRTUAL";
  if (modality === "telefonica") return "TELEFÓNICA";
  if (modality === "a-domicilio") return "A DOMICILIO";
  return "PRESENCIAL";
}

function modalityKey(modality) {
  if (modality === "virtual") return "virtual";
  if (modality === "telefonica") return "telefonica";
  if (modality === "a-domicilio") return "adomicilio";
  return "presencial";
}

function statusKey(status) {
  if (status === "completed") return "completed";
  if (status === "charged") return "cancelled";
  if (status === "cancelled") return "cancelled";
  return "scheduled";
}

function statusBadge(status) {
  if (status === "completed") return "Completada";
  if (status === "charged") return "Cancelada";
  if (status === "cancelled") return "Cancelada";
  return "Agendada";
}

export function ProductPreview({ mock, floatingKpi = true }) {
  const sessions = (mock?.todaySessions || []).slice(0, 3);
  const todaySessionCount = sessions.length;
  const activeCount = mock?.activeCount ?? 0;
  const totalCount = mock?.totalCount ?? activeCount;
  const monthlyCollected = mock?.monthlyCollected ?? 0;
  const outstanding = mock?.outstanding ?? 0;
  const owingCount = mock?.owingCount ?? 0;
  const monthLabel = mock?.monthLabel || "";
  const todayShort = mock?.todayShort || "";

  // Floating card: pull a "next upcoming" session if there's one
  // beyond the visible 3 to add visual depth + showcase the calendar
  // density. Falls back to the first visible session for sparse
  // demos.
  const float = (mock?.todaySessions || [])[3] || (mock?.todaySessions || [])[0];

  const KPIS = [
    { label: "Sesiones hoy",  value: String(todaySessionCount), meta: todayShort },
    { label: "Pacientes",     value: String(totalCount),        meta: `${activeCount} activos` },
    { label: "Cobrado (Mes)", value: formatMxn(monthlyCollected), meta: monthLabel },
    { label: "No Cobrado",    value: formatMxn(outstanding),    meta: `${owingCount} con saldo`, negative: true },
  ];

  return (
    <div className="lp-preview" aria-hidden="true">
      {floatingKpi && float && (
        <div className="lp-float-card">
          <div className="lp-float-row">
            <span className="lp-float-av" style={{ background: avatarBg(float), color: "#fff" }}>
              {(float.initials || "?").charAt(0)}
            </span>
            <div className="lp-float-main">
              <div className="lp-float-name">{float.patient}</div>
              <div className="lp-float-sub">{float.day} {float.time} · Próxima</div>
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
              {sessions.map((s) => (
                <div key={s.id} className={`lp-phone-row lp-phone-row--${statusKey(s.status)}`}>
                  <div className="lp-phone-av" style={{ background: avatarBg(s) }}>
                    {(s.initials || "?").charAt(0)}
                  </div>
                  <div className="lp-phone-row-main">
                    <div className="lp-phone-row-title">{s.patient}</div>
                    <div className="lp-phone-row-sub">
                      <span>{formatTimeRange(s.time, s.duration)}</span>
                      <span className={`lp-phone-eyebrow lp-phone-eyebrow--${modalityKey(s.modality)}`}>
                        {modalityLabel(s.modality)}
                      </span>
                    </div>
                  </div>
                  <span className={`lp-phone-badge lp-phone-badge--${statusKey(s.status)}`}>
                    {statusBadge(s.status)}
                  </span>
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
