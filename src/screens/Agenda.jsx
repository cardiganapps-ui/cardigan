import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { getClientColor, TODAY } from "../data/seedData";
import { haptic } from "../utils/haptics";
import { SessionSheet } from "../components/SessionSheet";
import { NoteEditor } from "../components/NoteEditor";
import { NewSessionSheet } from "../components/sheets/NewSessionSheet";
import { CalendarLinkSheet } from "../components/sheets/CalendarLinkSheet";
import { IconSun, IconCheck, IconX, IconTrash, IconCalendar, IconChevron } from "../components/Icons";
import ContextMenu, { useContextMenu } from "../components/ContextMenu";
import { BulkActionsBar } from "../components/BulkActionsBar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { tryClaim as trySwipeClaim, release as releaseSwipe } from "../hooks/swipeCoordinator";
import { formatShortDate, toISODate } from "../utils/dates";
import { isCancelledStatus, statusClass, isTutorSession, tutorDisplayInitials, shortName, railClass } from "../utils/sessions";
import { Avatar } from "../components/Avatar";
import { useSwipe } from "../hooks/useSwipe";
import { useViewport } from "../hooks/useViewport";
import { useCalendarToken } from "../hooks/useCalendarToken";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";
import { Toggle } from "../components/Toggle";
import { SegmentedControl } from "../components/SegmentedControl";
import { EmptyState } from "../components/EmptyState";

/* ── LongPressEvent ──
   Touch-native drag-and-drop for week events. Two-stage lifecycle:

     1. Long-press (500 ms) → enter drag mode. Haptic + a floating
        ghost element follows the finger. The original event tile stays
        in place dimmed.
     2. Drag → on each touchmove, document.elementFromPoint locates the
        underlying .week-cell (read from data-cell-day / data-cell-hour
        attributes set by WeekDaysPanel). The cell highlights and a
        time pill renders inside it.
     3. touchend → if a target was found, call onDropSession with the
        new date+hour (same handler the desktop HTML5 drop uses). If
        the finger lifted on no valid cell, the gesture is silently
        cancelled — no surprise reschedule.

   When the user just long-presses without moving (legacy behaviour
   from before mobile drag), they still get the same drop on touchend
   if the ghost happens to be over the source cell — which is harmless
   since the new date+hour matches the original. To preserve the old
   "long-press → open reschedule sheet" affordance for users who don't
   discover the drag, we open the sheet on a long-press that's lifted
   without any movement.

   Touch handlers are attached natively so we can preventDefault on
   move (suppresses page scroll during drag). React's synthetic
   handlers are passive: true and can't.

   Coordinates the swipeCoordinator lock so horizontal day-navigation
   swipes don't fire during drag. */
function LongPressEvent({ session, eventStyle, startF, dur, isDraggable, touchLongPressable, onSelectSession, onDropSession, onEventContextMenu }) {
  const elRef = useRef(null);
  const timerRef = useRef(null);
  const startPosRef = useRef(null);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const ghostRef = useRef(null);
  const lastTargetRef = useRef(null);
  // Track when we've consumed the gesture so the synthetic click that
  // iOS fires after a touchend doesn't re-open the session sheet.
  const consumedRef = useRef(false);
  // Visual press feedback while the 500 ms timer is running.
  const [pressing, setPressing] = useState(false);
  const [dragging, setDragging] = useState(false);

  /* Live refs for the values the gesture handlers close over. Without
     these, the useEffect that attaches the native touch listeners
     would re-run on every parent render (because `session` is a fresh
     object reference each time WeekDaysPanel rebuilds the events
     array), and the cleanup path would abort any in-flight drag —
     silently killing the user's gesture every minute when Agenda's
     `now` clock ticks. Pinning the deps to `touchLongPressable` only
     keeps the listeners stable across re-renders; the handlers read
     the latest session/onSelectSession/onDropSession via these refs. */
  const sessionRef = useRef(session);
  const onSelectSessionRef = useRef(onSelectSession);
  const onDropSessionRef = useRef(onDropSession);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { onSelectSessionRef.current = onSelectSession; }, [onSelectSession]);
  useEffect(() => { onDropSessionRef.current = onDropSession; }, [onDropSession]);

  /* Drop-target classes are added/removed via direct DOM manipulation
     because the cells are owned by WeekDaysPanel and we don't want a
     state prop ping-ponging through the render tree on every
     pointermove. The cleanup runs on gesture end + on unmount. */
  const clearTargetHighlight = useCallback(() => {
    const t = lastTargetRef.current;
    if (!t) return;
    t.classList.remove("week-cell--drop-target");
    const pill = t.querySelector(".dnd-drop-time-pill");
    if (pill) pill.remove();
    lastTargetRef.current = null;
  }, []);

  /* Gesture handlers are inlined inside the touch-listener effect so
     the effect can pin its deps to `touchLongPressable` only. Earlier
     this file split enterDrag / exitDrag / updateTarget into their
     own useCallbacks — but those callbacks transitively depended on
     `session`, which is a new object reference on every parent
     render, which made the effect re-run and cleanup the in-flight
     drag every minute when Agenda's `now` clock ticked. Reading
     session via `sessionRef.current` keeps the closure live without
     destabilising the deps. */
  useEffect(() => {
    const el = elRef.current;
    if (!el || !touchLongPressable) return;

    const updateTarget = (clientX, clientY) => {
      const ghost = ghostRef.current;
      if (!ghost) return;
      // Hide the ghost so elementFromPoint sees what's underneath.
      ghost.style.visibility = "hidden";
      const hit = document.elementFromPoint(clientX, clientY);
      ghost.style.visibility = "";
      const cell = hit?.closest?.("[data-cell-day]");
      if (cell === lastTargetRef.current) return;
      clearTargetHighlight();
      if (cell) {
        cell.classList.add("week-cell--drop-target");
        const hour = cell.dataset.cellHour;
        if (hour != null) {
          const pill = document.createElement("span");
          pill.className = "dnd-drop-time-pill";
          pill.textContent = `${String(hour).padStart(2, "0")}:00`;
          pill.style.cssText = "position:absolute;top:4px;left:4px;font-size:11px;font-weight:700;color:#fff;background:var(--teal-dark);padding:2px 6px;border-radius:4px;pointer-events:none;z-index:2;";
          cell.appendChild(pill);
        }
        lastTargetRef.current = cell;
      }
    };

    const enterDrag = (touch) => {
      if (!trySwipeClaim("week-event-dnd")) return false;
      const sess = sessionRef.current;
      draggingRef.current = true;
      setDragging(true);
      haptic.warn();
      const ghost = document.createElement("div");
      ghost.textContent = `${sess.time} · ${shortName(sess.patient)}`;
      ghost.style.cssText = `
        position: fixed;
        left: 0; top: 0;
        transform: translate(${touch.clientX}px, ${touch.clientY}px) translate(-50%, -50%);
        padding: 8px 14px;
        background: var(--teal-dark, #2C6E80);
        color: #fff;
        border-radius: 10px;
        font-family: var(--font-d, system-ui, sans-serif);
        font-weight: 700;
        font-size: 13px;
        box-shadow: 0 12px 32px rgba(0,0,0,0.28);
        pointer-events: none;
        z-index: 9999;
        will-change: transform;
      `;
      document.body.appendChild(ghost);
      ghostRef.current = ghost;
      updateTarget(touch.clientX, touch.clientY);
      return true;
    };

    const exitDrag = (commit) => {
      const sess = sessionRef.current;
      const target = lastTargetRef.current;
      let outcome = "cancelled";
      if (commit && target && onDropSessionRef.current) {
        const day = target.dataset.cellDay;
        const hour = parseInt(target.dataset.cellHour, 10);
        if (day && Number.isFinite(hour)) {
          const sameSlot = day === toISODate(parseShortDateLocal(sess.date))
            && hour === parseInt((sess.time || "0:0").split(":")[0], 10);
          if (sameSlot) {
            outcome = "same-slot";
          } else {
            onDropSessionRef.current(sess.id, new Date(day + "T00:00:00"), hour);
            haptic.success();
            outcome = "dropped";
          }
        }
      }
      clearTargetHighlight();
      if (ghostRef.current) {
        ghostRef.current.remove();
        ghostRef.current = null;
      }
      draggingRef.current = false;
      setDragging(false);
      releaseSwipe("week-event-dnd");
      return outcome;
    };

    const clearTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      setPressing(false);
    };

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      const t0 = e.touches[0];
      startPosRef.current = { x: t0.clientX, y: t0.clientY };
      movedRef.current = false;
      consumedRef.current = false;
      setPressing(true);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setPressing(false);
        if (!enterDrag(t0)) {
          // Coordinator refused — fall back to opening the reschedule
          // sheet so the user still gets a working long-press.
          consumedRef.current = true;
          onSelectSessionRef.current?.(sessionRef.current, "reschedule");
        }
      }, 500);
    };

    const onTouchMove = (e) => {
      const t = e.touches[0];
      if (!t) return;
      if (draggingRef.current) {
        if (e.cancelable) e.preventDefault();
        const ghost = ghostRef.current;
        if (ghost) ghost.style.transform = `translate(${t.clientX}px, ${t.clientY}px) translate(-50%, -50%)`;
        updateTarget(t.clientX, t.clientY);
        return;
      }
      if (!startPosRef.current) return;
      const dx = t.clientX - startPosRef.current.x;
      const dy = t.clientY - startPosRef.current.y;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        movedRef.current = true;
        clearTimer();
      }
    };

    const onTouchEnd = (e) => {
      clearTimer();
      if (draggingRef.current) {
        const outcome = exitDrag(true);
        consumedRef.current = true;
        if (e.cancelable) e.preventDefault();
        if (outcome === "same-slot") {
          onSelectSessionRef.current?.(sessionRef.current, "reschedule");
        }
      }
      startPosRef.current = null;
    };

    const onTouchCancel = () => {
      clearTimer();
      if (draggingRef.current) exitDrag(false);
      startPosRef.current = null;
      movedRef.current = false;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    el.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      clearTimer();
      if (draggingRef.current) exitDrag(false);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
    // touchLongPressable is the only stable input that should drive
    // re-attachment. Everything else flows through the refs above.
  }, [touchLongPressable, clearTargetHighlight]);

  return (
    <div
      ref={elRef}
      className={`week-event ${isCancelledStatus(session.status)?"cancelled":""} ${isDraggable ? "week-event--draggable" : ""} ${touchLongPressable ? "week-event--longpress" : ""} ${pressing ? "week-event--pressing" : ""} ${dragging ? "week-event--dragging" : ""}`}
      draggable={isDraggable}
      onDragStart={isDraggable ? (e) => {
        e.dataTransfer.setData("text/plain", session.id);
        e.dataTransfer.effectAllowed = "move";
      } : undefined}
      style={{
        ...eventStyle,
        top: `calc(var(--week-row-h) * ${startF} + 2px)`,
        height: `calc(var(--week-row-h) * ${dur} - 4px)`,
        opacity: dragging ? 0.35 : undefined,
      }}
      onClick={(e) => {
        if (consumedRef.current) { consumedRef.current = false; return; }
        e.stopPropagation();
        onSelectSession(session);
      }}
      onContextMenu={onEventContextMenu ? (e) => { e.stopPropagation(); onEventContextMenu(e, session); } : undefined}>
      <span className="week-event-time">{session.time}</span> {shortName(session.patient)}
    </div>
  );
}

