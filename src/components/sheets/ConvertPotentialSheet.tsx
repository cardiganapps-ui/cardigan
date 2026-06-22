import { useState, useMemo } from "react";
import { DAY_ORDER } from "../../data/seedData";
import { todayISO } from "../../utils/dates";
import { Toggle } from "../Toggle";
import { IconX } from "../Icons";
import { MoneyInput } from "../MoneyInput";
import { SegmentedControl } from "../SegmentedControl";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useSheetExit } from "../../hooks/useSheetExit";
import { useLayer } from "../../hooks/useLayer";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import {
  getModalitiesForProfession, MODALITY_I18N_KEY,
  SCHEDULING_MODE, defaultSchedulingMode, usesAnthropometrics,
  RECURRENCE_FREQUENCY, DEFAULT_RECURRENCE_FREQUENCY,
} from "../../data/constants";

/* ── ConvertPotentialSheet ────────────────────────────────────────
   Promotion sheet — fills in the data we didn't collect at potential-
   creation time so the row can graduate to a fully-fledged active
   patient. Standalone (not an extension of NewPatientSheet) so the
   two-step / dedupe / conflict-detection complexity over there
   doesn't bleed into this much shorter form.

   Inputs prefilled from the existing potential row:
     • name, parent, phone, email, birthdate, rate
   Asked here:
     • scheduling mode (recurring / episodic — defaults per profession)
     • schedules (recurring) or optional first consult (episodic)
     • start date
     • new rate (the practitioner often charges the recurring rate
       differently than the interview tariff — pre-filled with the
       potential's rate but editable)
     • tutor frequency for minor patients
     • anthropometric fields for nutritionist + trainer

   Submits via convertPotentialToActive() in usePatients which
   updates the patient row in place (preserving payments / notes /
   the interview session) and seeds the new schedule. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed potential row + schedule entries
type Row = any;
interface Schedule { day: string; time: string; duration: string; modality: string; frequency: string }

export function ConvertPotentialSheet({ potential, onClose, onSubmit, mutating }: {
  potential?: Row;
  onClose: () => void;
  onSubmit: (id: string, payload: Row) => Promise<boolean> | boolean;
  mutating?: boolean;
}) {
  const { t } = useT();
  const { profession } = useCardigan();
  const modalities = getModalitiesForProfession(profession);
  const { exiting, animatedClose } = useSheetExit(true, onClose);
  useEscape(animatedClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose);
  useLayer("convert-potential", animatedClose);
  const setPanel = (el: HTMLElement | null) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  // Prefill from the potential's known data.
  const [rate, setRate] = useState(String(potential?.rate ?? ""));
  const [tutorFrequency, setTutorFrequency] = useState(potential?.tutor_frequency ? String(potential.tutor_frequency) : "");
  const [birthdate, setBirthdate] = useState(potential?.birthdate || "");

  const [schedulingMode, setSchedulingMode] = useState(() => defaultSchedulingMode(profession));
  const isEpisodicMode = schedulingMode === SCHEDULING_MODE.EPISODIC;

  const [schedules, setSchedules] = useState<Schedule[]>([
    { day: "Lunes", time: "16:00", duration: "60", modality: modalities[0] || "presencial", frequency: DEFAULT_RECURRENCE_FREQUENCY },
  ]);
  const [startDate, setStartDate] = useState(todayISO());
  const [hasEndDate, setHasEndDate] = useState(false);
  const [endDate, setEndDate] = useState("");

  // Episodic patients can either schedule the next visit immediately
  // or skip and book it later from Resumen — same affordance as
  // NewPatientSheet's episodic flow.
  const [skipFirstConsult, setSkipFirstConsult] = useState(false);
  const [firstConsultDate, setFirstConsultDate] = useState(todayISO());
  const [firstConsultTime, setFirstConsultTime] = useState("10:00");
  const [firstConsultDuration, setFirstConsultDuration] = useState("60");
  const [firstConsultModality, setFirstConsultModality] = useState(modalities[0] || "presencial");

  const showHealthFields = usesAnthropometrics(profession);
  const [heightCm, setHeightCm] = useState(potential?.height_cm ? String(potential.height_cm) : "");
  const [goalWeightKg, setGoalWeightKg] = useState(potential?.goal_weight_kg ? String(potential.goal_weight_kg) : "");
  const [goalBodyFatPct, setGoalBodyFatPct] = useState(potential?.goal_body_fat_pct ? String(potential.goal_body_fat_pct) : "");
  const [goalSkeletalMuscleKg, setGoalSkeletalMuscleKg] = useState(potential?.goal_skeletal_muscle_kg ? String(potential.goal_skeletal_muscle_kg) : "");
  const [allergies, setAllergies] = useState(potential?.allergies || "");
  const [medicalConditions, setMedicalConditions] = useState(potential?.medical_conditions || "");

  const [err, setErr] = useState("");

  const updateSched = (i: number, k: keyof Schedule, v: string) => setSchedules(prev => prev.map((s, idx) => idx === i ? { ...s, [k]: v } : s));
  const addSched = () => setSchedules(prev => [...prev, { day: "Lunes", time: "16:00", duration: "60", modality: modalities[0] || "presencial", frequency: DEFAULT_RECURRENCE_FREQUENCY }]);
  const removeSched = (i: number) => setSchedules(prev => prev.filter((_, idx) => idx !== i));

  // Internal duplicate detection — two rows with the same (day, time)
  // would race against the DB unique index.
  const internalConflictRows = useMemo(() => {
    const seen = new Map<string, number>();
    const dupes: number[] = [];
    schedules.forEach((s, i) => {
      const k = `${s.day}|${s.time}`;
      if (seen.has(k)) {
        dupes.push(seen.get(k)!);
        dupes.push(i);
      } else {
        seen.set(k, i);
      }
    });
    return Array.from(new Set(dupes));
  }, [schedules]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!potential) { animatedClose(); return; }
    if (rate === "" || Number.isNaN(Number(rate))) { setErr(t("patients.enterRate")); return; }
    if (!isEpisodicMode && internalConflictRows.length > 0) { setErr(t("patients.duplicateSchedule")); return; }
    setErr("");

    const payload = {
      rate: Math.max(0, Number(rate) || 0),
      // Don't pass parent/phone/email/birthdate as nullable overrides —
      // we want the potential's existing values to stick unless the
      // user explicitly edits them. Birthdate is editable here as a
      // small affordance (some practitioners learn DOB during the
      // interview) and only forwarded if non-empty.
      birthdate: birthdate || null,
      tutorFrequency: tutorFrequency ? Number(tutorFrequency) : null,
      schedulingMode: isEpisodicMode ? "episodic" : "recurring",
      schedules: isEpisodicMode ? null : schedules,
      startDate: isEpisodicMode ? null : startDate,
      endDate: !isEpisodicMode && hasEndDate ? endDate : null,
      firstConsult: (isEpisodicMode && !skipFirstConsult)
        ? { date: firstConsultDate, time: firstConsultTime, duration: Number(firstConsultDuration) || 60, modality: firstConsultModality }
        : null,
      heightCm: showHealthFields ? Number(heightCm) || null : null,
      goalWeightKg: showHealthFields ? Number(goalWeightKg) || null : null,
      goalBodyFatPct: showHealthFields ? Number(goalBodyFatPct) || null : null,
      goalSkeletalMuscleKg: showHealthFields ? Number(goalSkeletalMuscleKg) || null : null,
      allergies: showHealthFields ? allergies : "",
      medicalConditions: showHealthFields ? medicalConditions : "",
    };

    try {
      const ok = await onSubmit(potential.id, payload);
      if (ok) animatedClose();
    } catch (ex) {
      setErr((ex as Error)?.message || "Error al guardar");
    }
  };

  if (!potential) return null;

  return (
    <div className={`sheet-overlay ${exiting ? "sheet-overlay--exit" : ""}`} onClick={animatedClose}>
      <div ref={setPanel} className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`} role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...panelHandlers} style={{ maxHeight:"min(92lvh, calc(100lvh - var(--sat) - 16px))" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("patients.convertingTitle")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={animatedClose}><IconX size={14} /></button>
        </div>

        <form onSubmit={submit} style={{ padding:"0 20px 0" }}>
          {/* What we know about the potential — read-only summary so
              the practitioner sees who they're converting and what's
              already on the record. Editing name/contact happens via
              the Patients screen post-conversion. */}
          <div style={{ background:"var(--rose-bg)", borderRadius:"var(--radius)", padding:"12px 14px", marginBottom:14 }}>
            <div style={{ fontSize:"var(--text-eyebrow)", textTransform:"uppercase", letterSpacing:0.3, fontWeight:700, color:"var(--rose)", marginBottom:4 }}>
              {t("patients.statusPotential")}
            </div>
            <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:800, color:"var(--charcoal)", marginBottom:2 }}>
              {potential.name}
            </div>
            <div style={{ fontSize:"var(--text-xs)", color:"var(--charcoal-md)", lineHeight:1.5 }}>
              {t("patients.convertingHint")}
            </div>
          </div>

          {/* Rate (prefilled, but the active rate often differs from
              the interview tariff — let the user adjust). */}
          <div className="input-group">
            <label className="input-label">
              {t("patients.ratePerSession")}
              <span style={{ color:"var(--red)", marginLeft:4 }} aria-hidden>*</span>
            </label>
            <MoneyInput min="0" step="50" required value={rate}
              onChange={e => setRate(e.target.value)}
              placeholder={t("patients.ratePlaceholder")} />
          </div>

          {/* Scheduling mode toggle */}
          <div style={{ marginBottom:14 }}>
            <SegmentedControl
              items={[
                { k: SCHEDULING_MODE.RECURRING, l: t("patients.recurringAppts") },
                { k: SCHEDULING_MODE.EPISODIC,  l: t("patients.notRecurring") },
              ]}
              value={schedulingMode}
              onChange={setSchedulingMode}
              ariaLabel={t("patients.schedules")}
            />
          </div>

          {/* RECURRING block — schedules array + start/end date */}
          {!isEpisodicMode && (
            <>
              <div style={{ fontSize:13, fontWeight:700, color:"var(--charcoal)", margin:"6px 0 10px" }}>{t("patients.schedules")}</div>
              {schedules.map((s, i) => {
                const hasIssue = internalConflictRows.includes(i);
                return (
                  <div key={i} style={{ marginBottom:10 }}>
                    <div style={{ display:"grid", gridTemplateColumns: schedules.length > 1 ? "1.1fr 1fr 0.9fr 1fr 24px" : "1.1fr 1fr 0.9fr 1fr", gap:8, alignItems:"end" }}>
                      <div className="input-group" style={{ marginBottom:0 }}>
                        {i === 0 && <label className="input-label">{t("patients.day")}</label>}
                        <select className="input" value={s.day} onChange={e => updateSched(i, "day", e.target.value)} style={hasIssue ? { borderColor:"var(--amber)" } : undefined}>
                          {DAY_ORDER.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </div>
                      <div className="input-group" style={{ marginBottom:0 }}>
                        {i === 0 && <label className="input-label">{t("patients.time")}</label>}
                        <input className="input" type="time" value={s.time} onChange={e => updateSched(i, "time", e.target.value)} style={hasIssue ? { borderColor:"var(--amber)" } : undefined} />
                      </div>
                      <div className="input-group" style={{ marginBottom:0 }}>
                        {i === 0 && <label className="input-label">{t("sessions.duration")}</label>}
                        <select className="input" value={s.duration || "60"} onChange={e => updateSched(i, "duration", e.target.value)}>
                          <option value="30">30m</option>
                          <option value="45">45m</option>
                          <option value="60">1h</option>
                          <option value="90">1½h</option>
                          <option value="120">2h</option>
                        </select>
                      </div>
                      <div className="input-group" style={{ marginBottom:0 }}>
                        {i === 0 && <label className="input-label">{t("sessions.modality")}</label>}
                        <select className="input" value={s.modality || "presencial"} onChange={e => updateSched(i, "modality", e.target.value)}>
                          {modalities.map(m => (
                            <option key={m} value={m}>{t(`sessions.${MODALITY_I18N_KEY[m]}`)}</option>
                          ))}
                        </select>
                      </div>
                      {schedules.length > 1 && (
                        <button type="button" onClick={() => removeSched(i)}
                          style={{ width:24, height:24, borderRadius:"50%", border:"none", background:"var(--red-bg)", color:"var(--red)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0 }}>
                          <IconX size={11} />
                        </button>
                      )}
                    </div>
                    <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:11, color:"var(--charcoal-md)", fontWeight:600, flexShrink:0 }}>
                        {t("patients.frequency")}
                      </span>
                      <SegmentedControl
                        items={[
                          { k: RECURRENCE_FREQUENCY.WEEKLY,   l: t("patients.frequencyWeekly") },
                          { k: RECURRENCE_FREQUENCY.BIWEEKLY, l: t("patients.frequencyBiweekly") },
                          { k: RECURRENCE_FREQUENCY.MONTHLY,  l: t("patients.frequencyMonthly") },
                        ]}
                        value={s.frequency || DEFAULT_RECURRENCE_FREQUENCY}
                        onChange={(v) => updateSched(i, "frequency", v)}
                        ariaLabel={t("patients.frequency")}
                        style={{ flex:1 }}
                      />
                    </div>
                  </div>
                );
              })}
              <button type="button" onClick={addSched}
                style={{ fontSize:12, fontWeight:600, color:"var(--teal-dark)", background:"none", border:"none", cursor:"pointer", padding:"4px 0 14px", fontFamily:"var(--font)" }}>
                {t("patients.addSchedule")}
              </button>

              {internalConflictRows.length > 0 && (
                <div style={{ background:"var(--amber-bg)", borderRadius:"var(--radius-sm)", padding:"8px 12px", marginBottom:12, fontSize:12, color:"var(--amber)", fontWeight:600, lineHeight:1.4 }}>
                  {t("patients.duplicateSchedule")}
                </div>
              )}

              <div style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 14px", marginBottom:14 }}>
                <div className="input-group" style={{ marginBottom:10 }}>
                  <label className="input-label">{t("patients.start")}</label>
                  <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <button
                  type="button"
                  className="btn-tap"
                  aria-pressed={hasEndDate}
                  onClick={() => setHasEndDate(v => !v)}
                  style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: hasEndDate ? 8 : 0, width:"100%", background:"transparent", border:"none", padding:0, cursor:"pointer", textAlign:"left", color:"inherit", font:"inherit" }}>
                  <span style={{ fontSize:12, fontWeight:600, color:"var(--charcoal-md)" }}>{t("patients.endDate")}</span>
                  <Toggle on={hasEndDate} onToggle={() => {}} />
                </button>
                {hasEndDate ? (
                  <div className="input-group" style={{ marginBottom:0 }}>
                    <input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                  </div>
                ) : (
                  <div style={{ fontSize:11, color:"var(--charcoal-xl)", marginTop:4 }}>{t("patients.permanent")}</div>
                )}
              </div>
            </>
          )}

          {/* EPISODIC block — single optional first consult */}
          {isEpisodicMode && (
            <div style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 14px", marginBottom:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: skipFirstConsult ? 0 : 10 }}>
                <span style={{ fontSize:13, fontWeight:700, color:"var(--charcoal)" }}>
                  {t("patients.scheduleFirst") || t("sessions.scheduleFirst")}
                </span>
                <Toggle on={!skipFirstConsult} onToggle={() => setSkipFirstConsult(v => !v)} />
              </div>
              {!skipFirstConsult && (
                <>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <div className="input-group">
                      <label className="input-label">{t("sessions.date")}</label>
                      <input className="input" type="date" value={firstConsultDate} onChange={e => setFirstConsultDate(e.target.value)} />
                    </div>
                    <div className="input-group">
                      <label className="input-label">{t("patients.time")}</label>
                      <input className="input" type="time" value={firstConsultTime} onChange={e => setFirstConsultTime(e.target.value)} />
                    </div>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <div className="input-group" style={{ marginBottom:0 }}>
                      <label className="input-label">{t("sessions.duration")}</label>
                      <select className="input" value={firstConsultDuration} onChange={e => setFirstConsultDuration(e.target.value)}>
                        <option value="30">30m</option>
                        <option value="45">45m</option>
                        <option value="60">1h</option>
                        <option value="90">1½h</option>
                        <option value="120">2h</option>
                      </select>
                    </div>
                    <div className="input-group" style={{ marginBottom:0 }}>
                      <label className="input-label">{t("sessions.modality")}</label>
                      <select className="input" value={firstConsultModality} onChange={e => setFirstConsultModality(e.target.value)}>
                        {modalities.map(m => (
                          <option key={m} value={m}>{t(`sessions.${MODALITY_I18N_KEY[m]}`)}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Tutor frequency for minors (uses the existing parent on
              the potential row) */}
          {potential.parent && (
            <div className="input-group">
              <label className="input-label">{t("patients.tutorFrequency")}</label>
              <select className="input" value={tutorFrequency} onChange={e => setTutorFrequency(e.target.value)}>
                <option value="">{t("patients.frequencyNone")}</option>
                <option value="4">{t("patients.everyNWeeks", { count: 4 })}</option>
                <option value="6">{t("patients.everyNWeeks", { count: 6 })}</option>
                <option value="8">{t("patients.everyNWeeks", { count: 8 })}</option>
                <option value="12">{t("patients.everyNWeeks", { count: 12 })}</option>
              </select>
            </div>
          )}

          {/* Birthdate (optional) */}
          <div className="input-group">
            <label className="input-label">{t("patients.birthdate")}</label>
            <input className="input" type="date" value={birthdate} onChange={e => setBirthdate(e.target.value)} />
          </div>

          {/* Anthropometric / health-history — nutritionist + trainer */}
          {showHealthFields && (
            <div style={{ background:"var(--green-bg)", borderRadius:"var(--radius)", padding:"12px 14px", marginBottom:14 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div className="input-group">
                  <label className="input-label">Estatura (cm)</label>
                  <input className="input" type="number" min="50" max="250" value={heightCm} onChange={e => setHeightCm(e.target.value)} />
                </div>
                <div className="input-group">
                  <label className="input-label">Peso meta (kg)</label>
                  <input className="input" type="number" min="20" max="300" step="0.1" value={goalWeightKg} onChange={e => setGoalWeightKg(e.target.value)} />
                </div>
                <div className="input-group" style={{ marginBottom:0 }}>
                  <label className="input-label">% grasa meta</label>
                  <input className="input" type="number" min="3" max="60" step="0.1" value={goalBodyFatPct} onChange={e => setGoalBodyFatPct(e.target.value)} />
                </div>
                <div className="input-group" style={{ marginBottom:0 }}>
                  <label className="input-label">Músculo meta (kg)</label>
                  <input className="input" type="number" min="5" max="100" step="0.1" value={goalSkeletalMuscleKg} onChange={e => setGoalSkeletalMuscleKg(e.target.value)} />
                </div>
              </div>
              <div className="input-group" style={{ marginTop:10 }}>
                <label className="input-label">Alergias</label>
                <input className="input" value={allergies} onChange={e => setAllergies(e.target.value)} />
              </div>
              <div className="input-group" style={{ marginBottom:0 }}>
                <label className="input-label">Antecedentes médicos</label>
                <input className="input" value={medicalConditions} onChange={e => setMedicalConditions(e.target.value)} />
              </div>
            </div>
          )}

          {err && <div className="form-error">{err}</div>}

          <div style={{ position:"sticky", bottom:0, background:"var(--white)", padding:"12px 0 22px", borderTop:"1px solid var(--border-lt)", marginTop:8 }}>
            <button className="btn btn-primary-teal" type="submit" disabled={mutating || rate === ""}>
              {mutating ? t("saving") : t("patients.convertToPatient")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
