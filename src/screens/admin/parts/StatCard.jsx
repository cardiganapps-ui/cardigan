/* ── StatCard ──
   Compact KPI tile used across the admin dashboard's KPI grids
   (Overview, Revenue, User Detail). Renders into the
   `.admin-kpi-grid` container, which is auto-fit so any number of
   cards wraps gracefully on narrower viewports.

   Uses both `.admin-card` (surface) and `.admin-stat` (hover lift +
   spring) so the stat tiles feel like the home-screen .kpi-card
   primitive — same cadence on hover, same ambient shadow on lift.

   Props:
     label: short eyebrow text (uppercase rendering applied via CSS)
     value: the headline number / amount / count
     sub:   optional 2nd-line caption ("hace 30 días", "+5 desde ayer")
     accent: optional color token name applied to the value text
*/
export function StatCard({ label, value, sub, accent }) {
  return (
    <div className="admin-card admin-stat" style={{ padding: "16px 18px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: "var(--charcoal-xl)", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{
        fontFamily: "var(--font-d)",
        fontSize: 26,
        fontWeight: 800,
        color: accent ? `var(--${accent})` : "var(--charcoal)",
        letterSpacing: "-0.4px",
        lineHeight: 1.05,
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--charcoal-xl)", marginTop: 4 }}>{sub}</div>
      )}
    </div>
  );
}