/* "8-Abr" → Date for the year inferred by parseShortDate. Local helper
   to avoid a wider utils refactor; mirrors the inferYear path used
   throughout the app (we pick the closest year to today). */
function parseShortDateLocal(s) {
  if (!s) return new Date();
  const parts = s.split(/[\s-]+/);
  const day = parseInt(parts[0], 10);
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const mIdx = months.findIndex((m) => m.toLowerCase() === (parts[1] || "").toLowerCase());
  if (!day || mIdx < 0) return new Date();
  const now = new Date();
  let best = now.getFullYear(), bestDiff = Infinity;
  for (const y of [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]) {
    const diff = Math.abs(new Date(y, mIdx, day) - now);
    if (diff < bestDiff) { bestDiff = diff; best = y; }
  }
  return new Date(best, mIdx, day);
}

/* ── DATE HELPERS ── */
function getMonday(d) {
  const m = new Date(d);
  const day = m.getDay();
  m.setDate(m.getDate() - ((day + 6) % 7));
  m.setHours(0,0,0,0);
  return m;
}

function getWeekDays(d) {
  const mon = getMonday(d);
  return Array.from({length:7}, (_,i) => {
    const day = new Date(mon);
    day.setDate(mon.getDate() + i);
    return day;
  });
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function isSameDay(a, b) {
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}

function sortByTime(sessions) {
  return [...sessions].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
}

function buildMonthGrid(year, month) {
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev  = new Date(year, month, 0).getDate();
  const startOffset = (firstDay + 6) % 7;
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push({ num: daysInPrev - startOffset + 1 + i, current: false });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ num: d, current: true });
  const remaining = 42 - cells.length;
  for (let i = 1; i <= remaining; i++) cells.push({ num: i, current: false });
  return cells;
}

/* ── SESSION ROW (shared) ──
   Rail color comes from .session-row + rail-* classes (see styles.css).
   Avatar sizing is unified via the shared <Avatar /> component.

   Selection mode: when `selectionMode` is true, taps toggle membership
   in the parent's selected set instead of opening the session detail.
   The row gets a subtle selected highlight + a check pill replaces the
   chevron so the affordance is unambiguous. */
