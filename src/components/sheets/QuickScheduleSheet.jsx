import { useState, useMemo } from "react";
import { IconX } from "../Icons";
import { useT } from "../../i18n/index";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useCardigan } from "../../context/CardiganContext";
import { todayISO, isoToShortDate, parseShortDate } from "../../utils/dates";
import { getModalitiesForProfession, MODALITY_I18N_KEY } from "../../data/constants";
import { haptic } from "../../utils/haptics";

/* ── QuickScheduleSheet ──────────────────────────────────────────────
   "Programar próxima consulta" affordance for episodic patients. The
   nutritionist's natural moment to set the next visit is at the END of
   the current one — they pick a relative cadence ("en 2 semanas") more
   often than a specific calendar date, so the chip strip is the fast
   path; the date picker is the escape hatch.

   Reuses createSession() from useCardigan() — same one-off insert
   path NewSessionSheet uses (is_recurring=false hardcoded in
   useSessions.js:57). Defaults come from the patient's last session
   (time / duration / modality) so the practitioner usually doesn't
   need to touch anything beyond the cadence chip. */

// Quick-pick cadences in days. Mirror the most common nutrition rhythm
// (intake → biweekly during plan rollout → monthly maintenance →
// quarterly review). The labels resolve via i18n so they read right
// across professions (a psychologist using episodic for a one-off
// consult sees the same chips).
const QUICK_PICKS = [
  { id: "in2w",  days: 14 },
  { id: "in4w",  days: 28 },
  { id: "in6w",  days: 42 },
  { id: "in2mo", days: 60 },
  { id: "in3mo", days: 90 },
];

