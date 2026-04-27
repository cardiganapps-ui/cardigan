import { useMemo, useState } from "react";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import { todayISO } from "../../utils/dates";
import { IconTrash } from "../../components/Icons";

/* ── Mediciones tab ──
   Anthropometric history for a single patient. Visible only when the
   active profession `usesAnthropometrics()` (nutritionist + trainer
   today). Renders:
     - A weight sparkline (svg, no chart lib)
     - The most recent measurement plus deltas vs. the last entry and
       vs. the very first entry — gives the practitioner immediate
       "is this patient progressing?" signal
     - A list of entries, newest first
     - An inline form to add a new measurement, plus per-row edit/delete

   The mutations live on useCardigan() (createMeasurement /
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

/* Compact sparkline. Each datapoint is plotted at its actual date
   position (x ∝ date), not its index — so a 3-month gap reads as a
   gap. The very first and last points get a tiny dot so the eye
   anchors. Renders nothing when fewer than 2 weight points exist. */
function Sparkline({ points, color = "var(--teal-dark)" }) {
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
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }} aria-hidden>
      <path d={d} stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => {
        const isEnd = i === 0 || i === points.length - 1;
        return (
          <circle
            key={i}
            cx={sx(p.t).toFixed(1)}
            cy={sy(p.v).toFixed(1)}
            r={isEnd ? 3 : 1.5}
            fill={color}
          />
        );
      })}
    </svg>
  );
}

