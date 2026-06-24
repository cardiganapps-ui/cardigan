/* ── Schedule-slot conflict detection (WS-6) ──────────────────────────
   NewPatientSheet (and the edit form) gate progression on slot conflicts:
   - EXTERNAL: a form schedule row collides with an existing scheduled
     session (any patient) at the same day/time.
   - INTERNAL: two form rows sit on the same day/time (possible after the
     user edits rows).
   Both block "Siguiente". Pulled out of the component's useMemo so the
   collision logic has a single tested home. */

interface SlotRow {
  day: string;
  time: string;
}

interface SessionLike {
  status?: string | null;
  day?: string | null;
  time?: string | null;
}

export interface ScheduleConflicts<S extends SessionLike = SessionLike> {
  /** Form rows that collide with an existing scheduled session. */
  externalConflicts: { row: number; match: S }[];
  /** Indices of form rows that duplicate another form row's day/time. */
  internalConflictRows: number[];
}

export function detectScheduleConflicts<S extends SessionLike>(
  schedules: SlotRow[],
  sessions: S[] | null | undefined,
): ScheduleConflicts<S> {
  const external: { row: number; match: S }[] = [];
  const internal = new Set<number>();
  const seen = new Map<string, number>(); // `${day}|${time}` -> first row index
  for (let i = 0; i < schedules.length; i++) {
    const s = schedules[i];
    const key = `${s.day}|${s.time}`;
    if (seen.has(key)) { internal.add(i); internal.add(seen.get(key)!); }
    else seen.set(key, i);
    const match = (sessions || []).find(
      (x) => x.status === "scheduled" && x.day === s.day && x.time === s.time,
    );
    if (match) external.push({ row: i, match });
  }
  return { externalConflicts: external, internalConflictRows: [...internal] };
}
