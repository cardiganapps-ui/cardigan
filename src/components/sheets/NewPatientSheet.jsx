import { useState, useMemo } from "react";
import { DAY_ORDER } from "../../data/seedData";
import { todayISO } from "../../utils/dates";
import { formatPhoneMX, phoneDigits } from "../../utils/contact";
import { Toggle } from "../Toggle";
import { IconX } from "../Icons";
import { MoneyInput } from "../MoneyInput";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useT } from "../../i18n/index";

// Weekdays + hours to search through when picking a sensible default
// for the first recurring slot. Weekday-major, then by hour — the
// common case is a therapist filling mornings of one day before
// moving to the next. Sábado is included as a last resort.
const SLOT_SEARCH_DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const SLOT_SEARCH_TIMES = [
  "09:00", "10:00", "11:00", "12:00", "13:00",
  "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00",
];

/**
 * Find the first day/time combination that isn't already booked, either
 * by an existing scheduled session for any patient or by a slot the
 * user has already added in the form. Used to pre-fill the first
 * schedule row and to pick a sensible default when the user clicks
 * "+ Agregar otro horario".
 */
function findEmptySlot(sessions, extraTaken) {
  const taken = new Set([
    ...((sessions || []).filter(s => s.status === "scheduled").map(s => `${s.day}|${s.time}`)),
    ...(extraTaken || []),
  ]);
  for (const day of SLOT_SEARCH_DAYS) {
    for (const time of SLOT_SEARCH_TIMES) {
      if (!taken.has(`${day}|${time}`)) return { day, time };
    }
  }
  // Whole search space is full — fall back to the original hardcoded
  // default. The conflict banner will still warn the user.
  return { day: "Lunes", time: "16:00" };
}