export function MedicionesTab({ patient }) {
  const { t } = useT();
  const { measurements, createMeasurement, updateMeasurement, deleteMeasurement, readOnly, showSuccess } = useCardigan();

  // Newest first by date, then by created_at as tiebreaker. The data
  // layer fetches with `order("taken_at", desc)`; a re-sort here keeps
  // optimistic inserts in the right slot regardless of date.
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
  // a goal_weight_kg set). Returns one of three strings or null.
  let goalLine = null;
  if (latest && latest.weight_kg != null && patient.goal_weight_kg) {
    const remaining = Number(latest.weight_kg) - Number(patient.goal_weight_kg);
    if (Math.abs(remaining) < 0.5) {
      goalLine = t("measurements.goalReached");
    } else {
      goalLine = t("measurements.goalRemaining", { value: fmt(Math.abs(remaining), 1) });
    }
  }

  // Form state. `editingId` is null for "new entry" mode; otherwise we're
  // editing the row with that id.
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [takenAt, setTakenAt] = useState(todayISO());
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [hip, setHip] = useState("");
  const [bodyFat, setBodyFat] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmDel, setConfirmDel] = useState(null);

  const resetForm = () => {
    setEditingId(null);
    setTakenAt(todayISO());
    setWeight(""); setWaist(""); setHip(""); setBodyFat(""); setNotes("");
  };

  const openNew = () => { resetForm(); setFormOpen(true); };
  const openEdit = (m) => {
    setEditingId(m.id);
    setTakenAt(m.taken_at);
    setWeight(m.weight_kg ?? "");
    setWaist(m.waist_cm ?? "");
    setHip(m.hip_cm ?? "");
    setBodyFat(m.body_fat_pct ?? "");
    setNotes(m.notes ?? "");
    setFormOpen(true);
  };
  const closeForm = () => { setFormOpen(false); resetForm(); };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    let ok = false;
    if (editingId) {
      ok = await updateMeasurement(editingId, {
        taken_at: takenAt,
        weight_kg: weight,
        waist_cm: waist,
        hip_cm: hip,
        body_fat_pct: bodyFat,
        notes: notes,
      });
    } else {
      const created = await createMeasurement({
        patientId: patient.id,
        takenAt,
        weightKg: weight,
        waistCm: waist,
        hipCm: hip,
        bodyFatPct: bodyFat,
        notes,
      });
      ok = !!created;
    }
    setBusy(false);
    if (ok) {
      showSuccess?.(t("saved"));
      closeForm();
    }
  };

  const doDelete = async (id) => {
    if (busy) return;
    setBusy(true);
    const ok = await deleteMeasurement(id);
    setBusy(false);
    if (ok) {
      setConfirmDel(null);
      showSuccess?.(t("deleted"));
    }
  };

  return (
    <div style={{ padding: "8px 16px 32px" }}>
      {/* Headline / sparkline card. Hidden when there are zero measurements. */}
      {latest && (
        <div className="card" style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
            <div style={{ fontFamily: "var(--font-d)", fontSize: "var(--text-2xl)", fontWeight: 800, color: "var(--charcoal)", lineHeight: 1.05 }}>
              {fmt(latest.weight_kg, 1) ?? "—"}
              {latest.weight_kg != null && <span style={{ fontSize: "var(--text-sm)", color: "var(--charcoal-xl)", fontWeight: 600, marginLeft: 4 }}>kg</span>}
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--charcoal-xl)", fontWeight: 600 }}>
              {formatDateShort(latest.taken_at)}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: "var(--text-xs)", color: "var(--charcoal-md)", marginBottom: sparkPoints.length >= 2 ? 12 : 0 }}>
            <div>
              <span style={{ color: "var(--charcoal-xl)" }}>{t("measurements.delta.sinceLast")}: </span>
              <strong style={{ color: "var(--charcoal)" }}>{renderDelta(latest, previous, "weight_kg", v => t("measurements.delta.kg", { value: v }))}</strong>
            </div>
            <div>
              <span style={{ color: "var(--charcoal-xl)" }}>{t("measurements.delta.sinceFirst")}: </span>
              <strong style={{ color: "var(--charcoal)" }}>{renderDelta(latest, earliest, "weight_kg", v => t("measurements.delta.kg", { value: v }))}</strong>
            </div>
          </div>

          {sparkPoints.length >= 2 && (
            <>
              <Sparkline points={sparkPoints} />
              <div style={{ fontSize: "var(--text-eyebrow)", color: "var(--charcoal-xl)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginTop: 4 }}>
                {t("measurements.weightTrend")}
              </div>
            </>
          )}

          {goalLine && (
            <div style={{ marginTop: 12, padding: "8px 10px", background: "var(--teal-pale)", borderRadius: "var(--radius-sm)", fontSize: "var(--text-sm)", color: "var(--teal-dark)", fontWeight: 600 }}>
              {goalLine}
            </div>
          )}
        </div>
      )}

      {/* List of entries. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: "var(--text-eyebrow)", color: "var(--charcoal-xl)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
          {t("measurements.sectionTitle")} · {ordered.length}
        </div>
        {!readOnly && !formOpen && (
          <button type="button" className="btn btn-secondary"
            style={{ height: 32, padding: "0 12px", fontSize: "var(--text-sm)" }}
            onClick={openNew}>
            {t("measurements.addCta")}
          </button>
        )}
      </div>

      {ordered.length === 0 && !formOpen && (
        <div className="card" style={{ padding: "24px 16px", textAlign: "center", color: "var(--charcoal-xl)", fontSize: "var(--text-sm)", lineHeight: 1.5 }}>
          {t("measurements.empty")}
        </div>
      )}

      {ordered.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          {ordered.map((m) => {
            const fields = [
              m.weight_kg   != null && `${fmt(m.weight_kg, 1)} kg`,
              m.waist_cm    != null && `Cintura ${fmt(m.waist_cm, 1)} cm`,
              m.hip_cm      != null && `Cadera ${fmt(m.hip_cm, 1)} cm`,
              m.body_fat_pct!= null && `${fmt(m.body_fat_pct, 1)}% grasa`,
            ].filter(Boolean);
            return (
              <div key={m.id} className="row-item" style={{ cursor: readOnly ? "default" : "pointer", alignItems: "flex-start" }} onClick={() => !readOnly && openEdit(m)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 2 }}>
                    <div style={{ fontSize: "var(--text-md)", fontWeight: 700, color: "var(--charcoal)" }}>
                      {formatDateShort(m.taken_at)}
                    </div>
                    {!readOnly && (
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); setConfirmDel(m.id); }}
                        style={{ background: "none", border: "none", color: "var(--charcoal-xl)", cursor: "pointer", padding: 0, display: "flex" }}
                        aria-label={t("measurements.deleteCta")}>
                        <IconTrash size={14} />
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--charcoal-md)", lineHeight: 1.4 }}>
                    {fields.length ? fields.join(" · ") : t("measurements.delta.none")}
                  </div>
                  {m.notes && (
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--charcoal-xl)", marginTop: 4, lineHeight: 1.4, whiteSpace: "pre-wrap" }}>{m.notes}</div>
                  )}
                  {confirmDel === m.id && (
                    <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 8, display: "flex", gap: 6 }}>
                      <button type="button" className="btn"
                        style={{ height: 30, padding: "0 12px", fontSize: "var(--text-xs)", background: "var(--red)", color: "var(--white)", boxShadow: "none" }}
                        disabled={busy}
                        onClick={() => doDelete(m.id)}>
                        {t("measurements.deleteCta")}
                      </button>
                      <button type="button" className="btn btn-secondary"
                        style={{ height: 30, padding: "0 12px", fontSize: "var(--text-xs)" }}
                        onClick={() => setConfirmDel(null)}>
                        {t("cancel")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New / edit measurement form — inline, expands in place rather
          than mounting a separate sheet. Keeps the touch target the
          add button itself, and stays close to the list so the user
          sees the new entry land. */}
      {formOpen && !readOnly && (
        <form onSubmit={submit} style={{ marginTop: 14 }}>
          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: "var(--text-md)", fontWeight: 700, color: "var(--charcoal)", marginBottom: 10 }}>
              {editingId ? t("measurements.sheetTitleEdit") : t("measurements.sheetTitleNew")}
            </div>
            <div className="input-group">
              <label className="input-label">{t("measurements.fields.takenAt")}</label>
              <input className="input" type="date" value={takenAt} max={todayISO()} onChange={e => setTakenAt(e.target.value)} required />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="input-group">
                <label className="input-label">{t("measurements.fields.weight")}</label>
                <input className="input" type="number" inputMode="decimal" step="0.1" min="0" max="500" value={weight} onChange={e => setWeight(e.target.value)} />
              </div>
              <div className="input-group">
                <label className="input-label">{t("measurements.fields.bodyFat")}</label>
                <input className="input" type="number" inputMode="decimal" step="0.1" min="0" max="80" value={bodyFat} onChange={e => setBodyFat(e.target.value)} />
              </div>
              <div className="input-group">
                <label className="input-label">{t("measurements.fields.waist")}</label>
                <input className="input" type="number" inputMode="decimal" step="0.1" min="0" max="300" value={waist} onChange={e => setWaist(e.target.value)} />
              </div>
              <div className="input-group">
                <label className="input-label">{t("measurements.fields.hip")}</label>
                <input className="input" type="number" inputMode="decimal" step="0.1" min="0" max="300" value={hip} onChange={e => setHip(e.target.value)} />
              </div>
            </div>
            <div className="input-group">
              <label className="input-label">{t("measurements.fields.notes")}</label>
              <textarea className="input" rows="2" value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button type="button" className="btn btn-secondary" onClick={closeForm} disabled={busy} style={{ flex: 1 }}>
                {t("cancel")}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy} style={{ flex: 1 }}>
                {busy ? t("saving") : t("save")}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
