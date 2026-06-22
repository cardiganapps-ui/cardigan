import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { IconX, IconCalendar } from "../../components/Icons";
import { haptic } from "../../utils/haptics";
import { todayISO, shortDateToISO } from "../../utils/dates";

/* ── RescheduleSessionSheet ───────────────────────────────────────
   Patient picks a new date + time for an existing scheduled
   session. Submits to /api/patient-reschedule-session, which
   updates the session row in place (preserving id, notes,
   reminders) and pushes the therapist a notification.

   The sheet keeps its own form state — current values seed from
   the session prop on open, then the user edits freely. On error,
   the sheet stays open and surfaces a contextual hint (slot
   conflict, race lost, past target) so the user can adjust without
   losing what they typed. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed session row from untyped portal hook
type Row = any;

type RescheduleSessionSheetProps = {
  open: boolean;
  session: Row;
  onClose?: () => void;
  onRescheduled?: () => void;
};

export function RescheduleSessionSheet({ open, session, onClose, onRescheduled }: RescheduleSessionSheetProps) {
  const { t } = useT();
  const { showToast, setHideFab } = useCardigan();
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorHint, setErrorHint] = useState<string | null>(null);

  // Adjust-during-render: when the sheet opens with a new session,
  // seed the form from that session's current slot. The pattern
  // keeps the existing values visible if the user closes + re-opens
  // mid-edit on the same session, which is rare but cleaner than
  // a useEffect that re-fires after each render.
  const [prevSessionId, setPrevSessionId] = useState<string | null>(null);
  if (open && session && session.id !== prevSessionId) {
    setPrevSessionId(session.id);
    // Seed the date input. The session stores "D-MMM" + a year-fuzz
    // heuristic computes the year — we lean on shortDateToISO() to
    // do the same conversion the rest of the app uses.
    setNewDate(shortDateToISO(session.date) || todayISO());
    setNewTime(session.time || "10:00");
    setErrorHint(null);
  }
  // Reset prevSessionId when the sheet closes so the next open
  // re-seeds.
  if (!open && prevSessionId) {
    setPrevSessionId(null);
  }

  useEffect(() => {
    if (!open) return;
    setHideFab?.(true);
    return () => setHideFab?.(false);
  }, [open, setHideFab]);

  // Block close while a POST is in flight — drag-to-dismiss,
  // overlay click, and Escape all need to respect the same gate
  // the X button does. Without this, the patient can swipe down
  // mid-submit; the request still completes server-side but the
  // UI loses track of the result and the user never sees the
  // success/error toast.
  const safeClose = submitting ? null : onClose;
  useEscape(open ? safeClose : null);
  const panelRef = useFocusTrap(!!open);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(safeClose || (() => {}), { isOpen: open });
  const setPanel = (el: HTMLElement | null) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  if (!open || !session) return null;

  const submit = async () => {
    if (submitting) return;
    if (!newDate || !newTime) return;
    setErrorHint(null);
    setSubmitting(true);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const access = authSession?.access_token;
      if (!access) {
        setErrorHint("network");
        return;
      }
      const res = await fetch("/api/patient-reschedule-session", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${access}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: session.id,
          new_date: newDate,
          new_time: newTime,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Map server codes onto specific UI hints so the user knows
        // exactly what to adjust. Generic fallback for everything
        // else.
        if (body.code === "conflict")           setErrorHint("conflict");
        else if (body.code === "same_slot")     setErrorHint("same_slot");
        else if (body.code === "past_target")   setErrorHint("past");
        else if (body.code === "past_source")   setErrorHint("past_source");
        else if (body.code === "too_far")       setErrorHint("too_far");
        else if (body.code === "too_close")     setErrorHint("too_close");
        else if (body.code === "race_lost")     setErrorHint("race");
        else if (body.code === "not_scheduled") setErrorHint("not_scheduled");
        else                                    setErrorHint("generic");
        return;
      }
      haptic.success();
      showToast(t("patientHome.rescheduleSuccess"), "success");
      onRescheduled?.();
      onClose?.();
    } catch {
      setErrorHint("network");
    } finally {
      setSubmitting(false);
    }
  };

  // Date picker bounds: today through ~6 months out. The server
  // caps at 180 days to match the storage model's year-fuzz window
  // — we mirror it client-side so the picker doesn't even let you
  // try a date that the server will reject.
  const minDate = todayISO();
  const maxDate = (() => {
    const d = new Date(Date.now() + 180 * 86_400_000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  })();
  const valid = !!newDate && !!newTime;

  // Map errorHint → translated copy. Keep the message textable on
  // a single line so it doesn't push the form down on small phones.
  const errorMessage =
    errorHint === "conflict"      ? t("patientHome.rescheduleConflictHint")
    : errorHint === "same_slot"   ? t("patientHome.rescheduleSameSlotHint")
    : errorHint === "past"        ? t("patientHome.reschedulePastHint")
    : errorHint === "past_source" ? t("patientHome.reschedulePastSourceHint")
    : errorHint === "too_far"     ? t("patientHome.rescheduleTooFarHint")
    : errorHint === "too_close"   ? t("patientHome.rescheduleTooCloseHint")
    : errorHint === "race"        ? t("patientHome.rescheduleRaceHint")
    : errorHint === "not_scheduled" ? t("patientHome.rescheduleNotScheduledHint")
    : errorHint                   ? t("patientHome.rescheduleError")
    : null;

  return (
    <div className="sheet-overlay" onClick={safeClose || undefined}>
      <div
        ref={setPanel}
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("patientHome.rescheduleSheetTitle")}
        onClick={(e) => e.stopPropagation()}
        {...panelHandlers}
        style={{ maxHeight: "min(92lvh, calc(100lvh - var(--sat) - 16px))" }}
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("patientHome.rescheduleSheetTitle")}</span>
          <button
            type="button"
            className="sheet-close"
            onClick={onClose}
            aria-label={t("close")}
            disabled={submitting}
          >
            <IconX size={14} />
          </button>
        </div>

        <div style={{ padding: "0 20px 24px" }}>
          <div
            style={{
              fontSize: "var(--text-md)",
              color: "var(--charcoal)",
              lineHeight: 1.5,
              marginBottom: 16,
            }}
          >
            {t("patientHome.rescheduleIntro", {
              date: session.date,
              time: session.time,
            })}
          </div>

          <div className="input-group" style={{ marginBottom: 14 }}>
            <label className="input-label">{t("patientHome.rescheduleDateLabel")}</label>
            <input
              type="date"
              className="input"
              value={newDate}
              onChange={(e) => { setNewDate(e.target.value); setErrorHint(null); }}
              min={minDate}
              max={maxDate}
              disabled={submitting}
            />
          </div>

          <div className="input-group" style={{ marginBottom: 14 }}>
            <label className="input-label">{t("patientHome.rescheduleTimeLabel")}</label>
            <input
              type="time"
              className="input"
              value={newTime}
              onChange={(e) => { setNewTime(e.target.value); setErrorHint(null); }}
              disabled={submitting}
              step={300}
            />
          </div>

          {errorMessage && (
            <div
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--red, #b3261e)",
                lineHeight: 1.45,
                marginBottom: 14,
              }}
              role="alert"
            >
              {errorMessage}
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={!valid || submitting}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity: !valid || submitting ? 0.6 : 1,
            }}
          >
            <IconCalendar size={14} />
            {submitting ? t("patientHome.rescheduleSubmitting") : t("patientHome.rescheduleSubmit")}
          </button>
        </div>
      </div>
    </div>
  );
}
