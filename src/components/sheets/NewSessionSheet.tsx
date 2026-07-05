import { useState, useMemo } from "react";
import { todayISO, isoToShortDate } from "../../utils/dates";
import { IconX } from "../Icons";
import { MoneyInput } from "../MoneyInput";
import { useT } from "../../i18n/index";
import { useCardiganMain } from "../../context/CardiganContext";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useSheetExit } from "../../hooks/useSheetExit";
import { getModalitiesForProfession, MODALITY_I18N_KEY, isEpisodic } from "../../data/constants";
import { formatMXN } from "../../utils/format";
import { timesOverlap } from "../../utils/sessions";
import { SheetOverlay } from "../SheetOverlay";

/* For episodic patients, the natural default is "next visit two weeks
   out" (the most common nutrition cadence during plan rollout) — not
   today. Saves a couple of taps on the most common path. Recurring
   patients keep today's behavior since their next slot is implied by
   the schedule, not a date the user invents. */
const EPISODIC_DEFAULT_OFFSET_DAYS = 14;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed patient/session rows
type Row = any;

function defaultDateForPatient(patient: Row) {
  if (!isEpisodic(patient)) return todayISO();
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + EPISODIC_DEFAULT_OFFSET_DAYS);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function NewSessionSheet({ onClose, onSubmit, patients, sessions, mutating, initialDate, initialTime, initialPatientName, initialSessionType }: {
  onClose: () => void;
  onSubmit: (params: Row) => Promise<boolean> | boolean;
  patients: Row[];
  sessions?: Row[];
  mutating?: boolean;
  initialDate?: string;
  initialTime?: string;
  initialPatientName?: string;
  initialSessionType?: string;
}) {
  const { t } = useT();
  const { profession } = useCardiganMain();
  const modalities = getModalitiesForProfession(profession);
  // Animated close — see useSheetExit / SessionSheet for the pattern.
  const { exiting, animatedClose } = useSheetExit(true, onClose);
  useEscape(animatedClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose);
  const setPanel = (el: HTMLElement | null) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };
  const initialPatient = initialPatientName ? patients.find((p: Row) => p.name === initialPatientName) : null;
  const tutorAllowed = initialSessionType === "tutor" && initialPatient && !!initialPatient.parent;
  const [patientName, setPatientName] = useState(initialPatientName || "");
  const [sessionType, setSessionType] = useState(tutorAllowed ? "tutor" : "patient");
  // Episodic-aware date default: explicit `initialDate` always wins;
  // otherwise we look at the (initial) patient's mode and pick today
  // for recurring, today+14 for episodic.
  const [date, setDate] = useState(initialDate || defaultDateForPatient(initialPatient));
  const [time, setTime] = useState(initialTime || "16:00");
  const [duration, setDuration] = useState("60");
  const [modality, setModality] = useState("presencial");
  const [customRate, setCustomRate] = useState(tutorAllowed ? String(initialPatient.rate) : (initialPatient ? String(initialPatient.rate) : ""));
  const [err, setErr]   = useState("");

  const selectedPatient = patients.find((p: Row) => p.name === patientName);
  const isMinor = selectedPatient && !!selectedPatient.parent;
  const isTutor = sessionType === "tutor";

  // Resolve the fee the user typed, accepting any finite value >= 0
  // (pro-bono is valid). Empty / NaN / negative falls back to the
  // patient's default rate. Don't use `||` here — it collapses 0.
  const effectiveRate = (() => {
    const n = customRate === "" ? NaN : Number(customRate);
    if (Number.isFinite(n) && n >= 0) return n;
    return selectedPatient?.rate ?? 0;
  })();

  const handlePatientChange = (name: string) => {
    setPatientName(name);
    const p = patients.find((pt: Row) => pt.name === name);
    setSessionType("patient");
    setCustomRate(p ? String(p.rate) : "");
    // Re-default the date when the picked patient is episodic — saves
    // the user from manually pushing it out 2 weeks. Skip when the
    // caller pinned a specific `initialDate` (e.g. tap on a calendar
    // cell), since that's a stronger intent.
    if (!initialDate && p) setDate(defaultDateForPatient(p));
  };

  // Conflict detection: an EXACT same-slot booking is hard-blocked —
  // this mirrors the DB's uniq_sessions_user_slot index (user_id, date,
  // time where scheduled), so submitting would 23505 anyway.
  const conflict = useMemo(() => {
    if (!date || !time || !sessions) return null;
    const shortDate = isoToShortDate(date);
    return sessions.find((s: Row) => s.date === shortDate && s.time === time && s.status === "scheduled");
  }, [date, time, sessions]);

  // Overlap detection: a DIFFERENT start time whose range still crosses
  // an existing session (16:00×60 vs 16:30). These are sometimes
  // intentional (couples back-to-back, a tutor slot inside a family
  // block), so it's a warning, not a block — previously they were
  // silently allowed with no signal at all.
  const overlap = useMemo(() => {
    if (!date || !time || !sessions || conflict) return null;
    const shortDate = isoToShortDate(date);
    return sessions.find((s: Row) =>
      s.date === shortDate && s.status === "scheduled" && s.time !== time
      && timesOverlap(time, Number(duration) || 60, s.time, s.duration));
  }, [date, time, duration, sessions, conflict]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientName) { setErr(t("finances.selectPatient")); return; }
    if (!date) { setErr(t("sessions.selectDate")); return; }
    if (!time.trim()) { setErr(t("sessions.selectTime")); return; }
    setErr("");
    const params: Row = { patientName, date: isoToShortDate(date), time, duration: Number(duration) || 60, modality };
    if (isTutor) {
      params.isTutor = true;
      params.tutorName = selectedPatient.parent;
      params.customRate = effectiveRate;
    }
    try {
      const ok = await onSubmit(params);
      if (ok) animatedClose();
    } catch (ex) {
      setErr((ex as Error)?.message || "Error al guardar");
    }
  };

  return (
    <SheetOverlay exiting={exiting} onClose={animatedClose}>
      <div ref={setPanel} className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`} role="dialog" aria-modal="true" aria-label={t("sessions.schedule")} {...panelHandlers} style={{ maxHeight:"min(92lvh, calc(100lvh - var(--sat) - 16px))" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("sessions.schedule")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={animatedClose}><IconX size={14} /></button>
        </div>
        <form onSubmit={submit} style={{ padding:"0 20px 0" }}>
          <div>
          <div className="input-group">
            <label className="input-label">
              {t("sessions.patient")}
              <span style={{ color:"var(--red)", marginLeft:4 }} aria-hidden>*</span>
            </label>
            <select className="input" required value={patientName} onChange={e => handlePatientChange(e.target.value)}>
              <option value="">{t("finances.selectPatient")}</option>
              {patients.filter(p => p.status === "active").map(p => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>
          {isMinor && (
            <div className="input-group">
              <label className="input-label">{t("sessions.sessionType")}</label>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                <button type="button" onClick={() => setSessionType("patient")}
                  style={{ padding:"10px", fontSize:12, fontWeight:700, borderRadius:"var(--radius)", border: sessionType==="patient" ? "2px solid var(--teal)" : "1.5px solid var(--border)", background: sessionType==="patient" ? "var(--teal-pale)" : "var(--white)", color: sessionType==="patient" ? "var(--teal-dark)" : "var(--charcoal-lt)", cursor:"pointer", fontFamily:"var(--font)", textAlign:"center" }}>
                  {t("sessions.patient")}
                </button>
                <button type="button" onClick={() => { setSessionType("tutor"); setCustomRate(String(selectedPatient.rate)); }}
                  style={{ padding:"10px", fontSize:12, fontWeight:700, borderRadius:"var(--radius)", border: sessionType==="tutor" ? "2px solid var(--purple)" : "1.5px solid var(--border)", background: sessionType==="tutor" ? "var(--purple-bg)" : "var(--white)", color: sessionType==="tutor" ? "var(--purple)" : "var(--charcoal-lt)", cursor:"pointer", fontFamily:"var(--font)", textAlign:"center" }}>
                  {t("sessions.tutor")}: {selectedPatient.parent}
                </button>
              </div>
            </div>
          )}
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
                {modalities.map(m => (
                  <option key={m} value={m}>{t(`sessions.${MODALITY_I18N_KEY[m]}`)}</option>
                ))}
              </select>
            </div>
          </div>
          {conflict && (
            <div style={{ background:"var(--amber-bg)", borderRadius:"var(--radius-sm)", padding:"8px 12px", marginBottom:12, fontSize:12, color:"var(--amber)", fontWeight:600, lineHeight:1.4 }}>
              {t("sessions.conflict", { patient: conflict.patient })}
            </div>
          )}
          {overlap && (
            <div style={{ background:"var(--amber-bg)", borderRadius:"var(--radius-sm)", padding:"8px 12px", marginBottom:12, fontSize:12, color:"var(--amber)", fontWeight:600, lineHeight:1.4 }}>
              {t("sessions.overlapWarning", { patient: overlap.patient, time: overlap.time })}
            </div>
          )}
          {isTutor && (
            <div className="input-group">
              <label className="input-label">{t("sessions.sessionRate")}</label>
              <MoneyInput min="0" step="50" value={customRate} onChange={e => setCustomRate(e.target.value)} placeholder={t("patients.ratePlaceholder")} />
            </div>
          )}
          {err && <div className="form-error">{err}</div>}
          </div>
          <div style={{ position:"sticky", bottom:0, background:"var(--white)", padding:"12px 0 22px", borderTop:"1px solid var(--border-lt)", marginTop:8 }}>
            <button className={`btn ${isTutor ? "" : "btn-primary-teal"}`} type="submit" disabled={mutating || !!conflict}
              style={isTutor ? { background:"var(--purple)", color:"var(--white)", boxShadow:"none", width:"100%" } : undefined}>
              {mutating ? t("sessions.scheduling") : isTutor ? `${t("sessions.scheduleWithTutor")} · ${formatMXN(effectiveRate)}` : t("sessions.schedule")}
            </button>
          </div>
        </form>
      </div>
    </SheetOverlay>
  );
}
