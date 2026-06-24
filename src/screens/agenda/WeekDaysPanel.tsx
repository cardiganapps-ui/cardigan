import { memo, useState, useMemo } from "react";
import { getClientColor, TODAY } from "../../data/seedData";
import { collapseGroupOccurrences } from "../../utils/groups";
import { formatShortDate, toISODate } from "../../utils/dates";
import { isCancelledStatus, isTutorSession, isInterviewSession } from "../../utils/sessions";
import { useT } from "../../i18n/index";
import { clickableProps } from "../../utils/a11y";
import { LongPressEvent } from "./LongPressEvent";
import { getWeekDays, isSameDay, timeToFloat } from "./agendaShared";

/* ── WEEK DAYS PANEL (just the day headers + grid cells, no time labels) ── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed session/group rows
type Row = any;

export const WeekDaysPanel = memo(function WeekDaysPanel({ weekDate, selectedDate, setSelectedDate, setView, onSelectSession, onCellTap, onDropSession, canDrag, onEventContextMenu, upcomingSessions, showWeekends, hours, groupsById }: {
  weekDate: Date;
  selectedDate: Date;
  setSelectedDate: (d: Date) => void;
  setView: (v: string) => void;
  onSelectSession: (s: Row) => void;
  onCellTap?: (d: Date, hour: string) => void;
  onDropSession?: (id: string, d: Date, hour: string) => void;
  canDrag?: boolean;
  onEventContextMenu?: (e: React.MouseEvent, s: Row) => void;
  upcomingSessions: Row[];
  showWeekends?: boolean;
  hours: string[];
  groupsById?: Map<string, Row>;
}) {
  const { strings } = useT();
  const DOW = strings.daysShort;
  const weekDays = getWeekDays(weekDate);
  const visibleDays = showWeekends ? weekDays : weekDays.slice(0, 5);
  const visibleDow = showWeekends ? DOW : DOW.slice(0, 5);
  const cols = `repeat(${visibleDays.length}, 1fr)`;
  const [dropTarget, setDropTarget] = useState<string | null>(null); // `${dayIdx}:${hourIdx}`

  // Group sessions by date for quick lookup
  const sessionsByDate = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const s of upcomingSessions) {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date)!.push(s);
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
            <div key={i} className="week-day-head" style={{ cursor:"pointer" }} {...clickableProps(() => { setSelectedDate(d); setView("day"); })}>
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
                        rendered the same way. `hour` is already an
                        "HH:MM" string from the i18n hours array. */}
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
                        {hour}
                      </span>
                    )}
                  </div>
                );
              })}
              {/* Session events positioned absolutely. Group occurrences
                  collapse into ONE synthetic event tile (group name + count)
                  so a class isn't N overlapping tiles; the synthetic id
                  "grp:<id>|<date>|<time>" routes tap → group sheet and drag →
                  whole-occurrence reschedule (see handleDropSession). */}
              {collapseGroupOccurrences(daySess, groupsById).map((item: Row) => {
                const sess = item._groupOccurrence
                  ? {
                      id: `grp:${item.group_id}|${item.date}|${item.time}`,
                      time: item.time, duration: item.duration, status: item.status,
                      modality: item.group?.modality || "presencial",
                      colorIdx: item.group?.colorIdx ?? item.group?.color_idx ?? 0,
                      patient: `${item.group?.name || "Grupo"} · ${item.count}`,
                      _groupOccurrence: true, group_id: item.group_id, date: item.date, group: item.group,
                    }
                  : item;
                const startF = timeToFloat(sess.time);
                const dur = (sess.duration || 60) / 60; // hours
                if (startF < 0 || startF >= hours.length) return null;
                const eventStyle = (() => {
                  if (isCancelledStatus(sess.status)) return undefined;
                  // Interview takes precedence over tutor / modality so
                  // the rose styling reads as the dominant signal —
                  // matches the SessionRow + Home avatar treatments.
                  if (isInterviewSession(sess)) return { background:"var(--rose-bg)", borderLeftColor:"var(--rose)", color:"var(--charcoal)" };
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
});