function SessionRow({ s, onClick, compact, selectionMode, selected, onToggleSelect }) {
  const { t } = useT();
  const tutor = isTutorSession(s);
  const isVirtual = s.modality === "virtual";
  const isTelefonica = s.modality === "telefonica";
  const isADomicilio = s.modality === "a-domicilio";
  const avatarBg = tutor ? "var(--purple)" : isVirtual ? "var(--blue)" : isTelefonica ? "var(--green)" : isADomicilio ? "var(--amber)" : getClientColor(s.colorIdx);
  const modalityColor = isVirtual ? "var(--blue)" : isTelefonica ? "var(--green)" : isADomicilio ? "var(--amber)" : "var(--teal-dark)";
  const modalityKey = isVirtual ? "sessions.virtual" : isTelefonica ? "sessions.telefonica" : isADomicilio ? "sessions.aDomicilio" : "sessions.presencial";
  const handleClick = () => {
    if (selectionMode) onToggleSelect?.(s);
    else onClick?.(s);
  };
  return (
    <div
      className={`row-item session-row ${railClass(s.status)}`}
      key={s.id}
      onClick={handleClick}
      style={selectionMode && selected ? { background: "var(--teal-pale)" } : undefined}
    >
      <div style={{ width: compact ? 40 : 44, textAlign:"center", flex:"none" }}>
        <div style={{ fontFamily:"var(--font-d)", fontSize: compact ? "var(--text-sm)" : "var(--text-md)", fontWeight:800, color:"var(--teal-dark)" }}>{s.time}</div>
      </div>
      <Avatar initials={tutor ? tutorDisplayInitials(s) : s.initials} color={avatarBg} size="sm" />
      <div className="row-content">
        <div className="row-title">
          {s.patient}
          {tutor && (
            <span
              className="badge badge-purple"
              style={{
                marginLeft: 6,
                fontSize: "var(--text-eyebrow)",
                textTransform: "uppercase",
                letterSpacing: 0.3,
              }}
            >
              {t("sessions.tutor")}
            </span>
          )}
        </div>
        <div className="row-sub">
          {s.time} - {(() => { const [h,m] = (s.time||"0:0").split(":"); const end = new Date(0,0,0,+h,+m); end.setMinutes(end.getMinutes()+(s.duration||60)); return `${String(end.getHours()).padStart(2,"0")}:${String(end.getMinutes()).padStart(2,"0")}`; })()}
          <span style={{ fontSize:"var(--text-eyebrow)", fontWeight:700, color: modalityColor, marginLeft:6, textTransform:"uppercase" }}>
            {t(modalityKey)}
          </span>
        </div>
      </div>
      <span className={`session-status ${statusClass(s.status)}`}>{t(`sessions.${s.status}`)}</span>
      {selectionMode ? (
        <span style={{
          width: 22, height: 22, borderRadius: "50%", marginLeft: 8,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: selected ? "var(--teal)" : "transparent",
          border: selected ? "none" : "1.5px solid var(--charcoal-xl)",
          color: "var(--white)", flexShrink: 0,
        }}>
          {selected && <IconCheck size={12} />}
        </span>
      ) : !compact ? <span className="row-chevron">›</span> : null}
    </div>
  );
}

/* ── DAY PANEL (just one day's session list, no week strip) ── */
function DayPanel({ panelDate, onSelectSession, upcomingSessions, filterPatientName, selectionMode, selectedSet, onToggleSelect }) {
  const { t, strings } = useT();
  const DOW = strings.daysShort;
  const dateStr = formatShortDate(panelDate);
  const daySessions = sortByTime(upcomingSessions.filter(s => s.date === dateStr));
  const dayName = DOW[(panelDate.getDay() + 6) % 7];

  return (
    <>
      <div style={{ padding:"0 16px 4px" }}>
        <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:800, color:"var(--charcoal)", marginBottom:2 }}>{dayName} {dateStr}</div>
        <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)", marginBottom:10 }}>{daySessions.length===0 ? t("sessions.noSessions") : t("sessions.sessionsCount", { count: daySessions.length })}</div>
      </div>
      <div style={{ padding:"0 16px 12px" }}>
        {daySessions.length === 0
          ? filterPatientName
            ? <div className="card" style={{ padding:32, textAlign:"center" }}>
                <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)" }}>{t("agenda.noSessionsForPatient", { name: filterPatientName })}</div>
              </div>
            : <div className="card" style={{ padding:32, textAlign:"center" }}>
                <div style={{ marginBottom:10, color:"var(--teal-light)" }}><IconSun size={32} /></div>
                <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:700, color:"var(--charcoal)", marginBottom:4 }}>{t("sessions.freeDay")}</div>
                <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)" }}>{t("sessions.freeDayMessage")}</div>
              </div>
          : <div className="card">
              {daySessions.map(s => (
                <SessionRow key={s.id} s={s} onClick={onSelectSession}
                  selectionMode={selectionMode}
                  selected={selectedSet?.has(s.id)}
                  onToggleSelect={onToggleSelect} />
              ))}
            </div>
        }
      </div>
    </>
  );
}

/* ── HEADER LABEL with "Hoy" affordance ── */
function HeaderLabel({ children, isCurrent, onJumpToday, t }) {
  return (
    <button
      type="button"
      onClick={onJumpToday}
      className="agenda-label-btn"
      aria-label={t("sessions.today")}
    >
      {children}
      {!isCurrent && <span className="agenda-today-pill">{t("sessions.today")}</span>}
    </button>
  );
}

/* ── DAY VIEW ── */
function DayView({ selectedDate, setSelectedDate, onSelectSession, upcomingSessions, jumpToToday, filterPatientName, selectionMode, selectedSet, onToggleSelect }) {
  const { t, strings } = useT();
  const DOW = strings.daysShort;
  const sessionDateSet = useMemo(() => new Set(upcomingSessions.map(s => s.date)), [upcomingSessions]);
  const swipe = useSwipe(
    useCallback(() => setSelectedDate(d => addDays(d, 1)), [setSelectedDate]),
    useCallback(() => setSelectedDate(d => addDays(d, -1)), [setSelectedDate])
  );
  // Separate swipe for the week strip: ±7 days so horizontal drags on
  // the day-of-week row jump a whole week instead of a single day.
  const weekSwipe = useSwipe(
    useCallback(() => setSelectedDate(d => addDays(d, 7)), [setSelectedDate]),
    useCallback(() => setSelectedDate(d => addDays(d, -7)), [setSelectedDate])
  );
  const prevDay = addDays(selectedDate, -1);
  const nextDay = addDays(selectedDate, 1);
  const shared = { onSelectSession, upcomingSessions, filterPatientName, selectionMode, selectedSet, onToggleSelect };

  const weekDays = getWeekDays(selectedDate);
  const prevWeekDays = getWeekDays(addDays(selectedDate, -7));
  const nextWeekDays = getWeekDays(addDays(selectedDate, 7));
  const monday = weekDays[0];
  const sunday = weekDays[6];
  const weekLabel = monday.getMonth() === sunday.getMonth()
    ? `${monday.getDate()}–${sunday.getDate()} ${strings.monthsShort[monday.getMonth()]}`
    : `${formatShortDate(monday)} – ${formatShortDate(sunday)}`;
  const isCurrent = isSameDay(selectedDate, TODAY);

  const renderCalStrip = (days) => (
    <div className="cal-strip">
      {days.map((d,i) => {
        const ds = formatShortDate(d);
        const isActive = isSameDay(d, selectedDate);
        const isToday = isSameDay(d, TODAY);
        const hasSess = sessionDateSet.has(ds);
        return (
          <div key={i} className={`cal-day ${isActive?"active":""} ${hasSess?"has-sessions":""} ${isToday&&!isActive?"today":""}`} role="button" tabIndex={0} onClick={() => setSelectedDate(d)}>
            <span className="cal-day-name">{DOW[i]}</span>
            <span className="cal-day-num">{d.getDate()}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px 10px" }}>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, -1))}>‹</button>
        <HeaderLabel isCurrent={isCurrent} onJumpToday={jumpToToday} t={t}>
          <span style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)", fontWeight:600 }}>{weekLabel}</span>
        </HeaderLabel>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, 1))}>›</button>
      </div>
      <div {...weekSwipe.containerProps} style={{ ...weekSwipe.containerProps.style, paddingBottom: 8 }}>
        <div style={weekSwipe.stripStyle}>
          <div style={weekSwipe.panelStyle}>{renderCalStrip(prevWeekDays)}</div>
          <div style={weekSwipe.panelStyle}>{renderCalStrip(weekDays)}</div>
          <div style={weekSwipe.panelStyle}>{renderCalStrip(nextWeekDays)}</div>
        </div>
      </div>
      <div {...swipe.containerProps}>
        <div style={swipe.stripStyle}>
          <div style={swipe.panelStyle}><DayPanel panelDate={prevDay} {...shared} /></div>
          <div style={swipe.panelStyle}><DayPanel panelDate={selectedDate} {...shared} /></div>
          <div style={swipe.panelStyle}><DayPanel panelDate={nextDay} {...shared} /></div>
        </div>
      </div>
    </>
  );
}

