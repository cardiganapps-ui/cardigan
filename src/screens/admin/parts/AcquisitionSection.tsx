import { useT } from "../../../i18n/index";

/* ── AcquisitionSection ──
   Lifted from AdminPanel.jsx (legacy modal). Renders the signup-source
   percentage bars + free-form "Otro" detail list. All-time only —
   signups are rare events; a 30-day window would underflow at small
   scale. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed acquisition-source rows
type Row = any;

export function AcquisitionSection({ sources }: { sources?: Row }) {
  const { t } = useT();
  if (!sources || sources.total === 0) {
    return (
      <div className="admin-card">
        <div className="admin-card-title">{t("admin.acquisitionTitle")}</div>
        <div className="admin-card-sub">{t("admin.acquisitionEmpty")}</div>
      </div>
    );
  }

  const { breakdown, otherDetails, total } = sources;
  const max = breakdown[0]?.count || 1;

  return (
    <div className="admin-card">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <div className="admin-card-title">{t("admin.acquisitionTitle")}</div>
        <div style={{ fontSize: 11, color: "var(--charcoal-xl)", fontWeight: 600 }}>
          {t("admin.acquisitionTotal", { count: total, plural: total === 1 ? "" : "s" })}
        </div>
      </div>
      <div className="admin-card-sub">{t("admin.acquisitionSubtitle")}</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {breakdown.map(({ source, count, pct }: Row) => {
          const widthPct = ((count / max) * 100).toFixed(1);
          return (
            <div key={source} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                fontSize: 12,
                color: "var(--charcoal)",
                width: 160,
                flexShrink: 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}>
                {t(`onboarding.sources.${source}.label`)}
              </div>
              <div style={{
                flex: 1,
                height: 8,
                background: "var(--cream-deeper, var(--cream))",
                borderRadius: 4,
                overflow: "hidden",
              }}>
                <div style={{
                  width: `${widthPct}%`,
                  height: "100%",
                  background: "var(--teal)",
                  borderRadius: 4,
                }} />
              </div>
              <div style={{
                fontSize: 12,
                color: "var(--charcoal-md)",
                width: 80,
                textAlign: "right",
                flexShrink: 0,
                fontVariantNumeric: "tabular-nums",
              }}>
                {count} · {Math.round(pct * 100)}%
              </div>
            </div>
          );
        })}
      </div>

      {otherDetails.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-lt)" }}>
          <div style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.6px",
            color: "var(--charcoal-xl)",
            fontWeight: 700,
            marginBottom: 8,
          }}>
            {t("admin.acquisitionOtherTitle")} ({otherDetails.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {otherDetails.map((d: Row, i: number) => (
              <div key={i} style={{
                fontSize: 12,
                color: "var(--charcoal-md)",
                padding: "4px 8px",
                background: "var(--cream)",
                borderRadius: "var(--radius-sm)",
                lineHeight: 1.4,
                wordBreak: "break-word",
              }}>
                "{d.text}"
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
