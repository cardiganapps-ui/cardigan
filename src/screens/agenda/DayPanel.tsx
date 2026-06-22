import { collapseGroupOccurrences } from "../../utils/groups";
import { formatShortDate } from "../../utils/dates";
import { GroupSessionRow } from "../../components/GroupSessionRow";
import { IconSun } from "../../components/Icons";
import { useT } from "../../i18n/index";
import { SessionRow } from "./SessionRow";
import { sortByTime } from "./agendaShared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed session/group rows
type Row = any;

/* ── DAY PANEL (just one day's session list, no week strip) ── */
export function DayPanel({ panelDate, onSelectSession, upcomingSessions, filterPatientName, selectionMode, selectedSet, onToggleSelect, onSwipeComplete, groupsById }: {
  panelDate: Date;
  onSelectSession: (s: Row) => void;
  upcomingSessions: Row[];
  filterPatientName?: string | null;
  selectionMode?: boolean;
  selectedSet?: Set<string>;
  onToggleSelect?: (s: Row) => void;
  onSwipeComplete?: (s: Row) => void;
  groupsById?: Map<string, Row>;
}) {
  const { t, strings } = useT();
  const DOW = strings.daysShort;
  const dateStr = formatShortDate(panelDate);
  const daySessionsRaw = sortByTime(upcomingSessions.filter((s: Row) => s.date === dateStr));
  // Collapse group occurrences into one tile each — except in bulk-select
  // mode, where per-session rows are needed for individual selection.
  const daySessions = selectionMode ? daySessionsRaw : collapseGroupOccurrences(daySessionsRaw, groupsById);
  const dayName = DOW[(panelDate.getDay() + 6) % 7];

  return (
    <>
      <div style={{ padding:"0 16px 4px", maxWidth:760, marginInline:"auto" }}>
        <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:800, color:"var(--charcoal)", marginBottom:2 }}>{dayName} {dateStr}</div>
        <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)", marginBottom:10 }}>{daySessions.length===0 ? t("sessions.noSessions") : t("sessions.sessionsCount", { count: daySessions.length })}</div>
      </div>
      <div style={{ padding:"0 16px 12px", maxWidth:760, marginInline:"auto" }}>
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
              {daySessions.map((s: Row) => (
                s._groupOccurrence
                  ? <GroupSessionRow key={s.id} occ={s} onClick={() => onSelectSession(s)} />
                  : <SessionRow key={s.id} s={s} onClick={onSelectSession}
                      selectionMode={selectionMode}
                      selected={selectedSet?.has(s.id)}
                      onToggleSelect={onToggleSelect}
                      onSwipeComplete={onSwipeComplete} />
              ))}
            </div>
        }
      </div>
    </>
  );
}
