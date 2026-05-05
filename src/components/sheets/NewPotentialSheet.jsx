import { useState } from "react";
import { todayISO } from "../../utils/dates";
import { IconX } from "../Icons";
import { MoneyInput } from "../MoneyInput";
import { Toggle } from "../Toggle";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { getModalitiesForProfession, MODALITY_I18N_KEY, PROFESSION } from "../../data/constants";
import { formatPhoneMX, phoneDigits } from "../../utils/contact";

/* ── NewPotentialSheet ────────────────────────────────────────────
   Slim form for adding a potential patient + their interview
   session. Companion to NewPatientSheet but DELIBERATELY thinner —
   the practitioner doesn't yet know whether this person will become
   a real patient, so we collect only what's needed to run the
   interview and follow up later. The conversion sheet asks for the
   rest at promote-time.

   The interview session itself (date / time / duration / modality)
   lives in this same form — therapists schedule the interview AS
   the act of adding the potential. There's no separate "now book
   their interview" step.

   Submits via createPotential() in usePatients which inserts the
   patient row + the session row in two coordinated queries. See the
   docstring there for the data flow. */

export function NewPotentialSheet({ onClose, onSubmit, mutating }) {
  const { t } = useT();
  const { profession, patients = [] } = useCardigan();
  const modalities = getModalitiesForProfession(profession);
  useEscape(onClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose);
  const setPanel = (el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  // Tutor + music-teacher professions skew young — default the minor
  // toggle to ON so the form doesn't add an extra tap. Mirrors the
  // same default in NewPatientSheet.
  const minorByDefault = profession === PROFESSION.TUTOR || profession === PROFESSION.MUSIC_TEACHER;

  const [name, setName] = useState("");
  const [isMinor, setIsMinor] = useState(minorByDefault);
  const [parent, setParent] = useState("");
  const [rate, setRate] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);

  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState("16:00");
  const [duration, setDuration] = useState("60");
  const [modality, setModality] = useState(modalities[0] || "presencial");

  const [err, setErr] = useState("");

  const phoneClean = phoneDigits(phone);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setErr(t("patients.enterName")); return; }
    // Dedupe is also enforced server-side via createPotential; this
    // is a UX-fast guard so the user gets immediate feedback.
    const dupe = patients.some(p =>
      (p.status === "active" || p.status === "potential")
      && p.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (dupe) { setErr(t("patients.potentialDuplicate")); return; }
    if (rate === "" || Number.isNaN(Number(rate))) { setErr(t("patients.enterRate")); return; }
    if (!date) { setErr(t("sessions.selectDate")); return; }
    if (!time) { setErr(t("sessions.selectTime")); return; }
    setErr("");

    const params = {
      name: name.trim(),
      parent: isMinor ? parent.trim() : "",
      rate: Math.max(0, Number(rate) || 0),
      phone: phoneClean,
      email: email.trim(),
      whatsappEnabled: !!whatsappEnabled && !!phoneClean,
      interview: {
        date,
        time,
        duration: Number(duration) || 60,
        modality,
      },
    };
    try {
      const ok = await onSubmit(params);
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
          <span className="sheet-title">{t("patients.newPotential")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={onClose}><IconX size={14} /></button>
        </div>
        <form onSubmit={submit} style={{ padding:"0 20px 0" }}>
          <div>

          {/* Name */}
          <div className="input-group">
            <label className="input-label">
              {t("patients.name")}
              <span style={{ color:"var(--red)", marginLeft:4 }} aria-hidden>*</span>
            </label>
            <input className="input" required value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t("patients.namePlaceholder")}
              autoComplete="off" />
          </div>

          {/* Minor toggle + tutor */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: isMinor ? 6 : 14 }}>
            <span style={{ fontSize:"var(--text-sm)", fontWeight:600, color:"var(--charcoal-md)" }}>{t("patients.isMinor")}</span>
            <Toggle on={isMinor} onToggle={() => setIsMinor(v => !v)} />
          </div>
          {isMinor && (
            <div className="input-group">
              <label className="input-label">{t("patients.tutor")}</label>
              <input className="input" value={parent}
                onChange={e => setParent(e.target.value)}
                placeholder={t("patients.tutorPlaceholder")} />
            </div>
          )}

          {/* Rate (allow 0 — many therapists offer free first consults) */}
          <div className="input-group">
            <label className="input-label">
              {t("patients.ratePerSession")}
              <span style={{ color:"var(--red)", marginLeft:4 }} aria-hidden>*</span>
            </label>
            <MoneyInput min="0" step="50" required value={rate}
              onChange={e => setRate(e.target.value)}
              placeholder={t("patients.ratePlaceholder")} />
          </div>

          {/* Interview block — distinct from the rest of the form so
              the practitioner sees "this is where the interview is
              being scheduled" at a glance. Rose-tinted to match the
              session's eventual rail color. */}
          <div style={{ background:"var(--rose-bg)", borderRadius:"var(--radius)", padding:"14px", marginBottom:14 }}>
            <div style={{ fontSize:"var(--text-sm)", fontWeight:700, color:"var(--rose)", marginBottom:8 }}>
              {t("sessions.interview")}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <div className="input-group">
                <label className="input-label">
                  {t("sessions.date")}
                  <span style={{ color:"var(--red)", marginLeft:4 }} aria-hidden>*</span>
                </label>
                <input className="input" type="date" required value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="input-group">
                <label className="input-label">
                  {t("patients.time")}
                  <span style={{ color:"var(--red)", marginLeft:4 }} aria-hidden>*</span>
                </label>
                <input className="input" type="time" required value={time} onChange={e => setTime(e.target.value)} />
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <div className="input-group" style={{ marginBottom:0 }}>
                <label className="input-label">{t("sessions.duration")}</label>
                <select className="input" value={duration} onChange={e => setDuration(e.target.value)}>
                  <option value="30">30 min</option>
                  <option value="45">45 min</option>
                  <option value="60">1 hora</option>
                  <option value="90">1½ horas</option>
                  <option value="120">2 horas</option>
                </select>
              </div>
              <div className="input-group" style={{ marginBottom:0 }}>
                <label className="input-label">{t("sessions.modality")}</label>
                <select className="input" value={modality} onChange={e => setModality(e.target.value)}>
                  {modalities.map(m => (
                    <option key={m} value={m}>{t(`sessions.${MODALITY_I18N_KEY[m]}`)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Optional contact */}
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
              <input className="input" type="email" inputMode="email" autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t("patients.emailPlaceholder")} />
            </div>
          </div>

          {/* WhatsApp opt-in — same gating as NewPatientSheet so this
              feature only surfaces once the Meta template + env vars
              are ready. Still requires a phone to enable. */}
          {import.meta.env.VITE_WHATSAPP_UI_ENABLED === "true" && (
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:4, marginBottom:14, gap:12 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:"var(--text-sm)", fontWeight:600, color:"var(--charcoal-md)" }}>
                  {t("patients.whatsappReminders")}
                </div>
                <div style={{ fontSize:"var(--text-xs)", color:"var(--charcoal-xl)", marginTop:2 }}>
                  {phoneClean ? t("patients.whatsappRemindersHint") : t("patients.whatsappRemindersDisabledHint")}
                </div>
              </div>
              <Toggle
                on={whatsappEnabled && !!phoneClean}
                disabled={!phoneClean}
                ariaLabel={t("patients.whatsappReminders")}
                onToggle={() => setWhatsappEnabled(v => !v)}
              />
            </div>
          )}

          {err && <div className="form-error">{err}</div>}
          </div>

          <div style={{ position:"sticky", bottom:0, background:"var(--white)", padding:"12px 0 22px", borderTop:"1px solid var(--border-lt)", marginTop:8 }}>
            <button className="btn" type="submit"
              disabled={mutating || !name.trim() || rate === ""}
              style={{ background:"var(--rose)", color:"var(--white)", boxShadow:"none", width:"100%" }}>
              {mutating ? t("sessions.scheduling") : t("patients.newPotential")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
