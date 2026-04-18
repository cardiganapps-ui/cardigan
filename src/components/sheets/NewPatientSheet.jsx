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

export function NewPatientSheet({ onClose, onSubmit, mutating, patients, sessions }) {
  const { t, strings } = useT();
  useEscape(onClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose);
  // Panel is also its own scroll container — triple-assign so focus trap,
  // drag scroll reference, and direct DOM handle all point at the same
  // element.
  const setPanel = (el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  // Step 1: patient info, Step 2: schedule
  const [step, setStep] = useState(1);

  // Step 1 fields
  const [name, setName]       = useState("");
  const [isMinor, setIsMinor] = useState(false);
  const [parent, setParent]   = useState("");
  const [rate, setRate]       = useState("");
  const [tutorFrequency, setTutorFrequency] = useState("");
  const [phone, setPhone]     = useState("");
  const [email, setEmail]     = useState("");
  // Birthdate "placeholder": defaults to today so the field doesn't
  // render as an empty mm/dd/yyyy stub (some users don't realize it's
  // a date picker when blank). Faded until the user changes it so
  // they know to replace it with the patient's real birthdate.
  const [birthdate, setBirthdate] = useState(todayISO());
  const birthdateUntouched = birthdate === todayISO();

  // Step 2 fields
  const [schedules, setSchedules] = useState([{ day: "Lunes", time: "16:00", duration: "60", modality: "presencial" }]);
  const [startDate, setStartDate] = useState(todayISO());
  const [hasEndDate, setHasEndDate] = useState(false);
  const [endDate, setEndDate] = useState("");

  const [err, setErr] = useState("");

  const conflicts = useMemo(() => {
    if (!sessions || !schedules.length) return [];
    return schedules.map(sched => {
      const match = sessions.find(s => s.day === sched.day && s.time === sched.time && s.status === "scheduled");
      return match || null;
    }).filter(Boolean);
  }, [schedules, sessions]);

  const updateSched = (i, f, v) => setSchedules(prev => prev.map((s, idx) => idx === i ? { ...s, [f]: v } : s));
  const removeSched = (i) => setSchedules(prev => prev.filter((_, idx) => idx !== i));

  const goToStep2 = () => {
    if (!name.trim()) { setErr(t("patients.enterName")); return; }
    if (patients?.some(p => p.name.toLowerCase() === name.trim().toLowerCase())) {
      setErr(t("patients.duplicateName")); return;
    }
    setErr("");
    setStep(2);
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
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
    } catch (ex) {
      setErr(ex?.message || "Error al guardar");
    }
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div ref={setPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...panelHandlers} style={{ maxHeight:"92vh" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("patients.newPatient")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={onClose}><IconX size={14} /></button>
        </div>

        {/* Step indicator */}
        <div style={{ display:"flex", gap:6, padding:"0 20px 16px" }}>
          {[1, 2].map(s => (
            <div key={s} style={{
              flex:1, height:3, borderRadius:2,
              background: s <= step ? "var(--teal)" : "var(--cream-deeper)",
              transition: "background 0.5s",
            }} />
          ))}
        </div>

        <form onSubmit={step === 2 ? submit : (e) => { e.preventDefault(); goToStep2(); }} style={{ padding:"0 20px 0" }}>
          <div>

          {step === 1 ? (
            <>
              {/* Name */}
              <div className="input-group">
                <label className="input-label">
                  {t("settings.fullName")}
                  <span style={{ color:"var(--red)", marginLeft:4 }} aria-hidden>*</span>
                </label>
                <input className="input" type="text" required value={name} onChange={e => setName(e.target.value)} placeholder={t("patients.namePlaceholder")} />
              </div>

              {/* Rate */}
              <div className="input-group">
                <label className="input-label">
                  {t("patients.ratePerSession")}
                  <span style={{ color:"var(--red)", marginLeft:4 }} aria-hidden>*</span>
                </label>
                <MoneyInput min="0" step="50" required value={rate} onChange={e => setRate(e.target.value)} placeholder={t("patients.ratePlaceholder")} />
                <div style={{ fontSize:11, color:"var(--charcoal-xl)", marginTop:2 }}>{t("patients.rateHint")}</div>
              </div>

              {/* Minor toggle — prominent card style */}
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
              {isMinor && (<>
                <div className="input-group">
                  <label className="input-label">{t("patients.tutor")}</label>
                  <input className="input" type="text" value={parent} onChange={e => setParent(e.target.value)} placeholder={t("patients.tutorPlaceholder")} />
                </div>
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
              </>)}

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
                    // Placeholder-style fade while the value is still the
                    // default (today). Clears to normal once the user
                    // picks a real birthdate.
                    color: birthdateUntouched ? "var(--charcoal-xl)" : "var(--charcoal)",
                  }} />
              </div>
            </>
          ) : (
            <>
              {/* Step 2: Schedule */}
              <div style={{ fontSize:13, fontWeight:700, color:"var(--charcoal)", marginBottom:12 }}>{t("patients.schedules")}</div>
              {schedules.map((s, i) => (
                <div key={i} style={{ display:"grid", gridTemplateColumns: schedules.length > 1 ? "1fr 1fr 70px 90px 28px" : "1fr 1fr 70px 90px", gap:8, marginBottom:8, alignItems:"end" }}>
                  <div className="input-group" style={{ marginBottom:0 }}>
                    {i === 0 && <label className="input-label">{t("patients.day")}</label>}
                    <select className="input" value={s.day} onChange={e => updateSched(i, "day", e.target.value)}>
                      {DAY_ORDER.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div className="input-group" style={{ marginBottom:0 }}>
                    {i === 0 && <label className="input-label">{t("patients.time")}</label>}
                    <input className="input" type="time" value={s.time} onChange={e => updateSched(i, "time", e.target.value)} />
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
              ))}
              <button type="button" onClick={() => setSchedules(prev => [...prev, { day: "Lunes", time: "16:00", duration: "60", modality: "presencial" }])}
                style={{ fontSize:12, fontWeight:600, color:"var(--teal-dark)", background:"none", border:"none", cursor:"pointer", padding:"4px 0 14px", fontFamily:"var(--font)" }}>
                {t("patients.addSchedule")}
              </button>
              {conflicts.length > 0 && (
                <div style={{ background:"var(--amber-bg)", borderRadius:"var(--radius-sm)", padding:"8px 12px", marginBottom:12, fontSize:12, color:"var(--amber)", fontWeight:600, lineHeight:1.4 }}>
                  {conflicts.map((c, i) => (
                    <div key={i}>{t("sessions.conflict", { patient: c.patient })}</div>
                  ))}
                </div>
              )}

              {/* Dates */}
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

          {err && <div className="form-error">{err}</div>}
          </div>

          <div style={{ position:"sticky", bottom:0, background:"var(--white)", padding:"12px 0 22px", borderTop:"1px solid var(--border-lt)", marginTop:8 }}>
            {step === 1 ? (
              <button className="btn btn-primary-teal" type="submit" disabled={mutating}>
                {t("next")}
              </button>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                <button className="btn btn-primary-teal" type="submit" disabled={mutating}>
                  {mutating ? t("saving") : t("patients.addPatient")}
                </button>
                <button className="btn btn-secondary w-full" type="button" onClick={() => setStep(1)}>
                  {t("back")}
                </button>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
