import { useState, useMemo } from "react";
import { IconX } from "../Icons";
import { useT } from "../../i18n/index";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useSheetExit } from "../../hooks/useSheetExit";
import { useCardigan } from "../../context/CardiganContext";
import { todayISO } from "../../utils/dates";
import { DAY_ORDER } from "../../data/seedData";
import { getModalitiesForProfession, MODALITY_I18N_KEY, SCHEDULING_MODE, RECURRENCE_FREQUENCY, DEFAULT_RECURRENCE_FREQUENCY } from "../../data/constants";
import { SegmentedControl } from "../SegmentedControl";
import { haptic } from "../../utils/haptics";

/* ── SetWeeklySlotSheet ──────────────────────────────────────────────
   Episodic → recurring switch. Fires from the Resumen tab when an
   episodic patient's practitioner decides "actually, let's lock in a
   weekly slot for this person." Three inputs: weekday, time, start
   date. On confirm:

     1. updatePatient — flip scheduling_mode to 'recurring' + stamp
        day/time/start_date so the schedule-derivation logic recognises
        the slot.
     2. generateRecurringSessions — seed the next ~15 weeks of
        is_recurring=true rows. Auto-extend takes over from there.

   Existing future one-offs created during the patient's episodic
   phase are NOT deleted — they stay on the calendar so the user
   doesn't lose any visit they explicitly scheduled. Auto-extend will
   skip dates that already have a session via the existing
   uniq_sessions_patient_date_time guard. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed patient row
type Row = any;

export function SetWeeklySlotSheet({ patient, onClose, onSwitched }: {
  patient?: Row;
  onClose: () => void;
  onSwitched?: () => void;
}) {
  const { t } = useT();
  const { profession, updatePatient, generateRecurringSessions, showSuccess } = useCardigan();
  const { exiting, animatedClose } = useSheetExit(true, onClose);
  useEscape(animatedClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose, { isOpen: true });
  const setPanel = (el: HTMLElement | null) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  const modalities = useMemo(() => getModalitiesForProfession(profession), [profession]);

  // Defaults: today's weekday, mid-morning, today as start. Reasonable
  // for "I want to start this routine now."
  const [day, setDay] = useState(() => DAY_ORDER[(new Date().getDay() + 6) % 7]);
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState("60");
  const [modality, setModality] = useState(modalities[0] || "presencial");
  const [startDate, setStartDate] = useState(todayISO());
  const [frequency, setFrequency] = useState<string>(DEFAULT_RECURRENCE_FREQUENCY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!patient) return null;

  const submit = async () => {
    if (!day || !time || !startDate) {
      setError(t("scheduling.errors.missingDate"));
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const ok = await updatePatient(patient.id, {
        scheduling_mode: SCHEDULING_MODE.RECURRING,
        day,
        time,
        start_date: startDate,
      });
      if (!ok) {
        setError(t("scheduling.errors.writeFailed"));
        setSubmitting(false);
        return;
      }
      // Seed the upcoming-15-weeks schedule. Generates rows marked
      // is_recurring=true so auto-extend keeps the schedule healthy
      // long-term. If this fails the patient row is already flipped to
      // 'recurring' but has no recurring sessions — a half-state where
      // ResumenTab would show "Sin recurrencia" but auto-extend can't
      // bootstrap (it only seeds from existing is_recurring rows).
      // Roll the patient row back to its previous shape so the user
      // can retry from a clean state.
      const seeded = await generateRecurringSessions(
        patient.id,
        [{ day, time, duration: Number(duration) || 60, modality, frequency }],
        startDate,
        null, // open-ended
      );
      if (!seeded) {
        await updatePatient(patient.id, {
          scheduling_mode: SCHEDULING_MODE.EPISODIC,
          day:  null,
          time: null,
          start_date: null,
        });
        setError(t("scheduling.errors.seedFailed"));
        setSubmitting(false);
        return;
      }
      showSuccess?.(t("scheduling.modeChangedRecurring"));
      haptic.success();
      onSwitched?.();
      animatedClose();
    } catch (ex) {
      setError((ex as Error)?.message || t("scheduling.errors.writeFailed"));
      setSubmitting(false);
    }
  };

  return (
    <div className={`sheet-overlay ${exiting ? "sheet-overlay--exit" : ""}`} onClick={submitting ? undefined : animatedClose} role="presentation">
      <div
        ref={setPanel}
        className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="set-slot-title"
        onClick={(e) => e.stopPropagation()}
        {...panelHandlers}>
        <div className="sheet-handle" aria-hidden />
        <div className="sheet-header">
          <div style={{ display:"flex", flexDirection:"column", gap:2, minWidth:0, flex:1 }}>
            <div id="set-slot-title" className="sheet-title">
              {t("scheduling.switchToRecurringTitle")}
            </div>
            <div style={{
              fontSize:"var(--text-xs)",
              color:"var(--charcoal-xl)",
              fontWeight:600,
              overflow:"hidden",
              textOverflow:"ellipsis",
              whiteSpace:"nowrap",
            }}>{patient.name}</div>
          </div>
          <button
            type="button"
            className="sheet-close"
            aria-label={t("close")}
            onClick={animatedClose}
            disabled={submitting}>
            <IconX size={14} />
          </button>
        </div>

        <div style={{ padding: "0 20px 20px" }}>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--charcoal-md)", lineHeight: 1.5, margin: "0 0 14px" }}>
            {t("scheduling.switchToRecurringIntro")}
          </p>

          <div style={{ background: "var(--cream)", borderRadius: "var(--radius)", padding: "12px 14px", marginBottom: 14, display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">{t("scheduling.weekday")}</label>
                <select className="input" value={day} onChange={(e) => setDay(e.target.value)}>
                  {DAY_ORDER.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">{t("patients.time")}</label>
                <input className="input" type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">{t("sessions.duration")}</label>
                <select className="input" value={duration} onChange={(e) => setDuration(e.target.value)}>
                  <option value="30">30 min</option>
                  <option value="45">45 min</option>
                  <option value="60">1 h</option>
                  <option value="90">1½ h</option>
                  <option value="120">2 h</option>
                </select>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">{t("sessions.modality")}</label>
                <select className="input" value={modality} onChange={(e) => setModality(e.target.value)}>
                  {modalities.map((m) => (
                    <option key={m} value={m}>{t(`sessions.${MODALITY_I18N_KEY[m]}`)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">{t("patients.frequency")}</label>
              <SegmentedControl
                items={[
                  { k: RECURRENCE_FREQUENCY.WEEKLY,   l: t("patients.frequencyWeekly") },
                  { k: RECURRENCE_FREQUENCY.BIWEEKLY, l: t("patients.frequencyBiweekly") },
                  { k: RECURRENCE_FREQUENCY.MONTHLY,  l: t("patients.frequencyMonthly") },
                ]}
                value={frequency}
                onChange={setFrequency}
                ariaLabel={t("patients.frequency")}
              />
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label">{t("patients.start")}</label>
              <input className="input" type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)} />
            </div>
          </div>

          {error && (
            <div style={{
              background: "var(--red-bg)",
              color: "var(--red)",
              padding: "8px 12px",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-xs)",
              fontWeight: 600,
              marginBottom: 10,
            }} role="alert">{error}</div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={animatedClose}
              disabled={submitting}>
              {t("cancel")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={submit}
              disabled={submitting || !day || !time || !startDate}>
              {submitting ? t("scheduling.scheduling") : t("scheduling.switchToRecurringConfirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
