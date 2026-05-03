/* ── BodyCompositionStack ─────────────────────────────────────────
   Horizontal segmented bar that visualises what makes up a patient's
   total mass: Agua · Músculo · Grasa · Otros (protein + minerals +
   anything unaccounted for). Pure SVG so it slots into the existing
   "no charting library" ethos in MedicionesTab.

   Renders only when the underlying scan has all four fragments — for
   manual measurements (no skeletal_muscle_kg etc.) the parent simply
   skips this component. The "Otros" segment is computed as
   max(0, total − water − muscle − fat) so a patient whose four
   pieces don't sum exactly to the recorded weight (rounding,
   minerals not reported, etc.) still gets a visually consistent
   100%-wide bar without overflowing.

   Tokens come from the cream/teal/charcoal palette already defined
   in src/styles/base/tokens.css — no new variables. The animation
   is the standard cubic-bezier(0.34, 1.56, 0.64, 1) spring so the
   widths "settle in" the same way the headline number does. */

const COLORS = {
  water:  "var(--teal-mid, #6BB6B6)",
  muscle: "var(--teal-dark, #2A6B6B)",
  fat:    "var(--gold, #C99756)",
  other:  "var(--charcoal-light, #BDB7AE)",
};

function fmt(n, digits = 1) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toFixed(digits).replace(/\.0$/, "");
}

export function BodyCompositionStack({ measurement, t }) {
  if (!measurement) return null;
  const total = Number(measurement.weight_kg);
  const water = Number(measurement.total_body_water_kg);
  const muscle = Number(measurement.skeletal_muscle_kg);
  const fat = Number(measurement.body_fat_kg);
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(water) || !Number.isFinite(muscle) || !Number.isFinite(fat)) return null;

  // Clamp to non-negative and cap at total so a noisy reading doesn't
  // produce a bar that exceeds 100%.
  const sum = Math.min(total, Math.max(0, water + muscle + fat));
  const other = Math.max(0, total - sum);
  const segments = [
    { key: "water",  value: water,  color: COLORS.water,  label: t("measurements.composition.water") },
    { key: "muscle", value: muscle, color: COLORS.muscle, label: t("measurements.composition.muscle") },
    { key: "fat",    value: fat,    color: COLORS.fat,    label: t("measurements.composition.fat") },
    { key: "other",  value: other,  color: COLORS.other,  label: t("measurements.composition.other") },
  ];

  return (
    <div className="body-comp-stack" role="img"
      aria-label={t("measurements.composition.aria")}>
      <div className="body-comp-bar">
        {segments.map((s) => {
          const pct = (s.value / total) * 100;
          if (pct < 0.5) return null; // hide hairline slivers that read as glitches
          return (
            <span
              key={s.key}
              className="body-comp-segment"
              style={{
                width: `${pct.toFixed(2)}%`,
                background: s.color,
              }}
              aria-hidden
            />
          );
        })}
      </div>
      <div className="body-comp-legend">
        {segments.map((s) => {
          const pct = (s.value / total) * 100;
          if (pct < 0.5) return null;
          return (
            <div key={s.key} className="body-comp-legend-item">
              <span className="body-comp-swatch" style={{ background: s.color }} />
              <span className="body-comp-legend-label">{s.label}</span>
              <span className="body-comp-legend-value">
                {fmt(s.value, 1)} kg · {fmt(pct, 0)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
