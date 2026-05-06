import { IconChevronRight } from "../../../components/Icons";

/* ── StatCard ──
   Compact KPI tile used across the admin dashboard's KPI grids
   (Overview, Revenue, User Detail). Renders into the
   `.admin-kpi-grid` container, which is auto-fit so any number of
   cards wraps gracefully on narrower viewports.

   Uses both `.admin-card` (surface) and `.admin-stat` (hover lift +
   spring) so the stat tiles feel like the home-screen .kpi-card
   primitive — same cadence on hover, same ambient shadow on lift.

   Props:
     label:   short eyebrow text (uppercase rendering applied via CSS)
     value:   the headline number / amount / count
     sub:     optional 2nd-line caption ("hace 30 días", "+5 desde ayer")
     accent:  optional color token name applied to the value text
     onClick: when provided, renders the tile as a button that
              navigates to the relevant detail surface. The chevron
              affordance signals "this drills down" so the admin
              doesn't have to hunt for the link version of the KPI.
*/
export function StatCard({ label, value, sub, accent, onClick }) {
  const clickable = typeof onClick === "function";
  const Tag = clickable ? "button" : "div";
  const props = clickable
    ? { type: "button", onClick, "aria-label": `${label}: ver detalle` }
    : {};
  return (
    <Tag
      {...props}
      className="admin-card admin-stat"
      style={{
        padding: "16px 18px",
        // Reset button defaults when rendered as <button> so the
        // primitive looks identical to the <div> variant.
        ...(clickable ? {
          appearance: "none",
          border: "1px solid var(--border-lt)",
          textAlign: "left",
          cursor: "pointer",
          width: "100%",
          fontFamily: "inherit",
          color: "inherit",
          position: "relative",
          WebkitTapHighlightColor: "transparent",
        } : {}),
      }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: "var(--charcoal-xl)" }}>
          {label}
        </div>
        {clickable && (
          <span aria-hidden style={{ color: "var(--charcoal-xl)", display: "inline-flex" }}>
            <IconChevronRight size={14} />
          </span>
        )}
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
    </Tag>
  );
}
