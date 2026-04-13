import { useState, useMemo } from "react";
import { DAY_ORDER } from "../../data/seedData";
import { todayISO } from "../../utils/dates";
import { Toggle } from "../Toggle";
import { IconX } from "../Icons";
import { MoneyInput } from "../MoneyInput";
import { useEscape } from "../../hooks/useEscape";
import { useT } from "../../i18n/index";

export function NewPatientSheet({ onClose, onSubmit, mutating, patients, sessions }) {
  const { t, strings } = useT();
  useEscape(onClose);

  // Step 1: patient info, Step 2: schedule
  const [step, setStep] = useState(1);

  // Step 1 fields
  const [name, setName]       = useState("");
  const [isMinor, setIsMinor] = useState(false);
  const [parent, setParent]   = useState("");
  const [rate, setRate]       = useState("");

  // Step 2 fields
  const [schedules, setSchedules] = useState([{ day: "Lunes", time: "16:00", duration: "60" }]);
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
    const ok = await onSubmit({
      name, parent: isMinor ? parent : "", rate: Number(rate) || 0,
      phone: "", email: "", birthdate: null,
      schedules, recurring: true,
      startDate,
      endDate: hasEndDate ? endDate : null,
    });
    if (ok) onClose();
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{ maxHeight:"92vh", display:"flex", flexDirection:"column" }}>
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
              transition: "background 0.2s",
            }} />
          ))}
        </div>

        <form onSubmit={step === 2 ? submit : (e) => { e.preventDefault(); goToStep2(); }} style={{ padding:"0 20px 0", overflowY:"auto", flex:1, minHeight:0, display:"flex", flexDirection:"column" }}>
          <div style={{ flex:1, minHeight:0 }}>

          {step === 1 ? (
            <>
              {/* Name */}
              <div className="input-group">
                <label className="input-label">{t("settings.fullName")}</label>
                <input className="input" type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t("patients.namePlaceholder")} />
              </div>

              {/* Rate */}
              <div className="input-group">
                <label className="input-label">{t("patients.ratePerSession")}</label>
                <MoneyInput min="0" step="50" value={rate} onChange={e => setRate(e.target.value)} placeholder={t("patients.ratePlaceholder")} />
              </div>

              {/* Minor toggle — prominent card style */}
              <div
                onClick={() => setIsMinor(v => !v)}
                style={{
                  display:"flex", alignItems:"center", justifyContent:"space-between",
                  padding:"14px 16px", marginBottom:14, cursor:"pointer",
                  borderRadius:"var(--radius)", border: isMinor ? "1.5px solid var(--purple)" : "1.5px solid var(--border-lt)",
                  background: isMinor ? "var(--purple-bg)" : "var(--white)",
                  transition: "all 0.15s",
                }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:700, color: isMinor ? "var(--purple)" : "var(--charcoal)" }}>{t("patients.isMinor")}</div>
                  <div style={{ fontSize:11, color:"var(--charcoal-xl)", marginTop:2 }}>{t("patients.isMinorHint")}</div>
                </div>
                <Toggle on={isMinor} onToggle={() => {}} />
              </div>
              {isMinor && (
                <div className="input-group">
                  <label className="input-label">{t("patients.tutor")}</label>
                  <input className="input" type="text" value={parent} onChange={e => setParent(e.target.value)} placeholder={t("patients.tutorPlaceholder")} />
                </div>
              )}
            </>
          ) : (
            <>
              {/* Step 2: Schedule */}
              <div style={{ fontSize:13, fontWeight:700, color:"var(--charcoal)", marginBottom:12 }}>{t("patients.schedules")}</div>
              {schedules.map((s, i) => (
                <div key={i} style={{ display:"grid", gridTemplateColumns: schedules.length > 1 ? "1fr 1fr 80px 28px" : "1fr 1fr 80px", gap:8, marginBottom:8, alignItems:"end" }}>
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
                  {schedules.length > 1 && (
                    <button type="button" onClick={() => removeSched(i)}
                      style={{ width:28, height:28, borderRadius:"50%", border:"none", background:"var(--red-bg)", color:"var(--red)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      <IconX size={12} />
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setSchedules(prev => [...prev, { day: "Lunes", time: "16:00", duration: "60" }])}
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
              <button className="btn btn-primary" type="submit" disabled={mutating}>
                {t("next")}
              </button>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                <button className="btn btn-primary" type="submit" disabled={mutating}>
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
