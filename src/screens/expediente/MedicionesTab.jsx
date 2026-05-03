import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import { SwipeableRow } from "../../components/SwipeableRow";
import { EmptyState } from "../../components/EmptyState";
import { MeasurementSheet } from "../../components/sheets/MeasurementSheet";
import { InBodyImportSheet } from "../../components/sheets/InBodyImportSheet";
import { BodyCompositionStack } from "../../components/BodyCompositionStack";
import { IconTrendingUp } from "../../components/Icons";

/* ── Mediciones tab ──
   Anthropometric history for a single patient. Visible only when the
   active profession `usesAnthropometrics()` (nutritionist + trainer
   today). Renders:
     - Latest weight + Δ vs. last entry + Δ vs. first entry — gives
       the practitioner immediate "is this client progressing?" signal.
     - Animated SVG sparkline (stroke-draw on first mount).
     - Goal-progress line when goal_weight_kg is set.
     - SwipeableRow list of entries (left-swipe to delete, matching
       FinanzasTab + Notes patterns).
     - Slide-up MeasurementSheet for add / edit.

   Mutations live on useCardigan() (createMeasurement /
   updateMeasurement / deleteMeasurement) and are guarded against
   read-only mode at the data layer. */

const fmt = (n, digits = 1) => {
  if (n == null || Number.isNaN(n)) return null;
  return Number(n).toFixed(digits).replace(/\.0$/, "");
};

function formatDateShort(iso) {
  // "2026-04-12" → "12 Abr"
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return iso || "";
  return `${parseInt(m[3], 10)} ${months[parseInt(m[2], 10) - 1]}`;
}

/* ── Sparkline ──
   Compact value-over-time chart. Each datapoint plots at its actual
   date (x ∝ days), not its index, so a long gap reads as a gap.
   On first mount (and on metric change — we deliberately re-key the
   component from the parent) the line draws left-to-right via
   stroke-dasharray over 0.6s on the spring curve. The two end-point
   dots fade in immediately after the line finishes. Re-renders
   driven by adding a new measurement don't re-animate. */
function Sparkline({ points, color = "var(--teal-dark)" }) {
  const pathRef = useRef(null);
  const [drawn, setDrawn] = useState(false);
  const firstRenderRef = useRef(true);

  useEffect(() => {
    if (!pathRef.current || !points || points.length < 2) return;
    const length = pathRef.current.getTotalLength();
    if (firstRenderRef.current) {
      pathRef.current.style.strokeDasharray = String(length);
      pathRef.current.style.strokeDashoffset = String(length);
      void pathRef.current.getBoundingClientRect();
      pathRef.current.style.transition = "stroke-dashoffset 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)";
      pathRef.current.style.strokeDashoffset = "0";
      firstRenderRef.current = false;
      const id = setTimeout(() => setDrawn(true), 620);
      return () => clearTimeout(id);
    }
    pathRef.current.style.strokeDasharray = "";
    pathRef.current.style.strokeDashoffset = "0";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrawn(true);
  }, [points]);

  if (!points || points.length < 2) return null;
  const W = 320, H = 56, PAD = 4;
  const xs = points.map(p => p.t);
  const ys = points.map(p => p.v);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const sx = (x) => PAD + ((x - xMin) / xRange) * (W - 2 * PAD);
  const sy = (y) => H - PAD - ((y - yMin) / yRange) * (H - 2 * PAD);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.t).toFixed(1)} ${sy(p.v).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" className="mediciones-sparkline" aria-hidden>
      <path
        ref={pathRef}
        d={d}
        stroke={color}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((p, i) => {
        const isEnd = i === 0 || i === points.length - 1;
        return (
          <circle
            key={i}
            cx={sx(p.t).toFixed(1)}
            cy={sy(p.v).toFixed(1)}
            r={isEnd ? 3 : 1.5}
            fill={color}
            opacity={drawn ? 1 : 0}
            style={{ transition: "opacity 0.25s ease 0.05s" }}
          />
        );
      })}
    </svg>
  );
}

/* Per-metric config for the sparkline tab strip. `field` matches the
   measurements column; `label` resolves through i18n; `unit` and
   `digits` drive the headline number formatting. The tab strip
   surfaces only metrics whose underlying field appears on at least
   one measurement, so a manual-only patient sees just "Peso" and an
   InBody patient sees the full set. */
