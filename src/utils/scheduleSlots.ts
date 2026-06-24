/* ── Empty-slot finder (extracted from NewPatientSheet, WS-6) ──────────
   When the new-patient / new-session sheet opens it pre-fills the first
   weekly (day, time) slot the therapist isn't already booked into, so the
   common case is one tap. Pure logic — given the existing scheduled
   sessions (+ any slots already claimed by other rows in the same form),
   walk a fixed search grid and return the first free slot, falling back to
   the canonical default when the whole grid is full. */

/** Minimal session shape the slot finder reads. */
export interface SlotSession {
  status?: string | null;
  day?: string | null;
  time?: string | null;
}

/** Weekday search order (Spanish day names, matching sessions.day). Sábado
    is included as a last resort. */
export const SLOT_SEARCH_DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/** Time-of-day search order — ascending across the working day. */
export const SLOT_SEARCH_TIMES = [
  "09:00", "10:00", "11:00", "12:00", "13:00",
  "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00",
];

/** The default slot when the whole search grid is taken. */
export const DEFAULT_SLOT = { day: "Lunes", time: "16:00" };

/**
 * First free (day, time) in the search grid given the currently-scheduled
 * sessions and any extra `"day|time"` keys already claimed elsewhere in the
 * form. Returns DEFAULT_SLOT when nothing is free (the sheet's conflict
 * banner still warns the user in that case).
 */
export function findEmptySlot(
  sessions: SlotSession[] | undefined,
  extraTaken: string[] = [],
): { day: string; time: string } {
  const taken = new Set<string>([
    ...((sessions || []).filter(s => s.status === "scheduled").map(s => `${s.day}|${s.time}`)),
    ...(extraTaken || []),
  ]);
  for (const day of SLOT_SEARCH_DAYS) {
    for (const time of SLOT_SEARCH_TIMES) {
      if (!taken.has(`${day}|${time}`)) return { day, time };
    }
  }
  return { ...DEFAULT_SLOT };
}
