import { useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import {
  IconUsers, IconCamera, IconPhone, IconHome,
  IconChevron,
} from "../../components/Icons";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { SegmentedControl } from "../../components/SegmentedControl";
import { shortDateToISO, todayISO, formatShortDateWithYear } from "../../utils/dates";
import { haptic } from "../../utils/haptics";
import { RescheduleSessionSheet } from "./RescheduleSessionSheet";

/* ── PatientAgenda ─────────────────────────────────────────────────
   Patient-side schedule view. Mirrors the therapist agenda shape
   (Día / Semana / Mes), stripped of features the patient can't use:
     - no FAB (patient can't create)
     - no patient filter (only their own)
     - no multi-select / bulk actions
     - no drag-drop (reschedule is a request flow, not a direct edit)
   Each session lands as a card with the same Reprogramar/Cancelar
   pill pair PatientHome's next-session hero uses, so muscle memory
   carries between the two surfaces.

   Data source is whatever PatientShell hands down via `data` —
   identical to PatientHome, no separate fetch.

   The reschedule + cancel sheet state is local to this screen so
   sheet interactions don't leak across PatientHome <-> PatientAgenda
   navigation. PatientHome retains its own copies — same pattern. */

const MODALITY_LABEL = {
  presencial: "Presencial",
  virtual: "Virtual",
  telefonica: "Telefónica",
  "a-domicilio": "A domicilio",
};
const MODALITY_ICON = {
  presencial: IconUsers,
  virtual: IconCamera,
  telefonica: IconPhone,
  "a-domicilio": IconHome,
};
const MODALITY_COLOR = {
  presencial: "var(--modality-presencial)",
  virtual: "var(--modality-virtual)",
  telefonica: "var(--modality-telefonica)",
  "a-domicilio": "var(--modality-a-domicilio)",
};
const DAY_SHORT = ["DOM","LUN","MAR","MIÉ","JUE","VIE","SÁB"];
const DAY_LONG = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const MONTH_NAMES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

function isoOfDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function startOfWeek(iso) {
  // Monday-first week (Mexican convention; matches the therapist agenda).
  const d = new Date(iso + "T12:00:00");
  const dow = d.getDay();
  const diff = (dow === 0 ? -6 : 1 - dow);
  d.setDate(d.getDate() + diff);
  return isoOfDate(d);
}
function addDays(iso, days) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return isoOfDate(d);
}
function startOfMonth(iso) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(1);
  return isoOfDate(d);
}
function addMonths(iso, months) {
  const d = new Date(iso + "T12:00:00");
  d.setMonth(d.getMonth() + months);
  return isoOfDate(d);
}
function isPastSlot(iso, time) {
  const [h = 0, m = 0] = (time || "00:00").split(":").map(Number);
  const slot = new Date(`${iso}T${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:00`).getTime();
  return slot < Date.now();
}

