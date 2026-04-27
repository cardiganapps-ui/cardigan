import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import { SwipeableRow } from "../../components/SwipeableRow";
import { EmptyState } from "../../components/EmptyState";
import { MeasurementSheet } from "../../components/sheets/MeasurementSheet";
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
   Compact weight-over-time chart. Each datapoint plots at its actual
   date (x ∝ days), not its index, so a long gap reads as a gap.
   On first mount the line draws left-to-right via stroke-dasharray
   over 0.6s on the canonical curve. The two end-point dots fade in
   immediately after the line finishes. Re-renders during the same
   session don't re-animate (the animation is keyed by `points` length
   only on first mount via `firstRender`). */
function Sparkline({ points, color = "var(--teal-dark)" }) {
  const pathRef = useRef(null);
  const [drawn, setDrawn] = useState(false);
  // Only animate the first time a sparkline is rendered for this
  // patient session. We use a ref to remember whether we've already
  // animated, so adding a measurement (new point) doesn't re-draw.
  const firstRenderRef = useRef(true);

  useEffect(() => {
    if (!pathRef.current || !points || points.length < 2) return;
    const length = pathRef.current.getTotalLength();
    if (firstRenderRef.current) {
      pathRef.current.style.strokeDasharray = String(length);
      pathRef.current.style.strokeDashoffset = String(length);
      // Force layout so the next style assignment animates instead of
      // collapsing into a single repaint. void-context lets eslint
      // know the read isn't a typo.
      void pathRef.current.getBoundingClientRect();
      pathRef.current.style.transition = "stroke-dashoffset 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)";
      pathRef.current.style.strokeDashoffset = "0";
      firstRenderRef.current = false;
      // After the line finishes drawing, fade the end-point dots in.
      const id = setTimeout(() => setDrawn(true), 620);
      return () => clearTimeout(id);
    }
    // Subsequent renders: ensure the path is fully visible without
    // animating (guard against React re-creating the element).
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

  // Sparkline points: chronological (oldest first), only entries that
  // have a weight reading. `t` is unix-day so the x-axis spreads by
  // real date intervals.
  const sparkPoints = useMemo(() => {
    const pts = [];
    for (const m of ordered) {
      if (m.weight_kg == null) continue;
      const d = new Date(m.taken_at + "T12:00:00");
      const t = Math.floor(d.getTime() / 86400000);
      pts.push({ t, v: Number(m.weight_kg) });
    }
    return pts.reverse();
  }, [ordered]);

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

  // Goal progress (only meaningful for weight + when the patient has
  // a goal_weight_kg set).
  let goalLine = null;
  if (latest && latest.weight_kg != null && patient.goal_weight_kg) {
    const remaining = Number(latest.weight_kg) - Number(patient.goal_weight_kg);
    if (Math.abs(remaining) < 0.5) {
      goalLine = t("measurements.goalReached");
    } else {
      goalLine = t("measurements.goalRemaining", { value: fmt(Math.abs(remaining), 1) });
    }
  }

  // Sheet state. `editing` is the row being edited, or a sentinel
  // string "new" for create mode.
  const [editing, setEditing] = useState(null);
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

  return (
    <div className="mediciones-tab">
      {/* Headline / sparkline card. Hidden when there are zero measurements. */}
      {latest && (
        <div className="card mediciones-headline">
          <div className="mediciones-headline-row">
            <div className="mediciones-headline-weight">
              {fmt(latest.weight_kg, 1) ?? "—"}
              {latest.weight_kg != null && <span className="mediciones-headline-unit">kg</span>}
            </div>
            <div className="mediciones-headline-date">{formatDateShort(latest.taken_at)}</div>
          </div>

          <div className="mediciones-deltas">
            <div>
              <span className="mediciones-delta-label">{t("measurements.delta.sinceLast")}: </span>
              <strong>{renderDelta(latest, previous, "weight_kg", v => t("measurements.delta.kg", { value: v }))}</strong>
            </div>
            <div>
              <span className="mediciones-delta-label">{t("measurements.delta.sinceFirst")}: </span>
              <strong>{renderDelta(latest, earliest, "weight_kg", v => t("measurements.delta.kg", { value: v }))}</strong>
            </div>
          </div>

          {sparkPoints.length >= 2 && (
            <>
              <Sparkline points={sparkPoints} />
              <div className="mediciones-trend-label">{t("measurements.weightTrend")}</div>
            </>
          )}

          {goalLine && (
            <div className="mediciones-goal">{goalLine}</div>
          )}
        </div>
      )}

      {/* List header */}
      <div className="mediciones-list-header">
        <div className="mediciones-section-eyebrow">
          {t("measurements.sectionTitle")} · {ordered.length}
        </div>
        {!readOnly && (
          <button
            type="button"
            className="btn btn-secondary mediciones-add-cta"
            onClick={() => setEditing("new")}>
            {t("measurements.addCta")}
          </button>
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
    </div>
  );
}
