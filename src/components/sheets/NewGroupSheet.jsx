import { useState } from "react";
import { todayISO } from "../../utils/dates";
import { IconX, IconCheck } from "../Icons";
import { MoneyInput } from "../MoneyInput";
import { Avatar } from "../Avatar";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useSheetExit } from "../../hooks/useSheetExit";
import { getModalitiesForProfession, MODALITY_I18N_KEY, RECURRENCE_FREQUENCY } from "../../data/constants";
import { getClientColor } from "../../data/seedData";

const FREQ_OPTS = [
  { k: RECURRENCE_FREQUENCY.WEEKLY,   l: "patients.frequencyWeekly" },
  { k: RECURRENCE_FREQUENCY.BIWEEKLY, l: "patients.frequencyBiweekly" },
  { k: RECURRENCE_FREQUENCY.MONTHLY,  l: "patients.frequencyMonthly" },
];

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/* Create a group: name + color + schedule (day/time/duration/modality/
   frequency) + flat rate + an inline multi-select of existing active
   patients. A "sesión única" toggle drops the recurring schedule for a
   one-off group meeting. On submit we createGroup (which fans out the
   initial window of member sessions). Canonical sheet composition. */
export function NewGroupSheet({ onClose }) {
  const { t } = useT();
  const { profession, patients, createGroup, mutating } = useCardigan();
  const modalities = getModalitiesForProfession(profession);
  const { exiting, animatedClose } = useSheetExit(true, onClose);
  useEscape(mutating ? () => {} : animatedClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(mutating ? () => {} : onClose);
  const setPanel = (el) => { panelRef.current = el; scrollRef.current = el; setPanelEl(el); };

  const [name, setName] = useState("");
  const [colorIdx, setColorIdx] = useState(2);
  const [oneOff, setOneOff] = useState(false);
  const [day, setDay] = useState("Sábado");
  const [time, setTime] = useState("10:00");
  const [date, setDate] = useState(todayISO());
  const [duration, setDuration] = useState("60");
  const [modality, setModality] = useState("presencial");
  const [frequency, setFrequency] = useState("weekly");
  const [rate, setRate] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [err, setErr] = useState("");

  const activePatients = patients.filter(p => p.status === "active");

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setErr(t("groups.name")); return; }
    setErr("");
    const payload = {
      name: name.trim(), colorIdx,
      day: oneOff ? null : day,
      time, duration: Number(duration) || 60,
      rate: rate === "" ? null : Number(rate),
      modality, frequency,
      schedulingMode: oneOff ? "episodic" : "recurring",
      memberPatientIds: [...selected],
      startDate: date,
      generate: !oneOff,
    };
    try {
      const res = await createGroup(payload);
      if (res) animatedClose();
      else setErr("No se pudo crear el grupo. Intenta de nuevo.");
    } catch (ex) { setErr(ex?.message || "Error"); }
  };

  return (
    <div className={`sheet-overlay ${exiting ? "sheet-overlay--exit" : ""}`} onClick={mutating ? undefined : animatedClose}>
      <div ref={setPanel} className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`} role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...panelHandlers} style={{ maxHeight:"min(92lvh, calc(100lvh - var(--sat) - 16px))" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("groups.new")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={animatedClose}><IconX size={14} /></button>
        </div>
        <form onSubmit={submit} style={{ padding:"0 20px 0" }}>
          <div>
            <div className="input-group">
              <label className="input-label">{t("groups.name")}<span style={{ color:"var(--red)", marginLeft:4 }} aria-hidden>*</span></label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder={t("groups.namePlaceholder")} autoFocus />
            </div>

            {/* Color */}
            <div className="input-group">
              <label className="input-label">Color</label>
              <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                {Array.from({ length: 7 }).map((_, i) => (
                  <button key={i} type="button" onClick={() => setColorIdx(i)} aria-label={`color ${i}`}
                    className="btn-tap"
                    style={{ width:30, height:30, borderRadius:"var(--radius-pill)", background:getClientColor(i), border: colorIdx===i ? "3px solid var(--charcoal)" : "3px solid transparent", cursor:"pointer" }} />
                ))}
              </div>
            </div>

            {/* One-off toggle */}
            <label style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 0", cursor:"pointer" }}>
              <input type="checkbox" checked={oneOff} onChange={e => setOneOff(e.target.checked)} style={{ width:18, height:18 }} />
              <span>
                <span style={{ fontWeight:700, fontSize:"var(--text-md)" }}>{t("groups.oneOff")}</span>
                <span style={{ display:"block", fontSize:"var(--text-sm)", color:"var(--charcoal-xl)" }}>{t("groups.oneOffHint")}</span>
              </span>
            </label>

            {/* Schedule */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              {oneOff ? (
                <div className="input-group">
                  <label className="input-label">{t("sessions.date")}</label>
                  <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
                </div>
              ) : (
                <div className="input-group">
                  <label className="input-label">{t("patients.day")}</label>
                  <select className="input" value={day} onChange={e => setDay(e.target.value)}>
                    {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              )}
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
            {!oneOff && (
              <div className="input-group">
                <label className="input-label">{t("patients.frequency") || "Frecuencia"}</label>
                <select className="input" value={frequency} onChange={e => setFrequency(e.target.value)}>
                  {FREQ_OPTS.map(f => <option key={f.k} value={f.k}>{t(f.l)}</option>)}
                </select>
              </div>
            )}
            <div className="input-group">
              <label className="input-label">{t("groups.rate")}</label>
              <MoneyInput min="0" step="50" value={rate} onChange={e => setRate(e.target.value)} placeholder={t("patients.ratePlaceholder")} />
              <div className="input-help">{t("groups.rateHint")}</div>
            </div>

            {/* Members */}
            <div className="input-group">
              <label className="input-label">{t("groups.members")} {selected.size > 0 && <span style={{ color:"var(--teal-dark)" }}>· {selected.size}</span>}</label>
              {activePatients.length === 0 ? (
                <div className="input-help">{t("patients.noPatients")}</div>
              ) : (
                <div className="card" style={{ maxHeight:240, overflowY:"auto" }}>
                  {activePatients.map((p, i) => {
                    const on = selected.has(p.id);
                    return (
                      <button key={p.id} type="button" className="row-item btn-tap" onClick={() => toggle(p.id)}
                        style={{ width:"100%", border:"none", background: on ? "var(--teal-mist)" : "transparent", textAlign:"left", cursor:"pointer" }}>
                        <Avatar initials={p.initials} color={getClientColor(i)} size="sm" />
                        <div className="row-content"><div className="row-title">{p.name}</div></div>
                        <span aria-hidden style={{ width:22, height:22, borderRadius:"var(--radius-pill)", display:"inline-flex", alignItems:"center", justifyContent:"center", border: on ? "none" : "2px solid var(--border)", background: on ? "var(--teal)" : "transparent", color:"var(--white)" }}>
                          {on && <IconCheck size={14} />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {err && <div className="form-error">{err}</div>}
          </div>
          <div style={{ position:"sticky", bottom:0, background:"var(--white)", padding:"12px 0 22px", borderTop:"1px solid var(--border-lt)", marginTop:8 }}>
            <button className="btn btn-primary-teal" type="submit" disabled={mutating} style={{ width:"100%" }}>
              {mutating ? t("groups.creating") : t("groups.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
