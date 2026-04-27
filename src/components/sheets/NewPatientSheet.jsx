import { useState, useMemo, useEffect } from "react";
import { DAY_ORDER } from "../../data/seedData";
import { todayISO } from "../../utils/dates";
import { formatPhoneMX, phoneDigits } from "../../utils/contact";
import { capitalizeName } from "../../utils/names";
import { Toggle } from "../Toggle";
import { IconX } from "../Icons";
import { MoneyInput } from "../MoneyInput";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import { getModalitiesForProfession, MODALITY_I18N_KEY, PROFESSION, usesAnthropometrics } from "../../data/constants";

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
  const { profession } = useCardigan();
  const modalities = getModalitiesForProfession(profession);
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
  // Tutor + music_teacher default the "is minor" toggle on — most of
  // their clientele are minors, and the parent contact card is the
  // primary phone number anyway.
  const minorDefault = profession === PROFESSION.TUTOR || profession === PROFESSION.MUSIC_TEACHER;
  const [isMinor, setIsMinor] = useState(minorDefault);
  const [parent, setParent] = useState("");
  const [rate, setRate] = useState("");
  const [tutorFrequency, setTutorFrequency] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  // Birthdate defaults to today so the control renders a filled-in
  // date picker; we track "untouched" so the placeholder-ish styling
  // doesn't lock us into saving today's date as birthdate.
  const [birthdate, setBirthdate] = useState(todayISO());
  const birthdateUntouched = birthdate === todayISO();
  // Anthropometric / health-history fields. Only collected for
  // nutritionist + trainer; ignored at insert time for everyone else.
  const showHealthFields = usesAnthropometrics(profession);
  const [heightCm, setHeightCm] = useState("");
  const [goalWeightKg, setGoalWeightKg] = useState("");
  const [allergies, setAllergies] = useState("");
  const [medicalConditions, setMedicalConditions] = useState("");

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

  // Transient feedback for missed-field / conflict nudges on tap of
  // "Siguiente" or "Agregar paciente". A silently-disabled button was
  // leaving the user wondering why the form wasn't advancing — this
  // fades in the exact reason for ~2.6s and blurs out. `id` forces
  // the animation to replay when the same message is set twice.
  const [feedback, setFeedback] = useState(null);
  useEffect(() => {
    if (!feedback) return;
    const id = setTimeout(() => setFeedback(null), 2600);
    return () => clearTimeout(id);
  }, [feedback]);
  const flash = (msg) => setFeedback({ msg, id: Date.now() });

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

  // Gate used for UI affordances (disabled indicators etc.) — not
  // enforced by the button itself. Keeping "Siguiente" clickable so
  // the user always gets feedback is the whole point of the flash
  // toast.
  const rateNum = Number(rate);
  const rateValid = rate !== "" && Number.isFinite(rateNum) && rateNum >= 0;
  const canAdvance = !!name.trim() && rateValid && schedules.length > 0 && !hasConflict;

  const goNext = () => {
    if (!name.trim()) { flash(t("patients.enterName")); return; }
    if (patients?.some(p => p.name.toLowerCase() === name.trim().toLowerCase())) {
      flash(t("patients.duplicateName")); return;
    }
    if (!rateValid) { flash(t("patients.enterRate")); return; }
    if (hasConflict) { flash(t("patients.resolveConflicts")); return; }
    // Dismiss the iOS keyboard when stepping past step 1 (rate input).
    // Without this, the soft keyboard stays open over step 2's date
    // pickers because the previously-focused MoneyInput unmounts but
    // iOS doesn't release the keyboard until something explicitly
    // blurs the active element.
    if (typeof document !== "undefined" && document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    setFeedback(null);
    setStep(2);
    // Scroll to top on step change so the user sees the first field
    // rather than landing mid-scroll.
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  const goBack = () => {
    setFeedback(null);
    setStep(1);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (step === 1) { goNext(); return; }
    // Step 2: re-check the gate in case the user bounced back to step 1
    // and introduced a conflict before coming back.
    if (!canAdvance) { setStep(1); flash(t("patients.resolveConflicts")); return; }
    setFeedback(null);
    setSubmitting(true);
    try {
      const ok = await onSubmit({
        name, parent: isMinor ? parent : "", rate: Number(rate) || 0,
        tutorFrequency: isMinor && tutorFrequency ? Number(tutorFrequency) : null,
        phone: phoneDigits(phone), email: email.trim(),
        whatsappEnabled: whatsappEnabled && !!phoneDigits(phone),
        birthdate: (birthdate && !birthdateUntouched) ? birthdate : null,
        // Health fields. Server-side they're always present as columns;
        // we just don't surface the form section unless the profession
        // actually uses them.
        heightCm: showHealthFields && heightCm ? Number(heightCm) : null,
        goalWeightKg: showHealthFields && goalWeightKg ? Number(goalWeightKg) : null,
        allergies: showHealthFields ? allergies.trim() : "",
        medicalConditions: showHealthFields ? medicalConditions.trim() : "",
        schedules, recurring: true,
        startDate,
        endDate: hasEndDate ? endDate : null,
      });
      if (ok) onClose();
      else setSubmitting(false);
    } catch (ex) {
      flash(ex?.message || "Error al guardar");
      setSubmitting(false);
    }
  };

  // Schedule-row columns are proportional, weighted by the longest
  // option each cell needs to fit:
  //   Día        "Miércoles"   (9 chars)
  //   Hora       "HH:MM"       (5 chars, native time chrome)
  //   Duración   "1½h"         (3 chars)
  //   Modalidad  "Telefónica"  (10 chars)
  // Floors via minmax() guarantee no option truncates on phone-width
  // viewports while letting all four cells stretch on wider screens.
  const scheduleRowCols = schedules.length > 1
    ? "minmax(86px, 1.1fr) minmax(64px, 0.85fr) minmax(48px, 0.6fr) minmax(94px, 1.2fr) 28px"
    : "minmax(86px, 1.1fr) minmax(64px, 0.85fr) minmax(48px, 0.6fr) minmax(94px, 1.2fr)";

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
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <span className="sheet-title">{t("patients.newPatient")}</span>
            {/* Progress strips. Current step is always teal; subsequent
                steps fade to the neutral border color. Role=progressbar
                + aria-valuenow keep it meaningful to screen readers even
                though the visual is just two bars. */}
            <div role="progressbar" aria-valuemin={1} aria-valuemax={2} aria-valuenow={step}
              aria-label={t("patients.stepIndicator", { current: step, total: 2 })}
              style={{ display:"flex", gap:6 }}>
              <span aria-hidden style={{ height:4, width:72, borderRadius:2, background:"var(--teal)", transition:"background 0.3s" }} />
              <span aria-hidden style={{ height:4, width:72, borderRadius:2, background: step >= 2 ? "var(--teal)" : "var(--border)", transition:"background 0.3s" }} />
            </div>
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
                <input className="input" type="text" required value={name} onChange={e => setName(capitalizeName(e.target.value))} placeholder={t("patients.namePlaceholder")} autoCapitalize="words" />
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
                  <input className="input" type="text" value={parent} onChange={e => setParent(capitalizeName(e.target.value))} placeholder={t("patients.tutorPlaceholder")} autoCapitalize="words" />
                </div>
              )}

              {/* 3. Rate */}
              <div className="input-group">
                <label className="input-label">
                  {t("patients.ratePerSession")}
                  <span style={{ color:"var(--red)", marginLeft:4 }} aria-hidden>*</span>
                </label>
                <MoneyInput min="0" step="50" required value={rate} onChange={e => setRate(e.target.value)} placeholder={t("patients.ratePlaceholder")} />
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
                        {modalities.map(m => (
                          <option key={m} value={m}>{t(`sessions.${MODALITY_I18N_KEY[m]}`)}</option>
                        ))}
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

              {/* Anthropometric / health-history block — nutritionist
                  + trainer only. Sits above the tutor-frequency block
                  because most of these clients are adults; minors are
                  the exception in fitness/nutrition contexts. */}
              {showHealthFields && (
                <>
                  <div style={{ fontSize:"var(--text-xs)", color:"var(--charcoal-xl)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:8, marginTop:4 }}>
                    {t("patientFields.sectionTitle")}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <div className="input-group">
                      <label className="input-label">{t("patientFields.height")}</label>
                      <input className="input" type="number" inputMode="numeric"
                        value={heightCm} onChange={e => setHeightCm(e.target.value)}
                        min="50" max="250" step="1" />
                    </div>
                    <div className="input-group">
                      <label className="input-label">{t("patientFields.goalWeight")}</label>
                      <input className="input" type="number" inputMode="decimal"
                        value={goalWeightKg} onChange={e => setGoalWeightKg(e.target.value)}
                        min="20" max="300" step="0.1" />
                    </div>
                  </div>
                  <div className="input-group">
                    <label className="input-label">{t("patientFields.allergies")}</label>
                    <input className="input" type="text"
                      value={allergies} onChange={e => setAllergies(e.target.value)}
                      placeholder={t("patientFields.allergiesPlaceholder")} />
                  </div>
                  <div className="input-group">
                    <label className="input-label">{t("patientFields.medicalConditions")}</label>
                    <input className="input" type="text"
                      value={medicalConditions} onChange={e => setMedicalConditions(e.target.value)}
                      placeholder={t("patientFields.medicalConditionsPlaceholder")} />
                  </div>
                </>
              )}

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
                  <input className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t("patients.emailPlaceholder")} />
                </div>
              </div>
              {/* WhatsApp opt-in — gated until Meta setup is live. Flip
                  VITE_WHATSAPP_UI_ENABLED=true in Vercel + redeploy
                  once the template is approved and env vars are set. */}
              {import.meta.env.VITE_WHATSAPP_UI_ENABLED === "true" && (
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:12, gap:12 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:"var(--text-sm)", fontWeight:600, color:"var(--charcoal-md)" }}>
                      {t("patients.whatsappReminders")}
                    </div>
                    <div style={{ fontSize:"var(--text-xs)", color:"var(--charcoal-xl)", marginTop:2 }}>
                      {phoneDigits(phone) ? t("patients.whatsappRemindersHint") : t("patients.whatsappRemindersDisabledHint")}
                    </div>
                  </div>
                  <Toggle
                    on={whatsappEnabled && !!phoneDigits(phone)}
                    disabled={!phoneDigits(phone)}
                    ariaLabel={t("patients.whatsappReminders")}
                    onToggle={() => setWhatsappEnabled(v => !v)}
                  />
                </div>
              )}
              <div className="input-group">
                <label className="input-label">{t("patients.birthdate")}</label>
                <input className="input" type="date" value={birthdate} onChange={e => setBirthdate(e.target.value)}
                  style={{ height: 52, fontSize: 16, padding: "14px 14px",
                    color: birthdateUntouched ? "var(--charcoal-xl)" : "var(--charcoal)",
                  }} />
              </div>
            </>
          )}

          </div>

          {/* Fade-in / hold / blur-out toast. Rendered sibling to the
              sticky footer so it floats just above the Siguiente / Agregar
              paciente button without shifting the layout. `key` ties the
              animation to the feedback id so replays work. */}
          {feedback && (
            <div key={feedback.id} role="alert" aria-live="polite"
              style={{
                position:"sticky", bottom:78, left:0, right:0,
                pointerEvents:"none", display:"flex", justifyContent:"center",
                marginTop:-12, marginBottom:-42, zIndex:2,
                animation:"formFeedbackFade 2.6s ease forwards",
              }}>
              <div style={{
                background:"var(--red-bg)", color:"var(--red)",
                padding:"9px 16px", borderRadius:"var(--radius-pill)",
                fontSize:"var(--text-sm)", fontWeight:600,
                fontFamily:"var(--font)", textAlign:"center",
                boxShadow:"var(--shadow-sm)",
                border:"1px solid rgba(217,107,107,0.22)",
                maxWidth:"calc(100% - 24px)",
              }}>
                {feedback.msg}
              </div>
            </div>
          )}

          <div style={{ position:"sticky", bottom:0, background:"var(--white)", padding:"12px 0 22px", borderTop:"1px solid var(--border-lt)", marginTop:8 }}>
            {step === 1 ? (
              <button className="btn btn-primary-teal" type="submit">
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