export function PatientAgenda({ data }) {
  const { t } = useT();
  const { showToast } = useCardigan();
  const { sessions, primaryPatient, primaryTherapist, refresh } = data;
  const therapistDisplayName = primaryTherapist?.therapist_full_name
    || primaryTherapist?.therapist_email?.split("@")[0]
    || "—";

  const [view, setView] = useState("week");
  const [selectedDate, setSelectedDate] = useState(todayISO());

  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelNote, setCancelNote] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // All sessions belonging to this patient. Index by ISO date for
  // O(1) day lookups in the week/month views (tap a day → render
  // that day's rows without re-scanning the entire array). Sorted
  // ascending by time within each day.
  const sessionsByDate = useMemo(() => {
    const out = {};
    if (!primaryPatient) return out;
    for (const s of (sessions || [])) {
      if (s.patient_id !== primaryPatient.id) continue;
      const iso = shortDateToISO(s.date);
      if (!iso) continue;
      (out[iso] = out[iso] || []).push(s);
    }
    for (const k of Object.keys(out)) {
      out[k].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    }
    return out;
  }, [sessions, primaryPatient]);

  const requestReschedule = (s) => setRescheduleTarget(s);
  const requestCancel = (s) => { setCancelTarget(s); setCancelNote(""); };
  const dismissCancel = () => { if (!cancelling) { setCancelTarget(null); setCancelNote(""); } };

  const confirmCancel = async () => {
    if (!cancelTarget || cancelling) return;
    setCancelling(true);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const access = authSession?.access_token;
      if (!access) { showToast(t("patientHome.cancelError"), "error"); return; }
      const res = await fetch("/api/patient-cancel-session", {
        method: "POST",
        headers: { "Authorization": `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: cancelTarget.id, note: cancelNote.trim() || undefined }),
      });
      if (!res.ok) { showToast(t("patientHome.cancelError"), "error"); return; }
      haptic.success();
      showToast(t("patientHome.cancelSuccess"), "success");
      refresh?.();
      setCancelTarget(null);
      setCancelNote("");
    } catch {
      showToast(t("patientHome.cancelError"), "error");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div style={{ padding: "16px 16px 32px" }}>
      <div style={{ marginBottom: 14 }}>
        <SegmentedControl
          value={view}
          onChange={setView}
          items={[
            { k: "day",   l: t("patientAgenda.day") },
            { k: "week",  l: t("patientAgenda.week") },
            { k: "month", l: t("patientAgenda.month") },
          ]}
        />
      </div>

      {view === "day" && (
        <DayView
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          sessionsByDate={sessionsByDate}
          onRequestReschedule={requestReschedule}
          onRequestCancel={requestCancel}
        />
      )}

      {view === "week" && (
        <WeekView
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          sessionsByDate={sessionsByDate}
          onRequestReschedule={requestReschedule}
          onRequestCancel={requestCancel}
        />
      )}

      {view === "month" && (
        <MonthView
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          sessionsByDate={sessionsByDate}
          onRequestReschedule={requestReschedule}
          onRequestCancel={requestCancel}
        />
      )}

      <RescheduleSessionSheet
        open={!!rescheduleTarget}
        session={rescheduleTarget}
        onClose={() => setRescheduleTarget(null)}
        onRescheduled={() => { refresh?.(); }}
      />
      <ConfirmDialog
        open={!!cancelTarget}
        title={cancelTarget
          ? t("patientHome.cancelDialogTitle", {
              date: formatShortDateWithYear(new Date(shortDateToISO(cancelTarget.date) + "T12:00:00")),
            })
          : ""}
        body={t("patientHome.cancelDialogBody", { name: therapistDisplayName })}
        bodyExtra={
          <textarea
            value={cancelNote}
            onChange={(e) => setCancelNote(e.target.value)}
            placeholder={t("patientHome.cancelNotePlaceholder")}
            rows={2}
            maxLength={500}
            style={{
              width: "100%", padding: 10,
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              fontFamily: "var(--font)", fontSize: "var(--text-md)",
              color: "var(--charcoal)", background: "var(--white)",
              resize: "vertical", boxSizing: "border-box",
            }}
          />
        }
        confirmLabel={t("patientHome.cancelConfirmCta")}
        cancelLabel={t("patientHome.cancelKeepCta")}
        destructive
        busy={cancelling}
        onConfirm={confirmCancel}
        onCancel={dismissCancel}
      />
    </div>
  );
}

// ── Day view ─────────────────────────────────────────────────────────
function DayView({ selectedDate, setSelectedDate, sessionsByDate, onRequestReschedule, onRequestCancel }) {
  const { t } = useT();
  const today = todayISO();
  const dayList = sessionsByDate[selectedDate] || [];
  const d = new Date(selectedDate + "T12:00:00");
  const isToday = selectedDate === today;
  const headerTxt = `${DAY_LONG[d.getDay()]} ${d.getDate()} de ${MONTH_NAMES[d.getMonth()]}`;

  return (
    <>
      <DayNav
        label={isToday ? t("patientAgenda.today") : headerTxt}
        sub={isToday ? headerTxt : null}
        onPrev={() => setSelectedDate(addDays(selectedDate, -1))}
        onNext={() => setSelectedDate(addDays(selectedDate, 1))}
        onJumpToday={isToday ? null : () => setSelectedDate(today)}
      />
      {dayList.length === 0 ? (
        <EmptyDay isToday={isToday} />
      ) : (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {dayList.map(s => (
            <SessionCard key={s.id} session={s}
              onRequestReschedule={onRequestReschedule}
              onRequestCancel={onRequestCancel} />
          ))}
        </div>
      )}
    </>
  );
}

// ── Week view ────────────────────────────────────────────────────────
function WeekView({ selectedDate, setSelectedDate, sessionsByDate, onRequestReschedule, onRequestCancel }) {
  const today = todayISO();
  const weekStart = startOfWeek(selectedDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const startD = new Date(weekStart + "T12:00:00");
  const endD = new Date(addDays(weekStart, 6) + "T12:00:00");
  const rangeLabel = startD.getMonth() === endD.getMonth()
    ? `${startD.getDate()}–${endD.getDate()} ${MONTH_NAMES[startD.getMonth()].slice(0,3)}`
    : `${startD.getDate()} ${MONTH_NAMES[startD.getMonth()].slice(0,3)} – ${endD.getDate()} ${MONTH_NAMES[endD.getMonth()].slice(0,3)}`;
  const dayList = sessionsByDate[selectedDate] || [];

  return (
    <>
      <DayNav
        label={rangeLabel}
        onPrev={() => setSelectedDate(addDays(selectedDate, -7))}
        onNext={() => setSelectedDate(addDays(selectedDate, 7))}
        onJumpToday={selectedDate === today ? null : () => setSelectedDate(today)}
      />

      {/* 7-day strip — taps switch the bottom list */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
        gap: 4, marginTop: 14, marginBottom: 18,
      }}>
        {days.map(iso => {
          const dt = new Date(iso + "T12:00:00");
          const dow = dt.getDay();
          const isSel = iso === selectedDate;
          const isToday = iso === today;
          const hasSessions = (sessionsByDate[iso] || []).length > 0;
          return (
            <button key={iso} type="button"
              className="btn-tap"
              onClick={() => setSelectedDate(iso)}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                padding: "8px 0",
                background: isSel ? "var(--teal)" : "transparent",
                color: isSel ? "var(--white)" : (isToday ? "var(--teal-dark)" : "var(--charcoal-md)"),
                border: "none", borderRadius: "var(--radius)",
                cursor: "pointer",
                fontFamily: "var(--font)",
              }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em" }}>
                {DAY_SHORT[dow]}
              </span>
              <span style={{
                fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 16,
                fontVariantNumeric: "tabular-nums",
              }}>
                {dt.getDate()}
              </span>
              <span style={{
                width: 4, height: 4, borderRadius: "50%",
                background: hasSessions
                  ? (isSel ? "var(--white)" : "var(--teal)")
                  : "transparent",
              }} aria-hidden />
            </button>
          );
        })}
      </div>

      {/* Selected day's sessions */}
      <SelectedDayHeader iso={selectedDate} count={dayList.length} />
      {dayList.length === 0 ? (
        <EmptyDay />
      ) : (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {dayList.map(s => (
            <SessionCard key={s.id} session={s} compact
              onRequestReschedule={onRequestReschedule}
              onRequestCancel={onRequestCancel} />
          ))}
        </div>
      )}
    </>
  );
}

// ── Month view ───────────────────────────────────────────────────────
function MonthView({ selectedDate, setSelectedDate, sessionsByDate, onRequestReschedule, onRequestCancel }) {
  const today = todayISO();
  const monthStart = startOfMonth(selectedDate);
  const startD = new Date(monthStart + "T12:00:00");
  const monthLabel = `${MONTH_NAMES[startD.getMonth()]} ${startD.getFullYear()}`;

  // 6-week grid starting on the Monday of (or before) the 1st.
  const gridStart = startOfWeek(monthStart);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  const dayList = sessionsByDate[selectedDate] || [];
  const selectedInMonth = (() => {
    const sd = new Date(selectedDate + "T12:00:00");
    return sd.getMonth() === startD.getMonth() && sd.getFullYear() === startD.getFullYear();
  })();

  return (
    <>
      <DayNav
        label={monthLabel}
        onPrev={() => setSelectedDate(addMonths(selectedDate, -1))}
        onNext={() => setSelectedDate(addMonths(selectedDate, 1))}
        onJumpToday={selectedDate === today ? null : () => setSelectedDate(today)}
      />

      {/* Day-of-week header */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
        gap: 2, marginTop: 14, marginBottom: 4,
      }}>
        {["LUN","MAR","MIÉ","JUE","VIE","SÁB","DOM"].map(d => (
          <div key={d} style={{
            textAlign: "center", fontSize: 10, fontWeight: 700,
            letterSpacing: "0.05em", color: "var(--charcoal-xl)",
          }}>{d}</div>
        ))}
      </div>

      {/* 6-week grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {cells.map(iso => {
          const dt = new Date(iso + "T12:00:00");
          const inMonth = dt.getMonth() === startD.getMonth();
          const isSel = iso === selectedDate;
          const isToday = iso === today;
          const hasSessions = (sessionsByDate[iso] || []).length > 0;
          return (
            <button key={iso} type="button"
              className="btn-tap"
              onClick={() => setSelectedDate(iso)}
              style={{
                aspectRatio: "1 / 1",
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 2,
                background: isSel ? "var(--teal)" : "transparent",
                color: isSel ? "var(--white)"
                  : !inMonth ? "var(--charcoal-xl)"
                  : isToday ? "var(--teal-dark)"
                  : "var(--charcoal)",
                border: isToday && !isSel ? "1.5px solid var(--teal)" : "none",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
                opacity: !inMonth ? 0.5 : 1,
                fontFamily: "var(--font-d)",
                fontVariantNumeric: "tabular-nums",
              }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{dt.getDate()}</span>
              <span style={{
                width: 4, height: 4, borderRadius: "50%",
                background: hasSessions
                  ? (isSel ? "var(--white)" : "var(--teal)")
                  : "transparent",
              }} aria-hidden />
            </button>
          );
        })}
      </div>

      {/* Selected day's sessions */}
      <div style={{ marginTop: 18 }}>
        <SelectedDayHeader iso={selectedDate} count={dayList.length} />
        {!selectedInMonth ? null : dayList.length === 0 ? (
          <EmptyDay />
        ) : (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {dayList.map(s => (
              <SessionCard key={s.id} session={s} compact
                onRequestReschedule={onRequestReschedule}
                onRequestCancel={onRequestCancel} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────
function DayNav({ label, sub, onPrev, onNext, onJumpToday }) {
  const { t } = useT();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
      <button type="button" onClick={onPrev} className="btn-tap"
        aria-label={t("patientAgenda.previous")}
        style={{
          width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
          border: "1px solid var(--border-lt)", borderRadius: "50%",
          background: "var(--white)", cursor: "pointer", color: "var(--charcoal-md)",
          transform: "rotate(180deg)",
        }}>
        <IconChevron size={14} />
      </button>
      <div style={{ flex: 1, textAlign: "center", lineHeight: 1.2 }}>
        <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 15, color: "var(--charcoal)" }}>
          {label}
        </div>
        {sub && (
          <div style={{ fontSize: 11, color: "var(--charcoal-xl)", marginTop: 1 }}>{sub}</div>
        )}
        {onJumpToday && (
          <button type="button" onClick={onJumpToday} className="btn-tap"
            style={{
              marginTop: 4, fontSize: 11, fontWeight: 700,
              color: "var(--teal-dark)", background: "transparent", border: "none",
              cursor: "pointer", padding: 0,
            }}>
            {t("patientAgenda.jumpToday")}
          </button>
        )}
      </div>
      <button type="button" onClick={onNext} className="btn-tap"
        aria-label={t("patientAgenda.next")}
        style={{
          width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
          border: "1px solid var(--border-lt)", borderRadius: "50%",
          background: "var(--white)", cursor: "pointer", color: "var(--charcoal-md)",
        }}>
        <IconChevron size={14} />
      </button>
    </div>
  );
}

function SelectedDayHeader({ iso, count }) {
  const { t } = useT();
  const d = new Date(iso + "T12:00:00");
  const today = todayISO();
  const label = iso === today
    ? t("patientAgenda.today")
    : `${DAY_LONG[d.getDay()]} ${d.getDate()} de ${MONTH_NAMES[d.getMonth()]}`;
  return (
    <div style={{
      display: "flex", alignItems: "baseline", justifyContent: "space-between",
      borderTop: "1px solid var(--border-lt)", paddingTop: 12,
    }}>
      <div style={{
        fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 14,
        color: "var(--charcoal)",
      }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: "var(--charcoal-xl)" }}>
        {count === 0 ? t("patientAgenda.noSessions")
          : count === 1 ? t("patientAgenda.oneSession")
          : t("patientAgenda.nSessions", { n: count })}
      </div>
    </div>
  );
}

function EmptyDay({ isToday }) {
  const { t } = useT();
  return (
    <div className="empty-state" style={{ marginTop: 18 }}>
      <div className="empty-state-title">{t("patientAgenda.dayEmptyTitle")}</div>
      <div className="empty-state-body">
        {isToday ? t("patientAgenda.dayEmptyBodyToday") : t("patientAgenda.dayEmptyBodyOther")}
      </div>
    </div>
  );
}

function SessionCard({ session, onRequestReschedule, onRequestCancel, compact = false }) {
  const { t } = useT();
  const iso = shortDateToISO(session.date);
  const time = session.time || "—";
  const modality = MODALITY_LABEL[session.modality] || MODALITY_LABEL.presencial;
  const ModalityIcon = MODALITY_ICON[session.modality] || IconUsers;
  const modalityColor = MODALITY_COLOR[session.modality] || "var(--teal-dark)";
  const duration = session.duration ? `${session.duration} min` : null;
  const isCancelled = session.status === "cancelled";
  const isPast = !isCancelled && isPastSlot(iso, session.time);
  const canAct = !isCancelled && !isPast;

  return (
    <div style={{
      background: "var(--white)",
      border: "1px solid var(--border-lt)",
      borderRadius: "var(--radius-lg)",
      padding: "14px 16px",
      opacity: isCancelled || isPast ? 0.65 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div
          style={{
            width: compact ? 36 : 44,
            height: compact ? 36 : 44,
            borderRadius: "var(--radius)",
            background: `${modalityColor}20`,
            color: modalityColor,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          <ModalityIcon size={compact ? 16 : 20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: "flex", alignItems: "baseline", gap: 8,
            fontFamily: "var(--font-d)", fontWeight: 800,
            fontSize: compact ? 16 : 18,
            color: "var(--charcoal)",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1.15,
          }}>
            <span>{time}</span>
            {duration && <span style={{
              fontSize: 12, fontWeight: 600, color: "var(--charcoal-md)",
            }}>· {duration}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "3px 10px", borderRadius: "var(--radius-pill)",
              background: `${modalityColor}1A`,
              color: modalityColor,
              fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
            }}>
              <ModalityIcon size={11} />
              {modality}
            </span>
            {isCancelled && (
              <span style={{
                padding: "3px 10px", borderRadius: "var(--radius-pill)",
                background: "var(--red-bg)", color: "var(--red)",
                fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
              }}>
                {t("patientAgenda.cancelledTag")}
              </span>
            )}
            {!isCancelled && isPast && (
              <span style={{
                padding: "3px 10px", borderRadius: "var(--radius-pill)",
                background: "var(--cream-dark)", color: "var(--charcoal-md)",
                fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
              }}>
                {t("patientAgenda.pastTag")}
              </span>
            )}
          </div>
        </div>
      </div>
      {canAct && (onRequestReschedule || onRequestCancel) && (
        <div style={{
          marginTop: 12, paddingTop: 10,
          borderTop: "1px solid var(--border-lt)",
          display: "flex", gap: 8,
        }}>
          {onRequestReschedule && (
            <button type="button" className="btn-tap"
              onClick={() => onRequestReschedule(session)}
              style={{
                flex: 1, height: 34,
                background: "transparent",
                border: "1px solid var(--teal)",
                borderRadius: "var(--radius-pill)",
                cursor: "pointer", fontFamily: "var(--font)",
                fontSize: 12, fontWeight: 700, color: "var(--teal-dark)",
                WebkitTapHighlightColor: "transparent",
              }}>
              {t("patientHome.rescheduleCta")}
            </button>
          )}
          {onRequestCancel && (
            <button type="button" className="btn-tap"
              onClick={() => onRequestCancel(session)}
              style={{
                flex: 1, height: 34,
                background: "transparent",
                border: "1px solid var(--red)",
                borderRadius: "var(--radius-pill)",
                cursor: "pointer", fontFamily: "var(--font)",
                fontSize: 12, fontWeight: 700, color: "var(--red)",
                WebkitTapHighlightColor: "transparent",
              }}>
              {t("patientHome.cancelCta")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