export function NewPatientSheet({ onClose, onSubmit, mutating, patients, sessions }) {
  const { t } = useT();
  useEscape(onClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose);
  const setPanel = (el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  // Two-step flow: 1 = essentials + schedule, 2 = contact + birthdate.
  // Step 2 fields are entirely optional but the user must pass through
  // it so they confirm the completed profile rather than creating half
  // a patient by tapping out of a collapsed "advanced" section.
  const [step, setStep] = useState(1);

  // Essentials
  const [name, setName] = useState("");
  const [isMinor, setIsMinor] = useState(false);
  const [parent, setParent] = useState("");
  const [rate, setRate] = useState("");
  const [tutorFrequency, setTutorFrequency] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // Birthdate defaults to today so the control renders a filled-in
  // date picker; we track "untouched" so the placeholder-ish styling
  // doesn't lock us into saving today's date as birthdate.
  const [birthdate, setBirthdate] = useState(todayISO());
  const birthdateUntouched = birthdate === todayISO();

  // Schedule defaults are computed once on mount from the calendar —
  // we don't want them to bounce around if `sessions` updates while
  // the user is typing.
  const [schedules, setSchedules] = useState(() => {
    const slot = findEmptySlot(sessions, []);
    return [{ ...slot, duration: "60", modality: "presencial" }];
  });
  const [startDate, setStartDate] = useState(todayISO());
  const [hasEndDate, setHasEndDate] = useState(false);
  const [endDate, setEndDate] = useState("");

  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // External conflicts: any form schedule collides with an existing
  // scheduled session for another patient at the same day/time.
  // Internal conflicts: the form has two schedule rows at the same
  // day/time (can happen after user edits). Both block progression.
  const { externalConflicts, internalConflictRows } = useMemo(() => {
    const external = [];
    const internal = new Set();
    const seen = new Map(); // `${day}|${time}` -> first row index
    for (let i = 0; i < schedules.length; i++) {
      const s = schedules[i];
      const key = `${s.day}|${s.time}`;
      if (seen.has(key)) { internal.add(i); internal.add(seen.get(key)); }
      else seen.set(key, i);
      const match = (sessions || []).find(
        x => x.status === "scheduled" && x.day === s.day && x.time === s.time
      );
      if (match) external.push({ row: i, match });
    }
    return { externalConflicts: external, internalConflictRows: [...internal] };
  }, [schedules, sessions]);

  const hasConflict = externalConflicts.length > 0 || internalConflictRows.length > 0;

  const updateSched = (i, f, v) => setSchedules(prev => prev.map((s, idx) => idx === i ? { ...s, [f]: v } : s));
  const removeSched = (i) => setSchedules(prev => prev.filter((_, idx) => idx !== i));
  const addSched = () => {
    setSchedules(prev => {
      const extraTaken = prev.map(s => `${s.day}|${s.time}`);
      const slot = findEmptySlot(sessions, extraTaken);
      return [...prev, { ...slot, duration: "60", modality: "presencial" }];
    });
  };

  // Gate for moving from step 1 to step 2 — all fields required to
  // create a patient with a schedule must be valid AND conflict-free.
  const canAdvance = !!name.trim() && Number(rate) > 0 && schedules.length > 0 && !hasConflict;

  const goNext = () => {
    if (!name.trim()) { setErr(t("patients.enterName")); return; }
    if (patients?.some(p => p.name.toLowerCase() === name.trim().toLowerCase())) {
      setErr(t("patients.duplicateName")); return;
    }
    if (!Number(rate) && rate !== "0") { setErr(t("patients.enterRate")); return; }
    if (hasConflict) { setErr(t("patients.resolveConflicts")); return; }
    setErr("");
    setStep(2);
    // Scroll to top on step change so the user sees the first field
    // rather than landing mid-scroll.
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  const goBack = () => {
    setErr("");
    setStep(1);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (step === 1) { goNext(); return; }
    // Step 2: final validation — nothing new is required, but re-check
    // gate in case user bounced back to step 1 and introduced a
    // conflict before coming back.
    if (!canAdvance) { setStep(1); setErr(t("patients.resolveConflicts")); return; }
    setErr("");
    setSubmitting(true);
    try {
      const ok = await onSubmit({
        name, parent: isMinor ? parent : "", rate: Number(rate) || 0,
        tutorFrequency: isMinor && tutorFrequency ? Number(tutorFrequency) : null,
        phone: phoneDigits(phone), email: email.trim(),
        birthdate: (birthdate && !birthdateUntouched) ? birthdate : null,
        schedules, recurring: true,
        startDate,
        endDate: hasEndDate ? endDate : null,
      });
      if (ok) onClose();
      else setSubmitting(false);
    } catch (ex) {
      setErr(ex?.message || "Error al guardar");
      setSubmitting(false);
    }
  };

  const scheduleRowCols = schedules.length > 1 ? "1fr 1fr 70px 90px 28px" : "1fr 1fr 70px 90px";

  return (
    <div className="sheet-overlay" onClick={submitting ? undefined : onClose}>
      <div ref={setPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...panelHandlers} style={{ maxHeight:"92vh", position:"relative" }}>
        {submitting && (
          <div role="status" aria-live="polite"
            style={{ position:"absolute", inset:0, background:"var(--white)", zIndex:2,
              display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
              padding:"40px 24px", gap:14, animation:"fadeIn 0.18s ease" }}>
            <div aria-hidden
              style={{ width:46, height:46, borderRadius:"50%",
                border:"3px solid var(--cream-deeper)", borderTopColor:"var(--teal)",
                animation:"ptr-spin 0.9s linear infinite" }} />
            <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:800, color:"var(--charcoal)", textAlign:"center" }}>
              {t("patients.configuring")}
            </div>
            <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)", textAlign:"center" }}>
              {t("patients.configuringHint")}
            </div>
          </div>
        )}
        <div className="sheet-handle" />
        <div className="sheet-header" style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
            <span className="sheet-title">{t("patients.newPatient")}</span>
            <span style={{ fontSize:11, color:"var(--charcoal-xl)", fontWeight:600 }}>
              {t("patients.stepIndicator", { current: step, total: 2 })}
            </span>
          </div>
          <button className="sheet-close" aria-label={t("close")} onClick={onClose} disabled={submitting}><IconX size={14} /></button>
        </div>

        <form onSubmit={submit} style={{ padding:"0 20px 0" }}>
          <div>

          {step === 1 && (
            <>
              {/* 1. Name */}
              <div className="input-group">
                <label className="input-label">
                  {t("settings.fullName")}
                  <span style={{ color:"var(--red)", marginLeft:4 }} aria-hidden>*</span>
                </label>
                <input className="input" type="text" required value={name} onChange={e => setName(e.target.value)} placeholder={t("patients.namePlaceholder")} />
              </div>

              {/* 2. Minor toggle — second question, immediately after name */}
              <div
                onClick={() => setIsMinor(v => !v)}
                style={{
                  display:"flex", alignItems:"center", justifyContent:"space-between",
                  padding:"14px 16px", marginBottom:14, cursor:"pointer",
                  borderRadius:"var(--radius)", border: isMinor ? "1.5px solid var(--purple)" : "1.5px solid var(--border-lt)",
                  background: isMinor ? "var(--purple-bg)" : "var(--white)",
                  transition: "all 0.4s",
                }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:700, color: isMinor ? "var(--purple)" : "var(--charcoal)" }}>{t("patients.isMinor")}</div>
                  <div style={{ fontSize:11, color:"var(--charcoal-xl)", marginTop:2 }}>{t("patients.isMinorHint")}</div>
                </div>
                <Toggle on={isMinor} onToggle={() => {}} />
              </div>

              {/* Tutor details — inline when minor is on, so the user
                  sets the immediate relationship before moving on. */}
              {isMinor && (
                <div className="input-group">
                  <label className="input-label">{t("patients.tutor")}</label>
                  <input className="input" type="text" value={parent} onChange={e => setParent(e.target.value)} placeholder={t("patients.tutorPlaceholder")} />
                </div>
              )}

              {/* 3. Rate */}
              <div className="input-group">
                <label className="input-label">
                  {t("patients.ratePerSession")}
                  <span style={{ color:"var(--red)", marginLeft:4 }} aria-hidden>*</span>
                </label>
                <MoneyInput min="0" step="50" required value={rate} onChange={e => setRate(e.target.value)} placeholder={t("patients.ratePlaceholder")} />
                <div style={{ fontSize:11, color:"var(--charcoal-xl)", marginTop:2 }}>{t("patients.rateHint")}</div>
              </div>

              {/* 4. Schedule */}
              <div style={{ fontSize:13, fontWeight:700, color:"var(--charcoal)", margin:"18px 0 10px" }}>{t("patients.schedules")}</div>
              {schedules.map((s, i) => {
                const hasIssue = internalConflictRows.includes(i) || externalConflicts.some(c => c.row === i);
                return (
                  <div key={i} style={{ display:"grid", gridTemplateColumns: scheduleRowCols, gap:8, marginBottom:8, alignItems:"end" }}>
                    <div className="input-group" style={{ marginBottom:0 }}>
                      {i === 0 && <label className="input-label">{t("patients.day")}</label>}
                      <select
                        className="input"
                        value={s.day}
                        onChange={e => updateSched(i, "day", e.target.value)}
                        style={hasIssue ? { borderColor:"var(--amber)" } : undefined}>
                        {DAY_ORDER.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                    <div className="input-group" style={{ marginBottom:0 }}>
                      {i === 0 && <label className="input-label">{t("patients.time")}</label>}
                      <input
                        className="input"
                        type="time"
                        value={s.time}
                        onChange={e => updateSched(i, "time", e.target.value)}
                        style={hasIssue ? { borderColor:"var(--amber)" } : undefined} />
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
                        <option value="presencial">{t("sessions.presencial")}</option>
                        <option value="virtual">{t("sessions.virtual")}</option>
                      </select>
                    </div>
                    {schedules.length > 1 && (
                      <button type="button" onClick={() => removeSched(i)}
                        style={{ width:28, height:28, borderRadius:"50%", border:"none", background:"var(--red-bg)", color:"var(--red)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                        <IconX size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
              <button type="button" onClick={addSched}
                style={{ fontSize:12, fontWeight:600, color:"var(--teal-dark)", background:"none", border:"none", cursor:"pointer", padding:"4px 0 14px", fontFamily:"var(--font)" }}>
                {t("patients.addSchedule")}
              </button>

              {externalConflicts.length > 0 && (
                <div style={{ background:"var(--amber-bg)", borderRadius:"var(--radius-sm)", padding:"8px 12px", marginBottom:12, fontSize:12, color:"var(--amber)", fontWeight:600, lineHeight:1.4 }}>
                  {externalConflicts.map((c, i) => (
                    <div key={i}>{t("sessions.conflict", { patient: c.match.patient })}</div>
                  ))}
                </div>
              )}
              {internalConflictRows.length > 0 && (
                <div style={{ background:"var(--amber-bg)", borderRadius:"var(--radius-sm)", padding:"8px 12px", marginBottom:12, fontSize:12, color:"var(--amber)", fontWeight:600, lineHeight:1.4 }}>
                  {t("patients.duplicateSchedule")}
                </div>
              )}

              {/* 5. Dates */}
              <div style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 14px", marginBottom:14 }}>
                <div className="input-group" style={{ marginBottom:10 }}>
                  <label className="input-label">{t("patients.start")}</label>
                  <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div
                  onClick={() => setHasEndDate(v => !v)}
                  style={{ display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", marginBottom: hasEndDate ? 8 : 0 }}>
                  <span style={{ fontSize:12, fontWeight:600, color:"var(--charcoal-md)" }}>{t("patients.endDate")}</span>
                  <Toggle on={hasEndDate} onToggle={() => {}} />
                </div>
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

          {step === 2 && (
            <>
              <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginBottom:14, lineHeight:1.5 }}>
                {t("patients.detailsHint")}
              </div>

              {/* Tutor frequency — only if minor, so we can surface it
                  without cluttering step 1 with another required-
                  looking select. */}
              {isMinor && (
                <div className="input-group">
                  <label className="input-label">{t("patients.tutorFrequency")}</label>
                  <select className="input" value={tutorFrequency} onChange={e => setTutorFrequency(e.target.value)}>
                    <option value="">{t("patients.frequencyNone")}</option>
                    <option value="4">{t("patients.everyNWeeks", { count: 4 })}</option>
                    <option value="6">{t("patients.everyNWeeks", { count: 6 })}</option>
                    <option value="8">{t("patients.everyNWeeks", { count: 8 })}</option>
                    <option value="12">{t("patients.everyNWeeks", { count: 12 })}</option>
                  </select>
                  <div style={{ fontSize:11, color: tutorFrequency ? "var(--teal-dark)" : "var(--charcoal-xl)", marginTop:2 }}>
                    {tutorFrequency
                      ? t("patients.tutorFrequencyConfirm", { count: tutorFrequency })
                      : t("patients.tutorFrequencyHint")}
                  </div>
                </div>
              )}

              {/* Contact info */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div className="input-group">
                  <label className="input-label">{t("patients.phone")}</label>
                  <input className="input" type="tel" inputMode="tel" autoComplete="tel"
                    value={phone}
                    onChange={e => setPhone(formatPhoneMX(e.target.value))}
                    placeholder={t("patients.phonePlaceholder")} />
                </div>
                <div className="input-group">
                  <label className="input-label">{t("settings.email")}</label>
                  <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t("patients.emailPlaceholder")} />
                </div>
              </div>
              <div className="input-group">
                <label className="input-label">{t("patients.birthdate")}</label>
                <input className="input" type="date" value={birthdate} onChange={e => setBirthdate(e.target.value)}
                  style={{ height: 52, fontSize: 16, padding: "14px 14px",
                    color: birthdateUntouched ? "var(--charcoal-xl)" : "var(--charcoal)",
                  }} />
              </div>
            </>
          )}

          {err && <div className="form-error">{err}</div>}
          </div>

          <div style={{ position:"sticky", bottom:0, background:"var(--white)", padding:"12px 0 22px", borderTop:"1px solid var(--border-lt)", marginTop:8 }}>
            {step === 1 ? (
              <button className="btn btn-primary-teal" type="submit" disabled={!canAdvance}>
                {t("next")}
              </button>
            ) : (
              <div style={{ display:"flex", gap:10 }}>
                <button type="button" className="btn btn-secondary" onClick={goBack}
                  style={{ flex:"0 0 auto", padding:"0 20px" }}>
                  {t("back")}
                </button>
                <button className="btn btn-primary-teal" type="submit" disabled={mutating} style={{ flex:1 }}>
                  {mutating ? t("saving") : t("patients.addPatient")}
                </button>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
