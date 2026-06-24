import { useState, useCallback, useEffect, useRef } from "react";
import { haptic } from "../../utils/haptics";
import { tryClaim as trySwipeClaim, release as releaseSwipe } from "../../hooks/swipeCoordinator";
import { toISODate } from "../../utils/dates";
import { isCancelledStatus, shortName } from "../../utils/sessions";
import { parseShortDateLocal } from "./agendaShared";

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed session row
type Row = any;

export function LongPressEvent({ session, eventStyle, startF, dur, isDraggable, touchLongPressable, onSelectSession, onDropSession, onEventContextMenu }: {
  session: Row;
  eventStyle?: React.CSSProperties;
  startF: number;
  dur: number;
  isDraggable?: boolean;
  touchLongPressable?: boolean;
  onSelectSession: (s: Row, mode?: string) => void;
  onDropSession?: (id: string, d: Date, hour: string) => void;
  onEventContextMenu?: (e: React.MouseEvent, s: Row) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const ghostRef = useRef<HTMLElement | null>(null);
  const lastTargetRef = useRef<HTMLElement | null>(null);
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

    const updateTarget = (clientX: number, clientY: number) => {
      const ghost = ghostRef.current;
      if (!ghost) return;
      // Hide the ghost so elementFromPoint sees what's underneath.
      ghost.style.visibility = "hidden";
      const hit = document.elementFromPoint(clientX, clientY);
      ghost.style.visibility = "";
      const cell = hit?.closest?.("[data-cell-day]") as HTMLElement | null;
      if (cell === lastTargetRef.current) return;
      clearTargetHighlight();
      if (cell) {
        cell.classList.add("week-cell--drop-target");
        // data-cell-hour stores the i18n "HH:MM" string verbatim (the
        // hours array is ["08:00","09:00",...]). Render as-is — an
        // earlier draft built `${hour}:00` which produced "14:00:00".
        const hour = cell.dataset.cellHour;
        if (hour) {
          const pill = document.createElement("span");
          pill.className = "dnd-drop-time-pill";
          pill.textContent = hour;
          pill.style.cssText = "position:absolute;top:4px;left:4px;font-size:11px;font-weight:700;color:#fff;background:var(--teal-dark);padding:2px 6px;border-radius:4px;pointer-events:none;z-index:2;";
          cell.appendChild(pill);
        }
        lastTargetRef.current = cell;
      }
    };

    const enterDrag = (touch: Touch) => {
      if (!trySwipeClaim("week-event-dnd")) return false;
      const sess = sessionRef.current;
      draggingRef.current = true;
      setDragging(true);
      haptic.warn();
      const ghost = document.createElement("div");
      ghost.textContent = `${sess.time} · ${sess._groupOccurrence ? sess.patient : shortName(sess.patient)}`;
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

    const exitDrag = (commit: boolean) => {
      const sess = sessionRef.current;
      const target = lastTargetRef.current;
      let outcome = "cancelled";
      if (commit && target && onDropSessionRef.current) {
        const day = target.dataset.cellDay;
        // data-cell-hour is "HH:MM" (the i18n hours strings). Pass it
        // through verbatim — handleDropSession → rescheduleSession
        // expects a "HH:MM" string, not a numeric hour. Earlier this
        // parseInt'd to a number, which the rescheduleSession early-
        // return rejected via `!newTime?.trim()` and the drop
        // silently snapped back to the source slot.
        const hour = target.dataset.cellHour;
        if (day && /^\d{1,2}:\d{2}$/.test(hour || "")) {
          const sameSlot = day === toISODate(parseShortDateLocal(sess.date))
            && hour === sess.time;
          if (sameSlot) {
            outcome = "same-slot";
          } else {
            onDropSessionRef.current(sess.id, new Date(day + "T00:00:00"), hour!);
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

    const onTouchStart = (e: TouchEvent) => {
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

    const onTouchMove = (e: TouchEvent) => {
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

    const onTouchEnd = (e: TouchEvent) => {
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
    // drag/drop (pan/paste/swipe) gesture surface, not a button
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
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
      <span className="week-event-time">{session.time}</span> {session._groupOccurrence ? session.patient : shortName(session.patient)}
    </div>
  );
}
