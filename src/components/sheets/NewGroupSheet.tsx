import { useState, useMemo } from "react";
import { todayISO, parseLocalDate } from "../../utils/dates";
import { IconX, IconCheck, IconSearch, IconArrowLeft } from "../Icons";
import { MoneyInput } from "../MoneyInput";
import { Avatar } from "../Avatar";
import { SegmentedControl } from "../SegmentedControl";
import { useT } from "../../i18n/index";
import { useCardiganMain } from "../../context/CardiganContext";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useSheetExit } from "../../hooks/useSheetExit";
import { getModalitiesForProfession, MODALITY_I18N_KEY, RECURRENCE_FREQUENCY, isPotentialOrDiscarded, PATIENT_STATUS } from "../../data/constants";
import { getClientColor } from "../../data/seedData";
import { SheetOverlay } from "../SheetOverlay";

const FREQ_OPTS = [
  { k: RECURRENCE_FREQUENCY.WEEKLY,   l: "patients.frequencyWeekly" },
  { k: RECURRENCE_FREQUENCY.BIWEEKLY, l: "patients.frequencyBiweekly" },
  { k: RECURRENCE_FREQUENCY.MONTHLY,  l: "patients.frequencyMonthly" },
];

const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
// Indexed by Date.getDay() (0=Sunday) for deriving a one-off's weekday.
const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/* Create a group in TWO steps:
   1. Details — name + schedule (day/time/duration/modality/frequency) + flat
      rate + a "sesión única" one-off toggle.
   2. Members — the full existing-patient list with search + status filter, so
      ANY patient can be added (a patient may belong to several groups; the DB
      only forbids the same patient being active twice in the SAME group).
   On submit createGroup fans out the initial window of member sessions. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed patient rows
type Row = any;

export function NewGroupSheet({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const { profession, patients, createGroup, mutating } = useCardiganMain();
  const modalities = getModalitiesForProfession(profession);
  const { exiting, animatedClose } = useSheetExit(true, onClose);
  useEscape(mutating ? () => {} : animatedClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(mutating ? () => {} : onClose);
  const setPanel = (el: HTMLElement | null) => { panelRef.current = el; scrollRef.current = el; setPanelEl(el); };

  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [oneOff, setOneOff] = useState(false);
  const [day, setDay] = useState("Sábado");
  const [time, setTime] = useState("10:00");
  const [date, setDate] = useState(todayISO());
  const [duration, setDuration] = useState("60");
  const [modality, setModality] = useState("presencial");
  const [frequency, setFrequency] = useState("weekly");
  const [rate, setRate] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active"); // active | all
  const [err, setErr] = useState("");

  // Real patients only (exclude interview-stage potentials/discarded).
  const eligible = useMemo(() => patients.filter((p: Row) => !isPotentialOrDiscarded(p)), [patients]);
  const listed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return eligible
      .filter((p: Row) => statusFilter === "all" ? true : p.status === PATIENT_STATUS.ACTIVE)
      .filter((p: Row) => !q || p.name.toLowerCase().includes(q) || (p.initials || "").toLowerCase().includes(q))
      .sort((a: Row, b: Row) => a.name.localeCompare(b.name));
  }, [eligible, search, statusFilter]);

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const goToMembers = () => {
    if (!name.trim()) { setErr(t("groups.name")); return; }
    setErr("");
    setStep(2);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    // A one-off group still needs a (day, time) slot so the single
    // occurrence can be minted — derive the weekday from the chosen date
    // and constrain generation to that one day (startDate === endDate).
    const oneOffDay = oneOff ? WEEKDAYS[parseLocalDate(date).getDay()] : day;
    const payload = {
      name: name.trim(),
      day: oneOffDay,
      time, duration: Number(duration) || 60,
      rate: rate === "" ? null : Number(rate),
      modality, frequency,
      schedulingMode: oneOff ? "episodic" : "recurring",
      memberPatientIds: [...selected],
      startDate: date,
      endDate: oneOff ? date : undefined,
      generate: true,
    };
    try {
      const res = await createGroup(payload);
      if (res) animatedClose();
      else setErr("No se pudo crear el grupo. Intenta de nuevo.");
    } catch (ex) { setErr((ex as Error)?.message || "Error"); }
  };

  return (
    <SheetOverlay exiting={exiting} onClose={mutating ? undefined : animatedClose}>
      <div ref={setPanel} className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`} role="dialog" aria-modal="true" aria-label={step === 1 ? t("groups.new") : t("groups.addPatientsTitle")} {...panelHandlers} style={{ maxHeight:"min(92lvh, calc(100lvh - var(--sat) - 16px))" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span style={{ display:"inline-flex", alignItems:"center", gap:8, minWidth:0 }}>
            {step === 2 && (
              <button className="btn-tap" aria-label="Atrás" onClick={() => setStep(1)}
                style={{ background:"none", border:"none", color:"var(--charcoal-md)", cursor:"pointer", padding:2, display:"inline-flex" }}>
                <IconArrowLeft size={18} />
              </button>
            )}
            <span className="sheet-title">{step === 1 ? t("groups.new") : t("groups.addPatientsTitle")}</span>
          </span>
          <button className="sheet-close" aria-label={t("close")} onClick={animatedClose}><IconX size={14} /></button>
        </div>

        {/* ── Step 1: details ── */}
        {step === 1 && (
          <div style={{ padding:"0 20px 0" }}>
            <div>
              <div className="input-group">
                <label className="input-label">{t("groups.name")}<span style={{ color:"var(--red)", marginLeft:4 }} aria-hidden>*</span></label>
                <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder={t("groups.namePlaceholder")}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); goToMembers(); } }} />
              </div>

              <label aria-label={t("groups.oneOff")} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 0", cursor:"pointer" }}>
                <input type="checkbox" checked={oneOff} onChange={e => setOneOff(e.target.checked)} style={{ width:18, height:18 }} />
                <span>
                  <span style={{ fontWeight:700, fontSize:"var(--text-md)" }}>{t("groups.oneOff")}</span>
                  <span style={{ display:"block", fontSize:"var(--text-sm)", color:"var(--charcoal-xl)" }}>{t("groups.oneOffHint")}</span>
                </span>
              </label>

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
                  <label className="input-label">{t("patients.frequency")}</label>
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

              {err && <div className="form-error">{err}</div>}
            </div>
            <div style={{ position:"sticky", bottom:0, background:"var(--white)", padding:"12px 0 22px", borderTop:"1px solid var(--border-lt)", marginTop:8 }}>
              <button className="btn btn-primary-teal" type="button" onClick={goToMembers} style={{ width:"100%" }}>
                {t("groups.continueToMembers")}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: members ── */}
        {step === 2 && (
          <div style={{ padding:"0 20px 0" }}>
            <div className="search-bar" style={{ marginBottom:10 }}>
              <span style={{ color:"var(--charcoal-xl)" }}><IconSearch size={16} /></span>
              <input type="search" placeholder={t("patients.searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <SegmentedControl
              items={[{ k: "active", l: t("patients.active") }, { k: "all", l: t("groups.allFilter") }]}
              value={statusFilter} onChange={setStatusFilter} size="sm" ariaLabel={t("groups.addPatientsTitle")} />
            <div className="card scroll-bounce" style={{ marginTop:12, maxHeight:"52lvh", overflowY:"auto" }}>
              {listed.length === 0 ? (
                <div className="input-help" style={{ padding:"16px" }}>{t("patients.noResults")}</div>
              ) : (
                listed.map((p: Row, i: number) => {
                  const on = selected.has(p.id);
                  const ended = p.status !== PATIENT_STATUS.ACTIVE;
                  return (
                    <button key={p.id} type="button" className="row-item btn-tap" onClick={() => toggle(p.id)}
                      style={{ width:"100%", border:"none", background: on ? "var(--teal-mist)" : "transparent", textAlign:"left", cursor:"pointer" }}>
                      <Avatar initials={p.initials} color={getClientColor(i)} size="sm" />
                      <div className="row-content">
                        <div className="row-title">{p.name}</div>
                        {ended && <div className="row-sub">{t("patients.ended")}</div>}
                      </div>
                      <span aria-hidden style={{ width:22, height:22, borderRadius:"var(--radius-pill)", display:"inline-flex", alignItems:"center", justifyContent:"center", border: on ? "none" : "2px solid var(--border)", background: on ? "var(--teal)" : "transparent", color:"var(--white)" }}>
                        {on && <IconCheck size={14} />}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            {err && <div className="form-error" style={{ marginTop:8 }}>{err}</div>}
            <div style={{ position:"sticky", bottom:0, background:"var(--white)", padding:"12px 0 22px", borderTop:"1px solid var(--border-lt)", marginTop:8 }}>
              <button className="btn btn-primary-teal" type="button" onClick={submit} disabled={mutating} style={{ width:"100%" }}>
                {mutating ? t("groups.creating") : `${t("groups.create")}${selected.size > 0 ? ` · ${selected.size}` : ""}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </SheetOverlay>
  );
}