/* ── Helper: parse "HH:MM" to fractional hours from grid start (8:00) ── */
function timeToFloat(time) {
  const [h, m] = (time || "08:00").split(":").map(Number);
  return (h || 8) + (m || 0) / 60 - 8;
}

/* ── WEEK DAYS PANEL (just the day headers + grid cells, no time labels) ── */
function WeekDaysPanel({ weekDate, selectedDate, setSelectedDate, setView, onSelectSession, onCellTap, onDropSession, canDrag, onEventContextMenu, upcomingSessions, showWeekends, hours }) {
  const { strings } = useT();
  const DOW = strings.daysShort;
  const weekDays = getWeekDays(weekDate);
  const visibleDays = showWeekends ? weekDays : weekDays.slice(0, 5);
  const visibleDow = showWeekends ? DOW : DOW.slice(0, 5);
  const cols = `repeat(${visibleDays.length}, 1fr)`;
  const [dropTarget, setDropTarget] = useState(null); // `${dayIdx}:${hourIdx}`

  // Group sessions by date for quick lookup
  const sessionsByDate = useMemo(() => {
    const map = new Map();
    for (const s of upcomingSessions) {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date).push(s);
    }
    return map;
  }, [upcomingSessions]);

  return (
    <div>
      <div className="week-header-row" style={{ gridTemplateColumns: cols, padding: 0 }}>
        {visibleDays.map((d,i) => {
          const isActive = isSameDay(d, selectedDate);
          const isToday = isSameDay(d, TODAY);
          return (
            <div key={i} className="week-day-head" style={{ cursor:"pointer" }} onClick={() => { setSelectedDate(d); setView("day"); }}>
              <span className="week-day-name">{visibleDow[i]}</span>
              <span className={`week-day-num ${isActive?"active":""} ${isToday&&!isActive?"today":""}`}>{d.getDate()}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display:"grid", gridTemplateColumns: cols }}>
        {visibleDays.map((d, dIdx) => {
          const ds = formatShortDate(d);
          const daySess = sessionsByDate.get(ds) || [];
          return (
            <div key={dIdx} className="week-day-col" style={{ position:"relative", borderLeft: dIdx > 0 ? "1px solid var(--border-lt)" : undefined }}>
              {/* Background hour grid lines. Touch-drag uses
                  data-cell-day + data-cell-hour read via
                  document.elementFromPoint; the desktop drop path
                  uses the React onDrop handler below. Both routes
                  call the same onDropSession with the same args. */}
              {hours.map((hour, hIdx) => {
                const isDropTarget = dropTarget === `${dIdx}:${hIdx}`;
                return (
                  <div key={hIdx} className={`week-cell ${isDropTarget ? "week-cell--drop-target" : ""}`}
                    role="button" tabIndex={0}
                    data-cell-day={toISODate(d)}
                    data-cell-hour={hour}
                    onClick={() => onCellTap && onCellTap(d, hour)}
                    onDragOver={canDrag ? (e) => { e.preventDefault(); setDropTarget(`${dIdx}:${hIdx}`); } : undefined}
                    onDragLeave={canDrag ? () => setDropTarget(prev => prev === `${dIdx}:${hIdx}` ? null : prev) : undefined}
                    onDrop={canDrag ? (e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData("text/plain");
                      setDropTarget(null);
                      if (id && onDropSession) onDropSession(id, d, hour);
                    } : undefined}
                  >
                    {/* Desktop drop-time indicator. The mobile drag
                        path inserts an equivalent pill via direct DOM
                        manipulation (see LongPressEvent.updateTarget),
                        rendered the same way. */}
                    {isDropTarget && (
                      <span style={{
                        position: "absolute", top: 4, left: 4,
                        fontSize: 11, fontWeight: 700,
                        color: "var(--white)",
                        background: "var(--teal-dark)",
                        padding: "2px 6px",
                        borderRadius: 4,
                        pointerEvents: "none",
                      }}>
                        {`${String(hour).padStart(2, "0")}:00`}
                      </span>
                    )}
                  </div>
                );
              })}
              {/* Session events positioned absolutely */}
              {daySess.map(sess => {
                const startF = timeToFloat(sess.time);
                const dur = (sess.duration || 60) / 60; // hours
                if (startF < 0 || startF >= hours.length) return null;
                const eventStyle = (() => {
                  if (isCancelledStatus(sess.status)) return undefined;
                  if (isTutorSession(sess)) return { background:"var(--purple-bg)", borderLeftColor:"var(--purple)", color:"var(--charcoal)" };
                  if (sess.modality === "virtual") return { background:"var(--blue-bg)", borderLeftColor:"var(--blue)", color:"var(--charcoal)" };
                  if (sess.modality === "telefonica") return { background:"var(--green-bg)", borderLeftColor:"var(--green)", color:"var(--charcoal)" };
                  const c = getClientColor(sess.colorIdx);
                  return { background: `${c}26`, borderLeftColor: c, color: "var(--charcoal)" };
                })();
                const isDraggable = canDrag && !isCancelledStatus(sess.status);
                const touchLongPressable = !canDrag && !isCancelledStatus(sess.status);
                return (
                  <LongPressEvent key={sess.id}
                    session={sess}
                    eventStyle={eventStyle}
                    startF={startF}
                    dur={dur}
                    isDraggable={isDraggable}
                    touchLongPressable={touchLongPressable}
                    onSelectSession={onSelectSession}
                    onDropSession={onDropSession}
                    onEventContextMenu={onEventContextMenu} />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── WEEK VIEW ── */
function WeekView({ selectedDate, setSelectedDate, setView, onSelectSession, onCellTap, onDropSession, canDrag, onEventContextMenu, upcomingSessions, now, jumpToToday }) {
  const { t, strings } = useT();
  const HOURS = strings.hours;
  const [showWeekends, setShowWeekends] = useState(false);
  const swipe = useSwipe(
    useCallback(() => setSelectedDate(d => addDays(d, 7)), [setSelectedDate]),
    useCallback(() => setSelectedDate(d => addDays(d, -7)), [setSelectedDate])
  );
  const prevWeek = addDays(selectedDate, -7);
  const nextWeek = addDays(selectedDate, 7);
  const weekDays = getWeekDays(selectedDate);
  const monday = weekDays[0];
  const weekLabel = `${t("sessions.weekOf")} ${formatShortDate(monday)}`;
  const isCurrent = weekDays.some(d => isSameDay(d, TODAY));
  const shared = { selectedDate, setSelectedDate, setView, onSelectSession, onCellTap, onDropSession, canDrag, onEventContextMenu, upcomingSessions, showWeekends, hours: HOURS };

  // "Ahora" line: only when today is in the visible week and within work hours
  const visibleDays = (showWeekends ? weekDays : weekDays.slice(0, 5));
  const todayIdx = visibleDays.findIndex(d => isSameDay(d, now));
  const nowHourFloat = now.getHours() + now.getMinutes() / 60;
  const showNow = todayIdx >= 0 && nowHourFloat >= 8 && nowHourFloat <= 21;
  const dayCount = visibleDays.length;

  return (
    <>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", padding:"0 16px 8px", gap:8 }}>
        <span style={{ fontSize:"var(--text-xs)", fontWeight:600, color:"var(--charcoal-xl)" }}>{t("sessions.weekends")}</span>
        <Toggle on={showWeekends} onToggle={() => setShowWeekends(v => !v)} />
      </div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 16px 8px" }}>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, -7))}>‹</button>
        <HeaderLabel isCurrent={isCurrent} onJumpToday={jumpToToday} t={t}>
          <span style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-lg)", fontWeight:800, color:"var(--charcoal)" }}>{weekLabel}</span>
        </HeaderLabel>
        <button className="month-nav-btn" onClick={() => setSelectedDate(addDays(selectedDate, 7))}>›</button>
      </div>
      <div style={{ display:"flex", padding:"0 16px", position:"relative" }}>
        <div className="week-time-col">
          <div className="week-header-spacer" />
          {HOURS.map(hour => (
            <div key={hour} className="week-time-label-static">{hour}</div>
          ))}
        </div>
        <div {...swipe.containerProps} style={{ ...swipe.containerProps.style, flex:1 }}>
          <div style={swipe.stripStyle}>
            <div style={swipe.panelStyle}><WeekDaysPanel weekDate={prevWeek} {...shared} /></div>
            <div style={swipe.panelStyle}><WeekDaysPanel weekDate={selectedDate} {...shared} /></div>
            <div style={swipe.panelStyle}><WeekDaysPanel weekDate={nextWeek} {...shared} /></div>
          </div>
        </div>
        {showNow && (
          <div className="week-now-line"
            aria-hidden="true"
            style={{
              left: `calc(44px + (100% - 44px) * ${todayIdx} / ${dayCount})`,
              width: `calc((100% - 44px) / ${dayCount})`,
              top: `calc(52px + var(--week-row-h) * ${nowHourFloat - 8})`,
            }} />
        )}
      </div>
    </>
  );
}

/* ── MONTH GRID PANEL (just the calendar cells, no header/dow/sessions) ──
   Whole-day drag-and-drop: long-press a cell that has sessions, then
   drag to another cell to bulk-move every session from source-day to
   target-day (each session keeps its own time). The actual write +
   confirm modal lives in MonthView; this panel only emits the
   (srcDayIso, targetDayIso) pair via onMoveDay.

   We piggy-back on the same elementFromPoint pattern the week-view
   LongPressEvent uses: cells get data-month-day attributes, and the
   gesture handler reads them off whatever the finger lands on. */
function MonthGridPanel({ year, month, selectedDate, setSelectedDate, sessionsByDate, onMoveDay, canDrag }) {
  const cells = buildMonthGrid(year, month);
  const selectedDateStr = formatShortDate(selectedDate);
  const isCurrentMonth = selectedDate.getMonth() === month && selectedDate.getFullYear() === year;
  const gridRef = useRef(null);

  // Native touch DnD for month-day cells. Attached at the grid level
  // so a single set of listeners handles every cell (cheaper than
  // per-cell listeners and gives us a stable container we can scope
  // elementFromPoint within).
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    if (!canDrag) return;

    let timer = null;
    let startPos = null;
    let dragging = false;
    let sourceCell = null;
    let lastTarget = null;
    let ghost = null;

    const clearTarget = () => {
      if (lastTarget) {
        lastTarget.classList.remove("month-cell--drop-target");
        lastTarget = null;
      }
    };

    const updateTarget = (clientX, clientY) => {
      if (!ghost) return;
      ghost.style.visibility = "hidden";
      const el = document.elementFromPoint(clientX, clientY);
      ghost.style.visibility = "";
      const cell = el?.closest?.("[data-month-day]");
      if (cell === lastTarget) return;
      clearTarget();
      // Only highlight cells that aren't the source.
      if (cell && cell !== sourceCell) {
        cell.classList.add("month-cell--drop-target");
        lastTarget = cell;
      }
    };

    const enterDrag = (touch, cell, dayCount) => {
      if (!trySwipeClaim("month-cell-dnd")) return false;
      dragging = true;
      sourceCell = cell;
      cell.classList.add("month-cell--dragging-source");
      haptic.warn();
      ghost = document.createElement("div");
      ghost.textContent = `Mover ${dayCount} sesión${dayCount === 1 ? "" : "es"}`;
      ghost.style.cssText = `
        position: fixed; left: 0; top: 0;
        transform: translate(${touch.clientX}px, ${touch.clientY}px) translate(-50%, -50%);
        padding: 8px 14px;
        background: var(--teal-dark, #2C6E80);
        color: #fff;
        border-radius: 10px;
        font-family: var(--font-d, system-ui, sans-serif);
        font-weight: 700;
        font-size: 13px;
        box-shadow: 0 12px 32px rgba(0,0,0,0.28);
        pointer-events: none;
        z-index: 9999;
        will-change: transform;
      `;
      document.body.appendChild(ghost);
      updateTarget(touch.clientX, touch.clientY);
      return true;
    };

    const exitDrag = (commit) => {
      let firedDrop = false;
      if (commit && lastTarget && sourceCell && lastTarget !== sourceCell && onMoveDay) {
        const src = sourceCell.dataset.monthDay;
        const tgt = lastTarget.dataset.monthDay;
        if (src && tgt) {
          onMoveDay(src, tgt);
          haptic.success();
          firedDrop = true;
        }
      }
      clearTarget();
      if (sourceCell) {
        sourceCell.classList.remove("month-cell--dragging-source");
        sourceCell = null;
      }
      if (ghost) { ghost.remove(); ghost = null; }
      dragging = false;
      releaseSwipe("month-cell-dnd");
      return firedDrop;
    };

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      const t0 = e.touches[0];
      const cell = (e.target).closest?.("[data-month-day]");
      if (!cell) return;
      const dayCount = parseInt(cell.dataset.monthDayCount || "0", 10);
      if (dayCount === 0) return; // empty days aren't pickable
      startPos = { x: t0.clientX, y: t0.clientY, cell, dayCount };
      timer = setTimeout(() => {
        timer = null;
        if (!startPos) return;
        if (!enterDrag(t0, startPos.cell, startPos.dayCount)) {
          startPos = null;
        }
      }, 500);
    };

    const onTouchMove = (e) => {
      const t = e.touches[0];
      if (!t) return;
      if (dragging) {
        if (e.cancelable) e.preventDefault();
        if (ghost) ghost.style.transform = `translate(${t.clientX}px, ${t.clientY}px) translate(-50%, -50%)`;
        updateTarget(t.clientX, t.clientY);
        return;
      }
      if (!startPos) return;
      const dx = t.clientX - startPos.x;
      const dy = t.clientY - startPos.y;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        clearTimeout(timer); timer = null;
        startPos = null;
      }
    };

    const onTouchEnd = (e) => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (dragging) {
        exitDrag(true);
        if (e.cancelable) e.preventDefault();
      }
      startPos = null;
    };

    const onTouchCancel = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (dragging) exitDrag(false);
      startPos = null;
    };

    grid.addEventListener("touchstart", onTouchStart, { passive: true });
    grid.addEventListener("touchmove", onTouchMove, { passive: false });
    grid.addEventListener("touchend", onTouchEnd, { passive: false });
    grid.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      if (timer) clearTimeout(timer);
      if (dragging) exitDrag(false);
      grid.removeEventListener("touchstart", onTouchStart);
      grid.removeEventListener("touchmove", onTouchMove);
      grid.removeEventListener("touchend", onTouchEnd);
      grid.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [canDrag, onMoveDay]);

  return (
    <div className="month-days-grid" ref={gridRef}>
      {cells.map((cell, i) => {
        const cellDate = new Date(year, month + (cell.current ? 0 : (i < 7 ? -1 : 1)), cell.num);
        const cellStr = formatShortDate(cellDate);
        const isToday  = isSameDay(cellDate, TODAY);
        const isActive = isCurrentMonth && cellStr === selectedDateStr;
        const sessions = sessionsByDate.get(cellStr) || [];
        const hasPresencial = sessions.some(s => !isTutorSession(s) && s.modality !== "virtual" && s.modality !== "telefonica");
        const hasVirtual = sessions.some(s => !isTutorSession(s) && s.modality === "virtual");
        const hasTelefonica = sessions.some(s => !isTutorSession(s) && s.modality === "telefonica");
        const hasTutor = sessions.some(s => isTutorSession(s));
        return (
          <div key={i} className={`month-cell ${isActive?"active":""} ${isToday&&!isActive?"today":""} ${!cell.current?"other-month":""}`}
            role="button" tabIndex={0}
            data-month-day={toISODate(cellDate)}
            data-month-day-count={sessions.length}
            onClick={() => setSelectedDate(cellDate)}>
            <span className="month-cell-num">{cell.num}</span>
            {(hasPresencial || hasVirtual || hasTelefonica || hasTutor) && (
              <div className="month-dots">
                {/* Saturated dot-only variants: brand teal/blue/purple all land
                    in the same cool-blue band at this size and become
                    indistinguishable. Deeper teal + true blue + magenta-leaning
                    purple pull each hue into its own corner of the wheel.
                    Telefónica reuses brand green so it reads distinct from
                    presencial's teal at this size. */}
                {hasPresencial && <span className="month-dot-color" style={{ background: "var(--modality-presencial)" }} />}
                {hasVirtual && <span className="month-dot-color" style={{ background: "var(--modality-virtual)" }} />}
                {hasTelefonica && <span className="month-dot-color" style={{ background: "var(--modality-telefonica)" }} />}
                {hasTutor && <span className="month-dot-color" style={{ background: "var(--modality-a-domicilio)" }} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── MONTH VIEW ── */
function MonthView({ onSelectSession, selectedDate, setSelectedDate, upcomingSessions, jumpToToday, filterPatientName, onMoveDay, canMoveDay }) {
  const { t, strings } = useT();
  const MONTH_NAMES = strings.months;
  const DOW = strings.daysShort;
  const displayMonth = selectedDate.getMonth();
  const displayYear  = selectedDate.getFullYear();
  const isCurrent = displayMonth === TODAY.getMonth() && displayYear === TODAY.getFullYear();

  const goMonth = useCallback((delta) => {
    setSelectedDate(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }, [setSelectedDate]);

  const sessionsByDate = useMemo(() => {
    const map = new Map();
    for (const s of upcomingSessions) {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date).push(s);
    }
    return map;
  }, [upcomingSessions]);
  const swipe = useSwipe(
    useCallback(() => goMonth(1), [goMonth]),
    useCallback(() => goMonth(-1), [goMonth])
  );

  const prevMonth = displayMonth === 0 ? 11 : displayMonth - 1;
  const prevYear = displayMonth === 0 ? displayYear - 1 : displayYear;
  const nextMonth = displayMonth === 11 ? 0 : displayMonth + 1;
  const nextYear = displayMonth === 11 ? displayYear + 1 : displayYear;
  const shared = { selectedDate, setSelectedDate, sessionsByDate, onMoveDay, canDrag: canMoveDay };

  const selectedDateStr = formatShortDate(selectedDate);
  const daySessions = sortByTime(upcomingSessions.filter(s => s.date === selectedDateStr));

  return (
    <>
      <div className="month-header">
        <button className="month-nav-btn" onClick={() => goMonth(-1)}>‹</button>
        <HeaderLabel isCurrent={isCurrent} onJumpToday={jumpToToday} t={t}>
          <span className="month-title">{MONTH_NAMES[displayMonth]} {displayYear}</span>
        </HeaderLabel>
        <button className="month-nav-btn" onClick={() => goMonth(1)}>›</button>
      </div>
      <div className="month-grid">
        <div className="month-dow-row">{DOW.map(d => <div key={d} className="month-dow">{d}</div>)}</div>
        <div {...swipe.containerProps}>
          <div style={swipe.stripStyle}>
            <div style={swipe.panelStyle}><MonthGridPanel year={prevYear} month={prevMonth} {...shared} /></div>
            <div style={swipe.panelStyle}><MonthGridPanel year={displayYear} month={displayMonth} {...shared} /></div>
            <div style={swipe.panelStyle}><MonthGridPanel year={nextYear} month={nextMonth} {...shared} /></div>
          </div>
        </div>
      </div>
      <div style={{ padding:"16px 16px 0" }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:10 }}>
          <div className="section-title">{selectedDateStr}</div>
          <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)" }}>{daySessions.length===0?t("sessions.noSessions"):t("sessions.sessionsCount", { count: daySessions.length })}</div>
        </div>
        {daySessions.length === 0
          ? filterPatientName
            ? <div className="card" style={{ padding:"20px 16px", textAlign:"center" }}>
                <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)" }}>{t("agenda.noSessionsForPatient", { name: filterPatientName })}</div>
              </div>
            : <div className="card" style={{ padding:"20px 16px", textAlign:"center" }}>
                <div style={{ marginBottom:6, color:"var(--teal-light)" }}><IconSun size={32} /></div>
                <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)" }}>{t("sessions.freeDay")}</div>
              </div>
          : <div className="card">
              {daySessions.map(s => <SessionRow key={s.id} s={s} onClick={onSelectSession} compact />)}
            </div>
        }
      </div>
    </>
  );
}

/* ── AGENDA ROOT ── */
export function Agenda() {
  const { upcomingSessions, patients, createSession, onCancelSession, onMarkCompleted, deleteSession, rescheduleSession, updateSessionModality, updateSessionRate, updateCancelReason, notes, createNote, updateNote, deleteNote, mutating, consumeAgendaView, readOnly, showSuccess, showToast } = useCardigan();
  const { t } = useT();
  const { isTabletSplit } = useViewport();
  // Default to week view on desktop (more horizontal room) and day view on
  // mobile. A cross-screen pending view (consumeAgendaView) always wins.
  // iPad portrait/landscape (820+) gets the week view by default — there's
  // room for it, and the week is the most useful agenda layout when not
  // strictly mobile. Phone stays on day view.
  const [view, setView] = useState(() => consumeAgendaView?.() || (isTabletSplit ? "week" : "day"));
  const [selectedDate, setSelectedDate] = useState(new Date(TODAY));
  const [selectedSession, setSelectedSession] = useState(null);
  // Bulk selection mode — only the day view participates today (the
  // place a therapist actually goes to "cancel everything next week").
  // Week + Month would require richer hit-testing on the event chips
  // and are an obvious follow-up.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedSet, setSelectedSet] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const onToggleSelect = useCallback((s) => {
    haptic.tap();
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
      return next;
    });
  }, []);
  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedSet(new Set());
  }, []);

  // Apply a bulk action (cancel without charge / cancel with charge /
  // delete) to every session in the current selection. Each action is
  // routed through the existing per-session handlers so accounting
  // semantics stay identical to the single-session flow — we don't
  // bypass the predicate that decides whether `cancelled` counts. The
  // batch is Promise.allSettled so one failure doesn't block the rest;
  // the toast summarises ok / failed counts.
  const bulkApply = useCallback(async (kind) => {
    if (bulkBusy) return;
    if (selectedSet.size === 0) return;
    const ids = Array.from(selectedSet);
    const list = upcomingSessions.filter((s) => selectedSet.has(s.id));
    setBulkBusy(true);
    try {
      const tasks = list.map((s) => {
        if (kind === "delete") return deleteSession(s.id);
        if (kind === "cancel-charge") return onCancelSession(s, true, t("agenda.bulkChargeReason"));
        return onCancelSession(s, false, null);
      });
      const results = await Promise.allSettled(tasks);
      const ok = results.filter((r) => r.status === "fulfilled" && r.value !== false).length;
      const failed = ids.length - ok;
      if (failed === 0) {
        showSuccess?.(t("agenda.bulkSuccess", { n: ok }));
      } else {
        showToast?.(t("agenda.bulkPartial", { n: ok, failed }), "info");
      }
      exitSelection();
    } finally {
      setBulkBusy(false);
    }
  }, [bulkBusy, selectedSet, upcomingSessions, deleteSession, onCancelSession, t, showSuccess, showToast, exitSelection]);
  // When the user leaves the day view OR enters readOnly, abort
  // selection so the bar doesn't outlive its context.
  useEffect(() => {
    if (selectionMode && (view !== "day" || readOnly)) exitSelection();
  }, [view, readOnly, selectionMode, exitSelection]);
  // "reschedule" when the sheet was opened via a long-press on a week
  // event (mobile drag-reschedule replacement); cleared on close. Null
  // for all other entry points.
  const [selectedSessionMode, setSelectedSessionMode] = useState(null);
  const [editingNote, setEditingNote] = useState(null);
  const [filterPatientId, setFilterPatientId] = useState("");
  const [newSessionPrefill, setNewSessionPrefill] = useState(null);
  const [calendarSheetOpen, setCalendarSheetOpen] = useState(false);
  // Hide the CTA pill once the user has linked their calendar. Until
  // the first /api/calendar-token GET resolves we suppress the pill
  // too — flashing it in for one frame before hiding it again would
  // be more disruptive than waiting a beat.
  const calendarFeed = useCalendarToken();
  const showCalendarCTA = !readOnly && calendarFeed.loaded && !calendarFeed.hasToken;

  // "Ahora" tick — re-render every minute so the now-line stays current
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const filteredSessions = useMemo(() => {
    if (!filterPatientId) return upcomingSessions;
    return upcomingSessions.filter(s => s.patient_id === filterPatientId);
  }, [upcomingSessions, filterPatientId]);

  const filterPatientName = filterPatientId ? patients.find(p => p.id === filterPatientId)?.name || "" : "";

  const handleCellTap = useCallback((date, hour) => {
    setNewSessionPrefill({ date: toISODate(date), time: hour });
  }, []);

  // Drag-and-drop reschedule (desktop week view): accept drops on any
  // hour cell, move the session to that slot. Keeps duration intact;
  // uses formatShortDate + the hour string which already matches the
  // project's "D MMM" + "HH:MM" format.
  const handleDropSession = useCallback(async (sessionId, date, hour) => {
    const sess = upcomingSessions.find(s => s.id === sessionId);
    if (!sess) return;
    const newShortDate = formatShortDate(date);
    if (sess.date === newShortDate && sess.time === hour) return;
    await rescheduleSession(sessionId, newShortDate, hour, sess.duration || 60);
  }, [upcomingSessions, rescheduleSession]);

  // ── Month-view "move whole day" ──
  // The MonthGridPanel emits (srcDayIso, targetDayIso) when the user
  // drops a day onto another. We confirm before applying because a
  // single drag mutates N sessions; an accidental drop could move a
  // dozen rows. The actual writes go through the same
  // rescheduleSession path, in a Promise.allSettled batch so a single
  // failure doesn't half-apply.
  const [moveDayPair, setMoveDayPair] = useState(null); // { srcIso, tgtIso, sessions }
  const [moveDayBusy, setMoveDayBusy] = useState(false);
  const handleMonthMoveDay = useCallback((srcIso, tgtIso) => {
    if (!srcIso || !tgtIso || srcIso === tgtIso) return;
    // Resolve src + tgt to the formatShortDate strings the rest of the
    // app uses, then collect the sessions the user is about to move.
    const srcDate = new Date(srcIso + "T00:00:00");
    const srcShort = formatShortDate(srcDate);
    const sessions = upcomingSessions.filter((s) => s.date === srcShort);
    if (sessions.length === 0) return;
    setMoveDayPair({ srcIso, tgtIso, sessions });
  }, [upcomingSessions]);
  const confirmMonthMoveDay = useCallback(async () => {
    if (!moveDayPair || moveDayBusy) return;
    setMoveDayBusy(true);
    try {
      const { tgtIso, sessions } = moveDayPair;
      const newShortDate = formatShortDate(new Date(tgtIso + "T00:00:00"));
      const tasks = sessions.map((s) =>
        rescheduleSession(s.id, newShortDate, s.time, s.duration || 60)
      );
      const results = await Promise.allSettled(tasks);
      const ok = results.filter((r) => r.status === "fulfilled" && r.value !== false).length;
      const failed = sessions.length - ok;
      if (failed === 0) {
        showSuccess?.(t("agenda.moveDaySuccess", { n: ok }));
      } else {
        showToast?.(t("agenda.moveDayPartial", { n: ok, failed }), "info");
      }
      setMoveDayPair(null);
    } finally {
      setMoveDayBusy(false);
    }
  }, [moveDayPair, moveDayBusy, rescheduleSession, t, showSuccess, showToast]);

  const ctxMenu = useContextMenu();
  const handleEventContextMenu = useCallback((e, sess) => {
    const isCancelled = isCancelledStatus(sess.status);
    const isCompleted = sess.status === "completed";
    const items = [
      { key: "open", label: t("sessions.session"), icon: <IconCalendar size={15} />, onSelect: () => setSelectedSession(sess) },
      { divider: true },
    ];
    if (!isCompleted) {
      items.push({ key: "complete", label: t("sessions.markCompleted"), icon: <IconCheck size={15} />,
        onSelect: async () => { await onMarkCompleted(sess); } });
    }
    if (!isCancelled) {
      items.push({ key: "cancel", label: t("sessions.markCancelled") || "Cancelar sesión", icon: <IconX size={15} />,
        onSelect: async () => { await onCancelSession(sess, false, null); } });
    }
    items.push({ divider: true });
    items.push({ key: "delete", label: t("delete"), icon: <IconTrash size={15} />, destructive: true,
      onSelect: async () => { await deleteSession(sess.id); } });
    ctxMenu.openAt(e, items);
  }, [ctxMenu, onMarkCompleted, onCancelSession, deleteSession, t]);

  const jumpToToday = useCallback(() => {
    setSelectedDate(new Date(TODAY));
  }, []);

  const handleOpenNote = async (session) => {
    const existing = notes?.find(n => n.session_id === session.id);
    if (existing) {
      setEditingNote(existing);
    } else {
      const patient = patients?.find(p => p.name === session.patient);
      const note = await createNote({ patientId: patient?.id || session.patient_id, sessionId: session.id });
      if (note) setEditingNote(note);
    }
    setSelectedSession(null);
  };

  return (
    <>
    {editingNote && (
      <NoteEditor
        note={editingNote}
        onSave={async ({ title, content }) => await updateNote(editingNote.id, { title, content })}
        onDelete={async () => { await deleteNote(editingNote.id); }}
        onClose={() => setEditingNote(null)}
      />
    )}
    <div className="page" data-tour="agenda-section">
      <div style={{ paddingTop:16 }}>
        {showCalendarCTA && (
          <div style={{ padding:"0 16px 12px" }}>
            <button
              type="button"
              className="agenda-calendar-link"
              onClick={() => setCalendarSheetOpen(true)}
              aria-label={t("agenda.calendarSyncCTA")}
            >
              <span className="agenda-calendar-link-icon"><IconCalendar size={16} /></span>
              <span className="agenda-calendar-link-label">{t("agenda.calendarSyncCTA")}</span>
              <IconChevron />
            </button>
          </div>
        )}
        <div style={{ padding:"0 16px 14px" }}>
          <SegmentedControl
            dataTour="agenda-toggle"
            value={view}
            onChange={setView}
            items={[
              { k: "day",   l: t("agenda.dayView") },
              { k: "week",  l: t("agenda.weekView") },
              { k: "month", l: t("agenda.monthView") },
            ]}
          />
        </div>
        {/* Selection mode toggle — visible only on day view, hidden in
            readOnly mode (admin "view as user" + expired trial). The
            button stays subtle until the user enters selection mode,
            at which point it disappears (the bulk bar takes over). */}
        {view === "day" && !readOnly && !selectionMode && (
          <div style={{ padding:"0 16px 10px", textAlign:"right" }}>
            <button type="button" className="btn btn-ghost"
              onClick={() => { haptic.tap(); setSelectionMode(true); }}
              style={{ display:"inline-flex", alignItems:"center", gap:6, width:"auto", height:"auto", padding:"4px 10px", fontSize:12 }}>
              {t("agenda.bulkSelectCta")}
            </button>
          </div>
        )}
        {patients.length > 0 && (
          <div style={{ padding:"0 16px 10px" }}>
            <select
              value={filterPatientId}
              onChange={e => setFilterPatientId(e.target.value)}
              style={{ width:"100%", fontSize:"var(--text-sm)", fontWeight:600, fontFamily:"var(--font)", padding:"8px 12px", borderRadius:"var(--radius-pill)", border:"1.5px solid var(--border)", background:"var(--white)", color:"var(--charcoal-md)", cursor:"pointer", appearance:"auto" }}
            >
              <option value="">{t("agenda.allPatients")}</option>
              {patients.filter(p => p.status === "active").sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      {view==="day"   && <DayView   selectedDate={selectedDate} setSelectedDate={setSelectedDate} onSelectSession={setSelectedSession} upcomingSessions={filteredSessions} jumpToToday={jumpToToday} filterPatientName={filterPatientName} selectionMode={selectionMode} selectedSet={selectedSet} onToggleSelect={onToggleSelect} />}
      {view==="week"  && <WeekView  selectedDate={selectedDate} setSelectedDate={setSelectedDate} setView={setView} onSelectSession={(s, mode) => { setSelectedSession(s); setSelectedSessionMode(mode || null); }} onCellTap={handleCellTap} onDropSession={handleDropSession} canDrag={isTabletSplit} onEventContextMenu={isTabletSplit ? handleEventContextMenu : undefined} upcomingSessions={filteredSessions} now={now} jumpToToday={jumpToToday} />}
      {view==="month" && <MonthView selectedDate={selectedDate} setSelectedDate={setSelectedDate} onSelectSession={setSelectedSession} upcomingSessions={filteredSessions} jumpToToday={jumpToToday} filterPatientName={filterPatientName} onMoveDay={handleMonthMoveDay} canMoveDay={!readOnly} />}
      {upcomingSessions.length === 0 && (
        <EmptyState
          kind="agenda"
          title={t("sessions.noSessions")}
          body={t("agenda.emptyHint")}
        />
      )}
      {newSessionPrefill && (
        <NewSessionSheet
          onClose={() => setNewSessionPrefill(null)}
          onSubmit={createSession}
          patients={patients}
          sessions={upcomingSessions}
          mutating={mutating}
          initialDate={newSessionPrefill.date}
          initialTime={newSessionPrefill.time}
        />
      )}
      {calendarSheetOpen && (
        <CalendarLinkSheet onClose={() => setCalendarSheetOpen(false)} readOnly={readOnly} />
      )}
      <SessionSheet
        session={selectedSession}
        patients={patients}
        notes={notes}
        initialMode={selectedSessionMode}
        onClose={() => { setSelectedSession(null); setSelectedSessionMode(null); }}
        onOpenNote={handleOpenNote}
        onCancelSession={async (session, charge, reason) => {
          const ok = await onCancelSession(session, charge, reason);
          if (ok) setSelectedSession(prev => (prev ? { ...prev, status: charge ? "charged" : "cancelled", cancel_reason: reason || null } : prev));
          return ok;
        }}
        onMarkCompleted={async (session, overrideStatus) => {
          const st = overrideStatus || "completed";
          const ok = await onMarkCompleted(session, overrideStatus);
          if (ok) setSelectedSession(prev => (prev ? { ...prev, status: st, cancel_reason: null } : prev));
          return ok;
        }}
        onDelete={async (id) => { await deleteSession(id); setSelectedSession(null); }}
        onReschedule={async (id, date, time, duration) => {
          const ok = await rescheduleSession(id, date, time, duration);
          if (ok) setSelectedSession(prev => prev ? { ...prev, date, time, duration, status: "scheduled" } : prev);
          return ok;
        }}
        onUpdateModality={async (id, modality) => {
          const ok = await updateSessionModality(id, modality);
          if (ok) setSelectedSession(prev => prev ? { ...prev, modality } : prev);
          return ok;
        }}
        onUpdateRate={async (id, rate) => {
          const ok = await updateSessionRate(id, rate);
          if (ok) setSelectedSession(prev => prev ? { ...prev, rate: Number(rate) } : prev);
          return ok;
        }}
        onUpdateCancelReason={async (id, reason) => {
          const ok = await updateCancelReason(id, reason);
          if (ok) setSelectedSession(prev => prev ? { ...prev, cancel_reason: reason.trim() || null } : prev);
          return ok;
        }}
        mutating={mutating}
      />
      <ContextMenu {...ctxMenu.state} onClose={ctxMenu.close} />
      {selectionMode && view === "day" && !readOnly && (
        <BulkActionsBar
          count={selectedSet.size}
          busy={bulkBusy}
          onExit={exitSelection}
          onCancelNoCharge={() => bulkApply("cancel")}
          onCancelCharge={() => bulkApply("cancel-charge")}
          onDelete={() => bulkApply("delete")}
        />
      )}
      {moveDayPair && (
        <ConfirmDialog
          open
          title={t("agenda.moveDayTitle", { n: moveDayPair.sessions.length })}
          body={t("agenda.moveDayBody", {
            src: formatShortDate(new Date(moveDayPair.srcIso + "T00:00:00")),
            tgt: formatShortDate(new Date(moveDayPair.tgtIso + "T00:00:00")),
            n: moveDayPair.sessions.length,
          })}
          confirmLabel={t("agenda.moveDayConfirm")}
          cancelLabel={t("cancel")}
          busy={moveDayBusy}
          onConfirm={confirmMonthMoveDay}
          onCancel={() => setMoveDayPair(null)}
        />
      )}
    </div>
    </>
  );
}
