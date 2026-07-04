import { useState } from "react";
import { todayISO } from "../../utils/dates";
import { IconX } from "../Icons";
import { MoneyInput } from "../MoneyInput";
import { useT } from "../../i18n/index";
import { useCardiganMain } from "../../context/CardiganContext";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useSheetExit } from "../../hooks/useSheetExit";
import { useLayer } from "../../hooks/useLayer";
import { getModalitiesForProfession, MODALITY_I18N_KEY, RECURRENCE_FREQUENCY } from "../../data/constants";
import { SheetOverlay } from "../SheetOverlay";

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const FREQ_OPTS = [
  { k: RECURRENCE_FREQUENCY.WEEKLY,   l: "patients.frequencyWeekly" },
  { k: RECURRENCE_FREQUENCY.BIWEEKLY, l: "patients.frequencyBiweekly" },
  { k: RECURRENCE_FREQUENCY.MONTHLY,  l: "patients.frequencyMonthly" },
];

/* Edit a group's recurring schedule. Applies from an effective date —
   future scheduled occurrences are regenerated at the new slot/rate; past
   rows are untouched (financial history). Mirrors the patient schedule
   change flow. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed group row
type Row = any;

export function GroupScheduleSheet({ group, onClose }: { group: Row; onClose: () => void }) {
  const { t } = useT();
  const { profession, applyGroupScheduleChange, mutating } = useCardiganMain();
  const modalities = getModalitiesForProfession(profession);
  const { exiting, animatedClose } = useSheetExit(true, onClose);
  useEscape(mutating ? () => {} : animatedClose);
  useLayer("group-schedule", animatedClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(mutating ? () => {} : onClose);
  const setPanel = (el: HTMLElement | null) => { panelRef.current = el; scrollRef.current = el; setPanelEl(el); };

  const [day, setDay] = useState(group.day || "Sábado");
  const [time, setTime] = useState(group.time || "10:00");
  const [duration, setDuration] = useState(String(group.duration || 60));
  const [modality, setModality] = useState(group.modality || "presencial");
  const [frequency, setFrequency] = useState(group.recurrence_frequency || "weekly");
  const [rate, setRate] = useState(group.rate == null ? "" : String(group.rate));
  const [effectiveDate, setEffectiveDate] = useState(todayISO());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await applyGroupScheduleChange(group.id, {
      day, time, duration: Number(duration) || 60, modality, frequency,
      rate: rate === "" ? null : Number(rate), effectiveDate,
    });
    if (ok) animatedClose();
  };

  return (
    <SheetOverlay exiting={exiting} onClose={mutating ? undefined : animatedClose}>
      <div ref={setPanel} className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`} role="dialog" aria-modal="true" aria-label={t("groups.schedule")} {...panelHandlers} style={{ maxHeight:"min(90lvh, calc(100lvh - var(--sat) - 16px))" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("groups.schedule")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={animatedClose}><IconX size={14} /></button>
        </div>
        <form onSubmit={submit} style={{ padding:"0 20px 22px" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div className="input-group">
              <label className="input-label">{t("patients.day")}</label>
              <select className="input" value={day} onChange={e => setDay(e.target.value)}>
                {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">{t("patients.time")}</label>
              <input className="input" type="time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div className="input-group">
              <label className="input-label">{t("sessions.duration")}</label>
              <select className="input" value={duration} onChange={e => setDuration(e.target.value)}>
                <option value="30">30 min</option>
                <option value="45">45 min</option>
                <option value="60">1 hora</option>
                <option value="90">1½ horas</option>
                <option value="120">2 horas</option>
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">{t("sessions.modality")}</label>
              <select className="input" value={modality} onChange={e => setModality(e.target.value)}>
                {modalities.map(m => <option key={m} value={m}>{t(`sessions.${MODALITY_I18N_KEY[m]}`)}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div className="input-group">
              <label className="input-label">{t("patients.frequency")}</label>
              <select className="input" value={frequency} onChange={e => setFrequency(e.target.value)}>
                {FREQ_OPTS.map(f => <option key={f.k} value={f.k}>{t(f.l)}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">{t("groups.rate")}</label>
              <MoneyInput min="0" step="50" value={rate} onChange={e => setRate(e.target.value)} placeholder={t("patients.ratePlaceholder")} />
            </div>
          </div>
          <div className="input-group">
            <label className="input-label">{t("patients.effectiveFrom")}</label>
            <input className="input" type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} />
            <div className="input-help">{t("groups.rateHint")}</div>
          </div>
          <button className="btn btn-primary-teal" type="submit" disabled={mutating} style={{ width:"100%" }}>
            {mutating ? t("saving") : t("save")}
          </button>
        </form>
      </div>
    </SheetOverlay>
  );
}
