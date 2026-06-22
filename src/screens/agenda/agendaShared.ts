/* ── Agenda shared helpers ──
   Pure date/layout math + small helpers extracted from Agenda.jsx so the
   view components (DayView / WeekView / MonthView and their panels) can
   each live in their own file without duplicating logic. Everything here
   is pure — no React state, no side effects. */

/* "8-Abr" → Date for the year inferred by parseShortDate. Local helper
   to avoid a wider utils refactor; mirrors the inferYear path used
   throughout the app (we pick the closest year to today). */
export function parseShortDateLocal(s: string | null | undefined) {
  if (!s) return new Date();
  const parts = s.split(/[\s-]+/);
  const day = parseInt(parts[0], 10);
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const mIdx = months.findIndex((m) => m.toLowerCase() === (parts[1] || "").toLowerCase());
  if (!day || mIdx < 0) return new Date();
  const now = new Date();
  let best = now.getFullYear(), bestDiff = Infinity;
  for (const y of [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]) {
    const diff = Math.abs(new Date(y, mIdx, day).getTime() - now.getTime());
    if (diff < bestDiff) { bestDiff = diff; best = y; }
  }
  return new Date(best, mIdx, day);
}

/* ── DATE HELPERS ── */
export function getMonday(d: Date) {
  const m = new Date(d);
  const day = m.getDay();
  m.setDate(m.getDate() - ((day + 6) % 7));
  m.setHours(0,0,0,0);
  return m;
}

export function getWeekDays(d: Date) {
  const mon = getMonday(d);
  return Array.from({length:7}, (_,i) => {
    const day = new Date(mon);
    day.setDate(mon.getDate() + i);
    return day;
  });
}

export function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function isSameDay(a: Date, b: Date) {
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed session rows
export function sortByTime(sessions: any[]) {
  return [...sessions].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
}

export function buildMonthGrid(year: number, month: number) {
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev  = new Date(year, month, 0).getDate();
  const startOffset = (firstDay + 6) % 7;
  const cells: { num: number; current: boolean }[] = [];
  for (let i = 0; i < startOffset; i++) cells.push({ num: daysInPrev - startOffset + 1 + i, current: false });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ num: d, current: true });
  const remaining = 42 - cells.length;
  for (let i = 1; i <= remaining; i++) cells.push({ num: i, current: false });
  return cells;
}

/* ── Helper: parse "HH:MM" to fractional hours from grid start (7:00) ── */
export function timeToFloat(time: string | null | undefined) {
  const [h, m] = (time || "07:00").split(":").map(Number);
  return (h || 7) + (m || 0) / 60 - 7;
}
