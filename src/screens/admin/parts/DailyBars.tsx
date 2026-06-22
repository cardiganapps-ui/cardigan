/* ── DailyBars ──
   Pure-CSS bar chart used by the Overview page for the 30-day daily
   activity series. Each bar's height is value/max. A row of zero-
   height bars renders as a flat baseline so empty days still take
   space — visually communicating "no activity" rather than skipping. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed daily-activity rows
type Row = any;

export function DailyBars({ daily, accessor, label, color = "var(--teal)" }: {
  daily: Row[];
  accessor: (row: Row) => number;
  label?: React.ReactNode;
  color?: string;
}) {
  const values = daily.map(accessor);
  const max = Math.max(1, ...values);
  return (
    <div className="admin-card" style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: "var(--charcoal-xl)" }}>{label}</div>
        <div style={{ fontSize: 11, color: "var(--charcoal-xl)" }}>max {max}</div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 72 }}>
        {daily.map((row: Row) => {
          const v = accessor(row);
          const pct = max > 0 ? (v / max) * 100 : 0;
          return (
            <div
              key={row.day}
              title={`${row.day}: ${v}`}
              style={{
                flex: 1,
                minHeight: v > 0 ? 2 : 1,
                height: `${Math.max(pct, v > 0 ? 4 : 1)}%`,
                background: v > 0 ? color : "var(--border-lt)",
                borderRadius: 2,
                transition: "height 0.3s",
              }}
            />
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: "var(--charcoal-xl)" }}>
        <span>{daily[0]?.day || ""}</span>
        <span>{daily[daily.length - 1]?.day || ""}</span>
      </div>
    </div>
  );
}
