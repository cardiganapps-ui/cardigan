import { useState } from "react";
import { todayISO } from "../../utils/dates";
import { IconX } from "../Icons";
import { useT } from "../../i18n/index";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { haptic } from "../../utils/haptics";

/* ── MeasurementSheet ────────────────────────────────────────────
   Bottom sheet for adding or editing an anthropometric measurement.
   Mirrors NewSessionSheet / NewPatientSheet structure (drag-to-
   dismiss, focus trap, ESC to close, slide-up animation) so the
   Mediciones tab feels native to the rest of the patient flow.

   Props:
     open: boolean
     measurement: existing row to edit, or null to create
     onSave: ({ takenAt, weightKg, waistCm, hipCm, bodyFatPct, notes }) => Promise<boolean>
     onClose
   The parent passes the patient context — the sheet is otherwise
   stateless about which patient it's editing for. */
export function MeasurementSheet({ open, measurement, onSave, onClose }) {
  const { t } = useT();
  useEscape(open ? onClose : null);
  const panelRef = useFocusTrap(open);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose, { isOpen: open });
  const setPanel = (el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  const editing = !!measurement;
  // Re-key the form on each open by reading initial state from the
  // measurement prop — when the parent flips `open` true with a
  // different `measurement`, the component re-mounts (the parent
  // passes a fresh key) and the useState defaults kick in fresh.
  const [takenAt, setTakenAt] = useState(measurement?.taken_at || todayISO());
  const [weight,  setWeight]  = useState(measurement?.weight_kg ?? "");
  const [waist,   setWaist]   = useState(measurement?.waist_cm ?? "");
  const [hip,     setHip]     = useState(measurement?.hip_cm ?? "");
  const [bodyFat, setBodyFat] = useState(measurement?.body_fat_pct ?? "");
  const [notes,   setNotes]   = useState(measurement?.notes || "");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const ok = await onSave({
      takenAt,
      weightKg: weight,
      waistCm: waist,
      hipCm: hip,
      bodyFatPct: bodyFat,
      notes,
    });
    setBusy(false);
    if (ok) haptic.tap();
  };

  return (
    <div className="sheet-overlay" onClick={onClose} role="presentation">
      <div
        ref={setPanel}
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="measurement-sheet-title"
        onClick={(e) => e.stopPropagation()}
        {...panelHandlers}>
        <div className="sheet-handle" aria-hidden />
        <div className="sheet-header">
          <div id="measurement-sheet-title" className="sheet-title">
            {editing ? t("measurements.sheetTitleEdit") : t("measurements.sheetTitleNew")}
          </div>
          <button
            type="button"
            className="sheet-close"
            aria-label={t("close")}
            onClick={onClose}>
            <IconX size={14} />
          </button>
        </div>

        <form onSubmit={submit} style={{ padding: "0 20px 20px" }}>
          <div className="input-group">
            <label className="input-label">{t("measurements.fields.takenAt")}</label>
            <input
              className="input"
              type="date"
              value={takenAt}
              max={todayISO()}
              onChange={(e) => setTakenAt(e.target.value)}
              required
            />
          </div>
          {/* The 2x2 grid uses minmax(0, 1fr) so long Spanish labels
              ("% Grasa") don't blow out the column on narrow phones. */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
            <div className="input-group">
              <label className="input-label">{t("measurements.fields.weight")}</label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                max="500"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label className="input-label">{t("measurements.fields.bodyFat")}</label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                max="80"
                value={bodyFat}
                onChange={(e) => setBodyFat(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label className="input-label">{t("measurements.fields.waist")}</label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                max="300"
                value={waist}
                onChange={(e) => setWaist(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label className="input-label">{t("measurements.fields.hip")}</label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                max="300"
                value={hip}
                onChange={(e) => setHip(e.target.value)}
              />
            </div>
          </div>
          <div className="input-group">
            <label className="input-label">{t("measurements.fields.notes")}</label>
            <textarea
              className="input"
              rows="2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={busy}>
              {t("cancel")}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy}>
              {busy ? t("saving") : t("save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
