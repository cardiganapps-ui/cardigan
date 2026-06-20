import { useState, useMemo } from "react";
import { getClientColor } from "../../data/seedData";
import { IconTrendingUp, IconTrendingDown, IconDownload } from "../../components/Icons";
import { shortDateToISO, parseShortDate, SHORT_MONTHS } from "../../utils/dates";
import { sessionCountsTowardBalance } from "../../utils/accounting";
import { formatMXN } from "../../utils/format";
import { SegmentedControl } from "../../components/SegmentedControl";
import { AnimatedNumber } from "../../components/AnimatedNumber";
import { EmptyState } from "../../components/EmptyState";
import { useT } from "../../i18n/index";
import { TAX_TREATMENT } from "../../data/constants";
import { buildExpensesCsv, downloadExpensesCsv } from "../../utils/expensesExport";
import { toIsoLocal } from "./financesShared";

// ── Resumen / P&L ─────────────────────────────────────────────────────
//
// Backward-looking profit-and-loss. KPIs (income · expenses · profit)
// + a simple horizontal-bar category breakdown + a CSV export for the
// contador. Personal-treatment expenses are excluded from "Egresos"
// per the docstring on TAX_TREATMENT — keeping a personal Uber off
// the business P&L while still letting the user keep one ledger.

export function ResumenTab({ payments, expenses, patients, upcomingSessions }) {
  const { t } = useT();
  const [period, setPeriod] = useState("thisMonth");

  const { from, to } = useMemo(() => {
    const now = new Date();
    if (period === "thisMonth") {
      const f = new Date(now.getFullYear(), now.getMonth(), 1);
      const tt = now;
      return { from: toIsoLocal(f), to: toIsoLocal(tt) };
    }
    if (period === "lastMonth") {
      const f = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const tt = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: toIsoLocal(f), to: toIsoLocal(tt) };
    }
    // thisYear
    return { from: `${now.getFullYear()}-01-01`, to: toIsoLocal(now) };
  }, [period]);

  const inRange = (shortDate) => {
    const iso = shortDateToISO(shortDate);
    return iso >= from && iso <= to;
  };

  const { income, egresos, profit, byCategory } = useMemo(() => {
    let inc = 0;
    for (const p of (payments || [])) if (inRange(p.date)) inc += p.amount;
    let exp = 0;
    const cat = {};
    for (const e of (expenses || [])) {
      if (e.tax_treatment === TAX_TREATMENT.PERSONAL) continue;
      if (!inRange(e.date)) continue;
      exp += e.amount;
      cat[e.category] = (cat[e.category] || 0) + e.amount;
    }
    const sortedCat = Object.entries(cat).sort((a, b) => b[1] - a[1]);
    return { income: inc, egresos: exp, profit: inc - exp, byCategory: sortedCat };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, expenses, from, to]);

  // ── Insights — last 6 months income/expense trend ─────────────────
  // Bar chart of monthly income + expense totals + a profit dot per
  // month. Stays inside the SVG box (no chart lib). Uses the canonical
  // tax_treatment !== "personal" filter to match the KPI tiles above.
  const trend = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ y: d.getFullYear(), m: d.getMonth(), income: 0, expense: 0 });
    }
    const matchMonth = (shortDate) => {
      const iso = shortDateToISO(shortDate);
      if (!iso) return null;
      const [y, m] = iso.split("-").map(Number);
      return months.find(x => x.y === y && x.m === m - 1) || null;
    };
    for (const p of (payments || [])) {
      const bucket = matchMonth(p.date);
      if (bucket) bucket.income += p.amount;
    }
    for (const e of (expenses || [])) {
      if (e.tax_treatment === TAX_TREATMENT.PERSONAL) continue;
      const bucket = matchMonth(e.date);
      if (bucket) bucket.expense += e.amount;
    }
    const peak = months.reduce((m, x) => Math.max(m, x.income, x.expense), 0) || 1;
    return { months, peak };
  }, [payments, expenses]);

  // ── Insights — top 5 patients by paid revenue in the current period
  // The KPI band uses payments, so this matches: which patients are
  // contributing the most cash this period? Future enhancement could
  // toggle to consumed (predicate-based) for the "owed" lens.
  const topPatients = useMemo(() => {
    const byPatient = new Map();
    for (const p of (payments || [])) {
      if (!inRange(p.date)) continue;
      if (!p.patient_id) continue;
      byPatient.set(p.patient_id, (byPatient.get(p.patient_id) || 0) + p.amount);
    }
    const rows = Array.from(byPatient.entries()).map(([id, amount]) => {
      const patient = (patients || []).find(x => x.id === id);
      return { id, name: patient?.name || "—", colorIdx: patient?.colorIdx ?? 0, amount };
    });
    rows.sort((a, b) => b.amount - a.amount);
    return rows.slice(0, 5);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, patients, from, to]);

  // ── Insights — last-90-day session activity by day-of-week ────────
  // Counts sessions that "happened" per the canonical predicate
  // (completed + charged + past-scheduled auto-complete). The day-of-
  // week breakdown shows which days the practitioner is busiest;
  // useful for scheduling decisions ("Wednesdays are full, can I
  // squeeze a new intake on Tuesday?"). Mon-first to match the rest
  // of the app's locale.
  const dayActivity = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90);
    const counts = [0, 0, 0, 0, 0, 0, 0]; // Mon..Sun
    for (const s of (upcomingSessions || [])) {
      if (!sessionCountsTowardBalance(s, now)) continue;
      const d = parseShortDate(s.date);
      if (!d || d < cutoff) continue;
      const dow = (d.getDay() + 6) % 7; // 0=Mon..6=Sun
      counts[dow] += 1;
    }
    const peak = counts.reduce((m, x) => Math.max(m, x), 0) || 1;
    const total = counts.reduce((s, x) => s + x, 0);
    return { counts, peak, total };
  }, [upcomingSessions]);

  const handleExport = () => {
    const year = new Date().getFullYear();
    const csv = buildExpensesCsv(expenses || [], (k) => t(`gastos.cat.${k}`) || k);
    downloadExpensesCsv(csv, t("gastos.exportFilename", { year }));
  };

  return (
    <div style={{ padding: "0 16px 24px" }}>
      <div style={{ marginBottom: 14 }}>
        <SegmentedControl
          value={period}
          onChange={setPeriod}
          items={[
            { k: "thisMonth", l: t("gastos.thisMonth") },
            { k: "lastMonth", l: t("gastos.lastMonth") },
            { k: "thisYear",  l: t("gastos.thisYear") },
          ]}
        />
      </div>

      {/* KPI band — three tiles. Profit color mirrors the sign:
          positive profit is teal-dark (the "Cardigan good news" hue),
          negative profit is amber (a real signal but not destructive). */}
      <div style={{
        display: "grid", gap: 10,
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        marginBottom: 14,
      }}>
        <div className="stat-tile list-entry-stagger" style={{ "--stagger-i": 0 }}>
          <div className="stat-tile-label">
            <IconTrendingUp size={12} style={{ marginRight: 4, verticalAlign: "-2px" }} />
            {t("gastos.incomeKpi")}
          </div>
          <div className="stat-tile-val" style={{ color: "var(--green)", fontVariantNumeric: "tabular-nums" }}>
            +<AnimatedNumber value={income} format={formatMXN} />
          </div>
        </div>
        <div className="stat-tile list-entry-stagger" style={{ "--stagger-i": 1 }}>
          <div className="stat-tile-label">
            <IconTrendingDown size={12} style={{ marginRight: 4, verticalAlign: "-2px" }} />
            {t("gastos.expensesKpi")}
          </div>
          <div className="stat-tile-val" style={{ color: "var(--charcoal)", fontVariantNumeric: "tabular-nums" }}>
            −<AnimatedNumber value={egresos} format={formatMXN} />
          </div>
        </div>
        <div className="stat-tile list-entry-stagger" style={{ "--stagger-i": 2 }}>
          <div className="stat-tile-label">{profit >= 0 ? t("gastos.profitKpi") : t("gastos.profitNegative")}</div>
          <div className="stat-tile-val" style={{
            color: profit >= 0 ? "var(--teal-dark)" : "var(--amber)",
            fontVariantNumeric: "tabular-nums",
          }}>
            {profit >= 0 ? "+" : "−"}<AnimatedNumber value={Math.abs(profit)} format={formatMXN} />
          </div>
        </div>
      </div>

      {/* Category breakdown — horizontal-bar chart from a div per row.
          Inline because the chart is dirt-simple (sorted % of total)
          and pulling in a chart lib would be overkill. */}
      {byCategory.length > 0 && (
        <div className="card" style={{ padding: "16px 16px", marginBottom: 14 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.07em", color: "var(--charcoal-xl)", marginBottom: 10,
          }}>
            {t("gastos.byCategory")}
          </div>
          {byCategory.map(([cat, amt]) => {
            const pct = egresos > 0 ? Math.round((amt / egresos) * 100) : 0;
            return (
              <div key={cat} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: "var(--charcoal)", fontWeight: 600 }}>
                    {t(`gastos.cat.${cat}`) || cat}
                  </span>
                  <span style={{ color: "var(--charcoal-md)", fontVariantNumeric: "tabular-nums" }}>
                    −{formatMXN(amt)} · {pct}%
                  </span>
                </div>
                <div style={{
                  height: 6, width: "100%",
                  background: "var(--cream)",
                  borderRadius: "var(--radius-pill)", overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%", width: `${pct}%`,
                    background: "var(--teal)",
                    transition: "width 300ms var(--ease-out)",
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Insights zero-state ──
          When all three widgets below would self-hide (no payments,
          no expenses, no completed sessions), the Resumen tab feels
          blank for a brand-new account. Show a single warm hint so
          users know this is where their trends will accumulate. */}
      {trend.peak === 0 && topPatients.length === 0 && dayActivity.total === 0 && (
        <EmptyState
          kind="finances"
          compact
          title={t("gastos.insightsEmptyTitle") || "Tus tendencias aparecerán aquí"}
          body={t("gastos.insightsEmptyBody") || "En cuanto registres pagos, gastos o completes sesiones, verás aquí gráficas de ingresos, top pacientes y actividad por día."}
        />
      )}

      {/* ── 6-month revenue trend ──
          Bar chart, two series per month (income green, expense
          charcoal). Hand-rolled SVG to avoid a chart-lib dep — the
          shape is intentionally simple. Tabular-nums so the totals
          line up cleanly. */}
      {trend.peak > 0 && (
        <div className="card" style={{ padding: "16px 16px", marginBottom: 14 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.07em", color: "var(--charcoal-xl)", marginBottom: 12,
          }}>
            Últimos 6 meses
          </div>
          <svg viewBox="0 0 360 140" style={{ width: "100%", height: "auto", display: "block" }}>
            {trend.months.map((bucket, i) => {
              const groupX = 14 + i * 56;
              const barW = 20;
              const incomeH = Math.round((bucket.income / trend.peak) * 92);
              const expenseH = Math.round((bucket.expense / trend.peak) * 92);
              const baseY = 110;
              const monthLabel = SHORT_MONTHS[bucket.m];
              return (
                <g key={`${bucket.y}-${bucket.m}`}>
                  <rect x={groupX} y={baseY - incomeH} width={barW} height={incomeH}
                    rx={3} fill="var(--green)" />
                  <rect x={groupX + barW + 4} y={baseY - expenseH} width={barW} height={expenseH}
                    rx={3} fill="var(--charcoal-md)" />
                  <text x={groupX + barW + 2} y={128} textAnchor="middle"
                    fontSize="10" fontWeight="600" fill="var(--charcoal-xl)">
                    {monthLabel}
                  </text>
                </g>
              );
            })}
          </svg>
          <div style={{
            display: "flex", gap: 14, fontSize: 11, fontWeight: 600,
            color: "var(--charcoal-md)", marginTop: 8, justifyContent: "center",
          }}>
            <span><span style={{
              display: "inline-block", width: 9, height: 9, borderRadius: 2,
              background: "var(--green)", marginRight: 5, verticalAlign: "-1px",
            }} />Ingresos</span>
            <span><span style={{
              display: "inline-block", width: 9, height: 9, borderRadius: 2,
              background: "var(--charcoal-md)", marginRight: 5, verticalAlign: "-1px",
            }} />Gastos</span>
          </div>
        </div>
      )}

      {/* ── Top patients by revenue (current period) ──
          Mirrors the by-category style so the patterns repeat. Empty
          state suppressed entirely when no payments — the parent KPI
          tiles already show "$0" so a second nudge would be noisy. */}
      {topPatients.length > 0 && (
        <div className="card" style={{ padding: "16px 16px", marginBottom: 14 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.07em", color: "var(--charcoal-xl)", marginBottom: 10,
          }}>
            Top pacientes
          </div>
          {topPatients.map((row) => {
            const pct = income > 0 ? Math.round((row.amount / income) * 100) : 0;
            const color = getClientColor(row.colorIdx);
            return (
              <div key={row.id} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: "var(--charcoal)", fontWeight: 600 }}>
                    {row.name}
                  </span>
                  <span style={{ color: "var(--charcoal-md)", fontVariantNumeric: "tabular-nums" }}>
                    {formatMXN(row.amount)} · {pct}%
                  </span>
                </div>
                <div style={{
                  height: 6, width: "100%",
                  background: "var(--cream)",
                  borderRadius: "var(--radius-pill)", overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%", width: `${pct}%`,
                    background: color,
                    transition: "width 300ms var(--ease-out)",
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Day-of-week activity (last 90 days, predicate-aware) ──
          7 bars Mon..Sun showing relative count of sessions that
          actually happened. The total in the header makes the bars'
          unit clear without per-bar labels (less clutter). */}
      {dayActivity.total > 0 && (
        <div className="card" style={{ padding: "16px 16px", marginBottom: 14 }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: "0.07em", color: "var(--charcoal-xl)",
            }}>
              Actividad por día
            </div>
            <div style={{
              fontSize: 11, fontWeight: 600, color: "var(--charcoal-md)", fontVariantNumeric: "tabular-nums",
            }}>
              {dayActivity.total} sesiones · 90 días
            </div>
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6,
            alignItems: "end", height: 80,
          }}>
            {dayActivity.counts.map((count, i) => {
              const pct = (count / dayActivity.peak) * 100;
              return (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{
                    width: "100%", height: `${Math.max(pct, 2)}%`,
                    background: count > 0 ? "var(--teal)" : "var(--border-lt)",
                    borderRadius: "4px 4px 0 0",
                    transition: "height 300ms var(--ease-out)",
                  }} />
                </div>
              );
            })}
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6,
            marginTop: 6, fontSize: 10, fontWeight: 700,
            color: "var(--charcoal-xl)", letterSpacing: "0.04em",
          }}>
            {["L", "M", "M", "J", "V", "S", "D"].map((label, i) => (
              <span key={i} style={{ textAlign: "center" }}>{label}</span>
            ))}
          </div>
        </div>
      )}

      <button type="button" className="btn btn-secondary btn-tap"
        onClick={handleExport}
        disabled={(expenses || []).length === 0}
        style={{ width: "100%", height: 44, gap: 8 }}>
        <IconDownload size={14} />
        <span>{t("gastos.exportContador")}</span>
      </button>
    </div>
  );
}
