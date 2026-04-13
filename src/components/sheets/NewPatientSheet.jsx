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
  const [name, setName]       = useState("");
  const [isMinor, setIsMinor] = useState(false);
  const [parent, setParent]   = useState("");
  const [phone, setPhone]     = useState("");
  const [email, setEmail]     = useState("");
  const [rate, setRate]       = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [recurring, setRecurring] = useState(true);
  const [schedules, setSchedules] = useState([{ day: "Lunes", time: "16:00" }]);
  const [startDate, setStartDate] = useState(todayISO());
  const [hasEndDate, setHasEndDate] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [err, setErr]         = useState("");

  // Check for schedule conflicts with existing sessions
  const conflicts = useMemo(() => {
    if (!sessions || !schedules.length) return [];
    return schedules.map(sched => {
      const match = sessions.find(s => s.day === sched.day && s.time === sched.time && s.status === "scheduled");
      return match || null;
    }).filter(Boolean);
  }, [schedules, sessions]);

  const updateSched = (i, f, v) => setSchedules(prev => prev.map((s, idx) => idx === i ? { ...s, [f]: v } : s));
  const removeSched = (i) => setSchedules(prev => prev.filter((_, idx) => idx !== i));

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setErr(t("patients.enterName")); return; }
    if (patients?.some(p => p.name.toLowerCase() === name.trim().toLowerCase())) {
      setErr(t("patients.duplicateName")); return;
    }
    setErr("");
    const ok = await onSubmit({
      name, parent: isMinor ? parent : "", rate: Number(rate) || 0,
      phone: phone.trim(), email: email.trim(), birthdate: birthdate || null,
      schedules, recurring,
      startDate: recurring ? startDate : null,
      endDate: recurring && hasEndDate ? endDate : null,
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
        <form onSubmit={submit} style={{ padding:"0 20px 0", overflowY:"auto", flex:1, display:"flex", flexDirection:"column" }}>
          <div style={{ flex:1 }}>
          <div className="input-group">
            <label className="input-label">{t("settings.fullName")}</label>
            <input className="input" type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t("patients.namePlaceholder")} />
          </div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: isMinor ? 6 : 14 }}>
            <span style={{ fontSize:12, fontWeight:600, color:"var(--charcoal-md)" }}>{t("patients.isMinor")}</span>
            <Toggle on={isMinor} onToggle={() => setIsMinor(v => !v)} />
          </div>
          {isMinor && (
            <div className="input-group">
              <label className="input-label">{t("patients.tutor")}</label>
              <input className="input" type="text" value={parent} onChange={e => setParent(e.target.value)} placeholder={t("patients.tutorPlaceholder")} />
            </div>
          )}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div className="input-group">
              <label className="input-label">{t("patients.phone")}</label>
              <input className="input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder={t("patients.phonePlaceholder")} />
            </div>
            <div className="input-group">
              <label className="input-label">{t("settings.email")}</label>
              <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t("patients.emailPlaceholder")} />
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div className="input-group">
              <label className="input-label">{t("patients.ratePerSession")}</label>
              <MoneyInput min="0" step="50" value={rate} onChange={e => setRate(e.target.value)} placeholder={t("patients.ratePlaceholder")} />
            </div>
            <div className="input-group">
              <label className="input-label">{t("patients.birthdate")}</label>
              <input className="input" type="date" value={birthdate} onChange={e => setBirthdate(e.target.value)} />
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <span style={{ fontSize:13, fontWeight:700, color:"var(--charcoal)" }}>{t("patients.recurringAppts")}</span>
            <Toggle on={recurring} onToggle={() => setRecurring(v => !v)} />
          </div>
          {schedules.map((s, i) => (
            <div key={i} style={{ display:"grid", gridTemplateColumns: schedules.length > 1 ? "1fr 1fr 28px" : "1fr 1fr", gap:8, marginBottom:8, alignItems:"end" }}>
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
              {schedules.length > 1 && (
                <button type="button" onClick={() => removeSched(i)}
                  style={{ width:28, height:28, borderRadius:"50%", border:"none", background:"var(--red-bg)", color:"var(--red)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <IconX size={12} />
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setSchedules(prev => [...prev, { day: "Lunes", time: "16:00" }])}
            style={{ fontSize:12, fontWeight:600, color:"var(--teal-dark)", background:"none", border:"none", cursor:"pointer", padding:"4px 0 12px", fontFamily:"var(--font)" }}>
            {t("patients.addSchedule")}
          </button>
          {conflicts.length > 0 && (
            <div style={{ background:"var(--amber-bg)", borderRadius:"var(--radius-sm)", padding:"8px 12px", marginBottom:12, fontSize:12, color:"var(--amber)", fontWeight:600, lineHeight:1.4 }}>
              {conflicts.map((c, i) => (
                <div key={i}>{t("sessions.conflict", { patient: c.patient })}</div>
              ))}
            </div>
          )}
          {recurring && (
            <div style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 14px", marginBottom:14 }}>
              <div className="input-group" style={{ marginBottom:10 }}>
                <label className="input-label">{t("patients.start")}</label>
                <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: hasEndDate ? 8 : 0 }}>
                <span style={{ fontSize:12, fontWeight:600, color:"var(--charcoal-md)" }}>{t("patients.endDate")}</span>
                <Toggle on={hasEndDate} onToggle={() => setHasEndDate(v => !v)} />
              </div>
              {hasEndDate ? (
                <div className="input-group" style={{ marginBottom:0 }}>
                  <input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              ) : (
                <div style={{ fontSize:11, color:"var(--charcoal-xl)", marginTop:4 }}>{t("patients.permanent")}</div>
              )}
            </div>
          )}
          {err && <div className="form-error">{err}</div>}
          </div>
          <div style={{ position:"sticky", bottom:0, background:"var(--white)", padding:"12px 0 22px", borderTop:"1px solid var(--border-lt)", marginTop:8 }}>
            <button className="btn btn-primary" type="submit" disabled={mutating}>
              {mutating ? t("saving") : t("patients.addPatient")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
