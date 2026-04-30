/* ── Mini mockup tiles for the landing feature strip ─────────────────
   Three tiny, faithful slices of the real app — sessions, patients,
   and finances — driven by the shared `mock` prop from
   landingMock.js. Each tile renders the SAME rows the visitor sees
   in the hero phone preview, so the page feels like one cohesive
   product walkthrough instead of three independent screenshots.

   Visually mirrors the production row shape (avatar + title + sub
   + status pill, 3px coloured rail) so a visitor switching from the
   landing to the actual app encounters no rendering surprise. */

import { formatTimeRange, formatMxn, getClientColor } from "./landingMock";

function avatarBg(row) {
  // Match production's modality + tutor → colour decisions
  // (mirrors the SessionRow logic in screens/Agenda.jsx).
  if (row.session_type === "tutor" || (typeof row.initials === "string" && row.initials.startsWith("T·"))) {
    return "var(--purple)";
  }
  if (row.modality === "virtual") return "var(--blue)";
  if (row.modality === "telefonica") return "var(--green)";
  if (row.modality === "a-domicilio") return "var(--amber)";
  return getClientColor(row.colorIdx ?? row.color_idx ?? 0);
}

function modalityClass(modality) {
  if (modality === "virtual") return "lp-mini-eyebrow--virtual";
  if (modality === "telefonica") return "lp-mini-eyebrow--telefonica";
  if (modality === "a-domicilio") return "lp-mini-eyebrow--adomicilio";
  return "lp-mini-eyebrow--presencial";
}

function modalityLabel(modality) {
  if (modality === "virtual") return "VIRTUAL";
  if (modality === "telefonica") return "TELEFÓNICA";
  if (modality === "a-domicilio") return "A DOMICILIO";
  return "PRESENCIAL";
}

function statusClass(status) {
  if (status === "completed" || status === "charged") return "lp-mini-row--completed";
  if (status === "cancelled") return "lp-mini-row--cancelled";
  return "lp-mini-row--scheduled";
}

function statusLabel(status) {
  if (status === "completed") return "Completada";
  if (status === "charged")   return "Cancelada";
  if (status === "cancelled") return "Cancelada";
  return "Agendada";
}

function statusBadgeClass(status) {
  if (status === "completed") return "lp-mini-badge--completed";
  if (status === "charged")   return "lp-mini-badge--cancelled";
  if (status === "cancelled") return "lp-mini-badge--cancelled";
  return "lp-mini-badge--scheduled";
}

/* Short display name — "Andrea M." form like the live SessionRow
   uses for compact tiles. Falls back to the full name if it's
   already short. */
function shortName(name) {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1].charAt(0)}.`;
}

export function MiniSessions({ mock }) {
  const rows = (mock?.todaySessions || []).slice(0, 2);
  if (rows.length === 0) {
    return <div className="lp-mini lp-mini--sessions" aria-hidden="true" />;
  }
  return (
    <div className="lp-mini lp-mini--sessions" aria-hidden="true">
      {rows.map((s) => (
        <div key={s.id} className={`lp-mini-row ${statusClass(s.status)}`}>
          <span className="lp-mini-av" style={{ background: avatarBg(s) }}>
            {(s.initials || "?").charAt(0)}
          </span>
          <div className="lp-mini-row-main">
            <div className="lp-mini-row-title">{shortName(s.patient)}</div>
            <div className="lp-mini-row-sub">
              <span>{formatTimeRange(s.time, s.duration)}</span>
              <span className={`lp-mini-eyebrow ${modalityClass(s.modality)}`}>
                {modalityLabel(s.modality)}
              </span>
            </div>
          </div>
          <span className={`lp-mini-badge ${statusBadgeClass(s.status)}`}>
            {statusLabel(s.status)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function MiniPatients({ mock }) {
  const rows = (mock?.featuredPatients || []).slice(0, 2);
  if (rows.length === 0) {
    return <div className="lp-mini lp-mini--patients" aria-hidden="true" />;
  }
  return (
    <div className="lp-mini lp-mini--patients" aria-hidden="true">
      {rows.map((p) => {
        const initial = (p.initials || p.name || "?").charAt(0);
        const isTutor = !!p.parent;
        const bg = isTutor ? "var(--purple)" : getClientColor(p.colorIdx ?? p.color_idx ?? 0);
        return (
          <div key={p.id} className="lp-mini-row">
            <span className="lp-mini-av" style={{ background: bg }}>{initial}</span>
            <div className="lp-mini-row-main">
              <div className="lp-mini-row-title">{p.name}</div>
              <div className="lp-mini-row-sub">
                {isTutor ? (
                  <>
                    <span className="lp-mini-tutor">TUTOR:</span> {shortName(p.parent)} · {formatMxn(p.rate)}
                  </>
                ) : (
                  <span>{formatMxn(p.rate)} por sesión</span>
                )}
              </div>
            </div>
            <span className="lp-mini-badge lp-mini-badge--active">Activo</span>
          </div>
        );
      })}
    </div>
  );
}

export function MiniFinances({ mock }) {
  const collected = mock?.monthlyCollected || 0;
  const outstanding = mock?.outstanding || 0;
  const owingCount = mock?.owingCount || 0;
  const monthLabel = mock?.monthLabel || "";
  return (
    <div className="lp-mini lp-mini--finances" aria-hidden="true">
      <div className="lp-mini-kpi">
        <div className="lp-mini-kpi-label">Cobrado (Mes)</div>
        <div className="lp-mini-kpi-value">{formatMxn(collected)}</div>
        <div className="lp-mini-kpi-meta">{monthLabel}</div>
      </div>
      <div className="lp-mini-kpi">
        <div className="lp-mini-kpi-label">No Cobrado</div>
        <div className="lp-mini-kpi-value lp-mini-kpi-value--red">{formatMxn(outstanding)}</div>
        <div className="lp-mini-kpi-meta">{owingCount} con saldo</div>
      </div>
    </div>
  );
}