function isoOffsetDays(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  // Avoid timezone drift on the date-string boundary.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* The sheet is mount-controlled — the parent renders it only when
   open. That keeps the "fresh defaults on every open" semantics
   without an effect-driven sync (and avoids the
   react-hooks/set-state-in-effect lint). The `open` prop is left in
   the signature for API symmetry with the other sheets, but doesn't
   gate rendering here. */
export function QuickScheduleSheet({ patient, onClose, onScheduled }) {
  const { t } = useT();
  const { upcomingSessions, createSession, profession, showSuccess } = useCardigan();
  useEscape(onClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose, { isOpen: true });
  const setPanel = (el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  // Pull defaults from the patient's most recent session — practitioners
  // typically keep the same time / duration / modality across visits,
  // so prefilling them removes 3 taps from the common path.
  const lastSession = useMemo(() => {
    if (!patient?.id) return null;
    const mine = (upcomingSessions || [])
      .filter((s) => s.patient_id === patient.id)
      .slice()
      .sort((a, b) => {
        // Sort by parsed date desc, then created_at as tiebreaker.
        const aD = parseShortDate(a.date)?.getTime() || 0;
        const bD = parseShortDate(b.date)?.getTime() || 0;
        if (aD !== bD) return bD - aD;
        return (b.created_at || "").localeCompare(a.created_at || "");
      });
    return mine[0] || null;
  }, [upcomingSessions, patient]);

  const modalities = useMemo(() => getModalitiesForProfession(profession), [profession]);

  // Default date = today + 14 days (the most common nutrition cadence
  // — the "biweekly follow-up during plan rollout" phase). User can
  // override via chip or date input.
  const [selectedDate, setSelectedDate] = useState(() => isoOffsetDays(14));
  const [selectedTime, setSelectedTime] = useState(() => lastSession?.time || "10:00");
  const [duration, setDuration] = useState(() => String(lastSession?.duration || 60));
  const [modality, setModality] = useState(() => lastSession?.modality || modalities[0] || "presencial");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!patient) return null;

  // Highlight the chip whose offset matches the current selectedDate.
  // null = "Otra fecha" (custom). Lets the user see at a glance that
  // their pick is "en 2 semanas" without doing date math.
  const activeChip = (() => {
    for (const p of QUICK_PICKS) {
      if (selectedDate === isoOffsetDays(p.days)) return p.id;
    }
    return null;
  })();

  const submit = async () => {
    if (!selectedDate || !selectedTime) {
      setError(t("scheduling.errors.missingDate"));
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const ok = await createSession({
        patientName: patient.name,
        date: isoToShortDate(selectedDate),
        time: selectedTime,
        duration: Number(duration) || 60,
        modality,
        // Nutrition follow-ups are with the patient (not a tutor).
        // If a future flow wires this sheet for a minor's parent
        // appointment, surface a tutor toggle then.
        isTutor: false,
      });
      if (ok) {
        showSuccess?.(t("scheduling.scheduledToast"));
        haptic.success();
        onScheduled?.({ date: selectedDate, time: selectedTime });
        onClose();
      } else {
        setError(t("scheduling.errors.writeFailed"));
        setSubmitting(false);
      }
    } catch (ex) {
      setError(ex?.message || t("scheduling.errors.writeFailed"));
      setSubmitting(false);
    }
  };

  return (
    <div className="sheet-overlay" onClick={submitting ? undefined : onClose} role="presentation">
      <div
        ref={setPanel}
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-schedule-title"
        onClick={(e) => e.stopPropagation()}
        {...panelHandlers}>
        <div className="sheet-handle" aria-hidden />
        <div className="sheet-header">
          <div id="quick-schedule-title" className="sheet-title">
            {t("scheduling.scheduleNext")}
          </div>
          <button
            type="button"
            className="sheet-close"
            aria-label={t("close")}
            onClick={onClose}
            disabled={submitting}>
            <IconX size={14} />
          </button>
        </div>

        <div style={{ padding: "0 20px 20px" }}>
          {/* Patient + last-visit context strip — orientates the user
              before they pick a date. Skipped when the patient has no
              prior visits (first-time scheduling). */}
          {lastSession && (
            <div style={{
              fontSize: "var(--text-xs)",
              color: "var(--charcoal-xl)",
              marginBottom: 10,
              lineHeight: 1.4,
            }}>
              {t("scheduling.lastConsultLabel")}: <strong style={{ color: "var(--charcoal-md)", fontWeight: 600 }}>{lastSession.date} · {lastSession.time}</strong>
            </div>
          )}

          {/* Quick-pick chips — most-common nutrition cadences. */}
          <div style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 14,
          }} role="group" aria-label={t("scheduling.quickPickAria")}>
            {QUICK_PICKS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedDate(isoOffsetDays(p.days))}
                style={{
                  padding: "8px 12px",
                  borderRadius: "999px",
                  border: activeChip === p.id ? "1.5px solid var(--teal)" : "1px solid var(--border)",
                  background: activeChip === p.id ? "var(--teal-pale)" : "var(--white)",
                  color: activeChip === p.id ? "var(--teal-dark)" : "var(--charcoal-md)",
                  fontSize: "var(--text-xs)",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "background var(--dur-fast) ease, border-color var(--dur-fast) ease",
                  WebkitTapHighlightColor: "transparent",
                }}>
                {t(`scheduling.quickPick.${p.id}`)}
              </button>
            ))}
          </div>

          {/* Date / time / duration / modality — the underlying form
              the chips populate. Always visible so the user can
              fine-tune a chip-picked date or pick a fully custom one. */}
          <div style={{ background: "var(--cream)", borderRadius: "var(--radius)", padding: "12px 14px", marginBottom: 14, display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">{t("scheduling.date")}</label>
                <input className="input" type="date"
                  value={selectedDate}
                  min={todayISO()}
                  onChange={(e) => setSelectedDate(e.target.value)} />
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">{t("sessions.time")}</label>
                <input className="input" type="time"
                  value={selectedTime}
                  onChange={(e) => setSelectedTime(e.target.value)} />
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
                    <option key={m} value={m}>{t(`sessions.modalities.${MODALITY_I18N_KEY[m]}`)}</option>
                  ))}
                </select>
              </div>
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
              onClick={onClose}
              disabled={submitting}>
              {t("cancel")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={submit}
              disabled={submitting || !selectedDate || !selectedTime}>
              {submitting ? t("scheduling.scheduling") : t("scheduling.confirmCta")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
