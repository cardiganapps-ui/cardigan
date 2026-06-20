import { memo, useEffect, useRef } from "react";
import { TODAY } from "../../data/seedData";
import { haptic } from "../../utils/haptics";
import { tryClaim as trySwipeClaim, release as releaseSwipe } from "../../hooks/swipeCoordinator";
import { formatShortDate, toISODate } from "../../utils/dates";
import { isTutorSession } from "../../utils/sessions";
import { buildMonthGrid, isSameDay } from "./agendaShared";

/* ── MONTH GRID PANEL (just the calendar cells, no header/dow/sessions) ──
   Whole-day drag-and-drop: long-press a cell that has sessions, then
   drag to another cell to bulk-move every session from source-day to
   target-day (each session keeps its own time). The actual write +
   confirm modal lives in MonthView; this panel only emits the
   (srcDayIso, targetDayIso) pair via onMoveDay.

   We piggy-back on the same elementFromPoint pattern the week-view
   LongPressEvent uses: cells get data-month-day attributes, and the
   gesture handler reads them off whatever the finger lands on. */
export const MonthGridPanel = memo(function MonthGridPanel({ year, month, selectedDate, setSelectedDate, sessionsByDate, onMoveDay, canDrag }) {
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
});