const METRICS = [
  { id: "weight",  field: "weight_kg",          unit: "kg", digits: 1 },
  { id: "bodyFat", field: "body_fat_pct",       unit: "%",  digits: 1 },
  { id: "muscle",  field: "skeletal_muscle_kg", unit: "kg", digits: 1 },
  { id: "score",   field: "inbody_score",       unit: "",   digits: 0 },
];

export function MedicionesTab({ patient }) {
  const { t } = useT();
  const { measurements, createMeasurement, updateMeasurement, deleteMeasurement, readOnly, showSuccess } = useCardigan();

  // Newest first by date, then by created_at as tiebreaker.
  const ordered = useMemo(() => {
    return (measurements || [])
      .filter(m => m.patient_id === patient.id)
      .slice()
      .sort((a, b) => {
        if (a.taken_at !== b.taken_at) return a.taken_at < b.taken_at ? 1 : -1;
        return (b.created_at || "").localeCompare(a.created_at || "");
      });
  }, [measurements, patient.id]);

  // Available metrics: only show a tab if at least one measurement
  // has a non-null value for its field. Always keep "weight" so the
  // empty-data path doesn't flash an empty tab strip.
  const availableMetrics = useMemo(() => {
    return METRICS.filter(({ id, field }) =>
      id === "weight" || ordered.some((m) => m[field] != null),
    );
  }, [ordered]);

  // Two-tier state: the user's REQUESTED metric vs. the metric we
  // can actually plot. If a previously-active metric vanishes (rare,
  // e.g. the user deleted the only InBody scan), `activeMetric`
  // gracefully falls back to the first available tab without an
  // effect — derive at render time, no cascading setState.
  const [requestedMetricId, setRequestedMetricId] = useState("weight");
  const activeMetric = useMemo(
    () => availableMetrics.find((m) => m.id === requestedMetricId) || availableMetrics[0],
    [availableMetrics, requestedMetricId],
  );
  const activeMetricId = activeMetric?.id || "weight";

  // Sparkline points: chronological (oldest first), only entries that
  // have a value for the active metric.
  const sparkPoints = useMemo(() => {
    if (!activeMetric) return [];
    const pts = [];
    for (const m of ordered) {
      const v = m[activeMetric.field];
      if (v == null) continue;
      const d = new Date(m.taken_at + "T12:00:00");
      const t = Math.floor(d.getTime() / 86400000);
      pts.push({ t, v: Number(v) });
    }
    return pts.reverse();
  }, [ordered, activeMetric]);

  // Most recent entry is the headline. Compare against the immediately
  // previous one (Δ desde la última) and against the very first one
  // (Δ desde el inicio) for the long-arc feel.
  const latest = ordered[0] || null;
  const previous = ordered[1] || null;
  const earliest = ordered[ordered.length - 1] || null;

  const renderDelta = (current, against, key, formatter) => {
    if (!current || !against) return t("measurements.delta.none");
    const a = current[key];
    const b = against[key];
    if (a == null || b == null) return t("measurements.delta.none");
    const diff = Number(a) - Number(b);
    const sign = diff > 0 ? "+" : "";
    return formatter(sign + fmt(diff, 1));
  };

  /* Multi-goal tracking. `goal_weight_kg` has been around since
     migration 024; `goal_body_fat_pct` and `goal_skeletal_muscle_kg`
     are added in migration 039. Render a line per goal that's set,
     so a patient with all three sees three lines and a patient with
     just the weight goal sees the original single line. */
  const goalLines = useMemo(() => {
    if (!latest) return [];
    const lines = [];
    const make = (label, current, target, fmtUnit) => {
      if (current == null || target == null) return null;
      const remaining = Number(current) - Number(target);
      if (Math.abs(remaining) < 0.5) {
        return t("measurements.goalReachedFor", { metric: label });
      }
      return t("measurements.goalRemainingFor", {
        metric: label,
        value: fmt(Math.abs(remaining), 1),
        unit: fmtUnit,
      });
    };
    const weightLine = make(t("measurements.metric.weight"), latest.weight_kg, patient.goal_weight_kg, "kg");
    if (weightLine) lines.push(weightLine);
    const bodyFatLine = make(t("measurements.metric.bodyFat"), latest.body_fat_pct, patient.goal_body_fat_pct, "%");
    if (bodyFatLine) lines.push(bodyFatLine);
    const muscleLine = make(t("measurements.metric.muscle"), latest.skeletal_muscle_kg, patient.goal_skeletal_muscle_kg, "kg");
    if (muscleLine) lines.push(muscleLine);
    return lines;
  }, [latest, patient.goal_weight_kg, patient.goal_body_fat_pct, patient.goal_skeletal_muscle_kg, t]);

  // Visceral fat band on the latest scan (1–9 normal, 10–14 elevado, 15+ alto).
  const visceral = useMemo(() => {
    if (!latest || latest.visceral_fat_level == null) return null;
    const v = Number(latest.visceral_fat_level);
    if (!Number.isFinite(v)) return null;
    let band = "is-normal", labelKey = "measurements.visceral.normal";
    if (v >= 15) { band = "is-high"; labelKey = "measurements.visceral.high"; }
    else if (v >= 10) { band = "is-elevated"; labelKey = "measurements.visceral.elevated"; }
    return { value: v, band, labelKey };
  }, [latest]);

  // Sheet state. `editing` is the row being edited, or a sentinel
  // string "new" for create mode.
  const [editing, setEditing] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const sheetOpen = editing !== null;

  const closeSheet = () => setEditing(null);

  const handleSave = async (form) => {
    if (editing === "new") {
      const created = await createMeasurement({
        patientId: patient.id,
        ...form,
      });
      if (created) {
        showSuccess?.(t("saved"));
        closeSheet();
        return true;
      }
      return false;
    }
    const ok = await updateMeasurement(editing.id, {
      taken_at: form.takenAt,
      weight_kg: form.weightKg,
      waist_cm: form.waistCm,
      hip_cm: form.hipCm,
      body_fat_pct: form.bodyFatPct,
      notes: form.notes,
    });
    if (ok) {
      showSuccess?.(t("saved"));
      closeSheet();
      return true;
    }
    return false;
  };

  const handleDelete = async (id) => {
    const ok = await deleteMeasurement(id);
    if (ok) showSuccess?.(t("deleted"));
  };

  // Headline number for the active metric. Falls back to "—" if the
  // latest row doesn't have the metric (e.g. activeMetric is "muscle"
  // but the most recent entry was a manual weigh-in).
  const headlineValue = activeMetric ? latest?.[activeMetric.field] : null;
  const deltaFormatter = (v) => {
    if (!activeMetric) return v;
    const unit = activeMetric.unit ? ` ${activeMetric.unit}` : "";
    return `${v}${unit}`;
  };

  return (
    <div className="mediciones-tab">
      {/* Headline / sparkline card. Hidden when there are zero measurements. */}
      {latest && (
        <div className="card mediciones-headline">
          <div className="mediciones-headline-row">
            <div className="mediciones-headline-weight">
              {headlineValue != null ? fmt(headlineValue, activeMetric.digits) : "—"}
              {headlineValue != null && activeMetric.unit && (
                <span className="mediciones-headline-unit">{activeMetric.unit}</span>
              )}
            </div>
            <div className="mediciones-headline-date">{formatDateShort(latest.taken_at)}</div>
          </div>

          <div className="mediciones-deltas">
            <div>
              <span className="mediciones-delta-label">{t("measurements.delta.sinceLast")}: </span>
              <strong>{renderDelta(latest, previous, activeMetric.field, deltaFormatter)}</strong>
            </div>
            <div>
              <span className="mediciones-delta-label">{t("measurements.delta.sinceFirst")}: </span>
              <strong>{renderDelta(latest, earliest, activeMetric.field, deltaFormatter)}</strong>
            </div>
          </div>

          {/* Body-composition stack — only renders when the latest scan
              has the four constituent fields (water, muscle, fat,
              total weight). Manual entries skip past silently. */}
          <BodyCompositionStack measurement={latest} t={t} />

          {/* Metric tab strip. Shown only if we actually have more than
              one metric available (otherwise it's a single-tab strip
              that adds visual noise without offering a choice). */}
          {availableMetrics.length > 1 && (
            <div className="mediciones-metric-tabs" role="tablist" aria-label={t("measurements.metricTabsAria")}>
              {availableMetrics.map((m) => (
                <button
                  key={m.id}
                  role="tab"
                  type="button"
                  aria-selected={m.id === activeMetricId}
                  className={"mediciones-metric-tab" + (m.id === activeMetricId ? " is-active" : "")}
                  onClick={() => setRequestedMetricId(m.id)}>
                  {t(`measurements.metric.${m.id}`)}
                </button>
              ))}
            </div>
          )}

          {sparkPoints.length >= 2 && (
            <>
              <Sparkline key={activeMetricId} points={sparkPoints} />
              <div className="mediciones-trend-label">
                {t(`measurements.trend.${activeMetricId}`)}
              </div>
            </>
          )}

          {visceral && (
            <div className={`mediciones-visceral ${visceral.band}`} role="status">
              <span className="mediciones-visceral-dot" aria-hidden />
              <span>{t("measurements.visceral.label")}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>· {visceral.value}</span>
              <span>· {t(visceral.labelKey)}</span>
            </div>
          )}

          {goalLines.length > 0 && (
            <div className="mediciones-goal">
              {goalLines.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* List header */}
      <div className="mediciones-list-header">
        <div className="mediciones-section-eyebrow">
          {t("measurements.sectionTitle")} · {ordered.length}
        </div>
        {!readOnly && (
          <div className="mediciones-header-actions">
            <button
              type="button"
              className="btn btn-secondary mediciones-add-cta"
              onClick={() => setImportOpen(true)}>
              {t("measurements.import.cta")}
            </button>
            <button
              type="button"
              className="btn btn-secondary mediciones-add-cta"
              onClick={() => setEditing("new")}>
              {t("measurements.addCta")}
            </button>
          </div>
        )}
      </div>

      {ordered.length === 0 && (
        <EmptyState
          kind="mediciones"
          title={t("measurements.sectionTitle")}
          body={t("measurements.empty")}
          cta={!readOnly && (
            <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
              {t("measurements.addCta")}
            </button>
          )}
        />
      )}

      {ordered.length > 0 && (
        <div className="card mediciones-list">
          {ordered.map((m, i) => {
            const fields = [
              m.weight_kg    != null && `${fmt(m.weight_kg, 1)} kg`,
              m.waist_cm     != null && `Cintura ${fmt(m.waist_cm, 1)} cm`,
              m.hip_cm       != null && `Cadera ${fmt(m.hip_cm, 1)} cm`,
              m.body_fat_pct != null && `${fmt(m.body_fat_pct, 1)}% grasa`,
            ].filter(Boolean);
            const row = (
              <div
                className="mediciones-row"
                role="button"
                tabIndex={0}
                style={{
                  // Stagger entry only on first paint. The animation
                  // delay is computed off the row's index so newer
                  // rows cascade in on add (still subtle: 32ms each).
                  animation: `listEntryIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 32}ms both`,
                }}
                onClick={() => !readOnly && setEditing(m)}>
                <div className="mediciones-row-main">
                  <div className="mediciones-row-date">
                    {formatDateShort(m.taken_at)}
                  </div>
                  <div className="mediciones-row-fields">
                    {fields.length ? fields.join(" · ") : t("measurements.delta.none")}
                  </div>
                  {m.notes && (
                    <div className="mediciones-row-notes">{m.notes}</div>
                  )}
                </div>
                <span className="row-chevron" aria-hidden>›</span>
              </div>
            );
            // Don't wrap in SwipeableRow when readOnly — there's no
            // delete affordance to reveal.
            if (readOnly) return <div key={m.id}>{row}</div>;
            return (
              <SwipeableRow
                key={m.id}
                onAction={() => handleDelete(m.id)}
                actionLabel={t("delete")}
                actionTone="danger">
                {row}
              </SwipeableRow>
            );
          })}
        </div>
      )}

      {sheetOpen && (
        <MeasurementSheet
          key={editing === "new" ? "new" : editing.id}
          open={sheetOpen}
          measurement={editing === "new" ? null : editing}
          onSave={handleSave}
          onClose={closeSheet}
        />
      )}

      {importOpen && (
        <InBodyImportSheet
          open={importOpen}
          patient={patient}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}
