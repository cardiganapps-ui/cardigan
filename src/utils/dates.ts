/* ── Date utilities used across Cardigan ── */

export const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

// Split day/month from either "14-Abr" (canonical) or the legacy "14 Abr"
// form still present in historical DB rows. Also tolerates an optional
// third component ("14-Abr-26") which is stripped here — the year carries
// through separate helpers.
const SHORT_PARTS_RE = /[\s-]+/;

/**
 * Infer the most likely year for a short date that has no year.
 * Picks the year (current, previous, or next) that places the date
 * closest to the reference date (defaults to today).  This handles
 * the Dec/Jan boundary: a "31 Dic" date viewed in January resolves
 * to the previous year, and a "2 Ene" date viewed in December
 * resolves to the next year.
 */
function inferYear(monthIdx: number, day: number, referenceDate?: Date): number {
  const ref = referenceDate || new Date();
  const refYear = ref.getFullYear();
  let best = refYear;
  let bestDiff = Infinity;
  for (const y of [refYear - 1, refYear, refYear + 1]) {
    const diff = Math.abs(new Date(y, monthIdx, day).getTime() - ref.getTime());
    if (diff < bestDiff) { bestDiff = diff; best = y; }
  }
  return best;
}

export function formatShortDate(date: Date = new Date()): string {
  return `${date.getDate()}-${SHORT_MONTHS[date.getMonth()]}`;
}

// Same as formatShortDate but appends the 2-digit year: "14-Abr-26".
// Use only when the year would otherwise be ambiguous (e.g. multi-year
// exports, historical logs). Everyday UI should stick with formatShortDate.
export function formatShortDateWithYear(date: Date = new Date()): string {
  const yy = String(date.getFullYear()).slice(-2);
  return `${date.getDate()}-${SHORT_MONTHS[date.getMonth()]}-${yy}`;
}

// Normalize a short date coming from the DB or another source to the
// canonical "D-MMM" form. Idempotent.
export function normalizeShortDate(str: string | null | undefined): string | null | undefined {
  if (!str || typeof str !== "string") return str;
  const parts = str.split(SHORT_PARTS_RE);
  if (parts.length < 2) return str;
  const day = parseInt(parts[0]);
  const mon = parts[1];
  if (!day || SHORT_MONTHS.indexOf(mon) < 0) return str;
  return `${day}-${mon}`;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function shortDateToISO(str: string | null | undefined, referenceDate?: Date): string {
  if (!str) return todayISO();
  const [day, mon] = str.split(SHORT_PARTS_RE);
  const mIdx = SHORT_MONTHS.indexOf(mon);
  if (mIdx < 0) return todayISO();
  const y = inferYear(mIdx, parseInt(day), referenceDate);
  return `${y}-${String(mIdx+1).padStart(2,"0")}-${String(parseInt(day)).padStart(2,"0")}`;
}

export function isoToShortDate(iso: string | null | undefined): string {
  if (!iso) return formatShortDate();
  const [, m, d] = iso.split("-");
  return `${parseInt(d)}-${SHORT_MONTHS[parseInt(m)-1]}`;
}

export function isoToShortDateWithYear(iso: string | null | undefined): string {
  if (!iso) return formatShortDateWithYear();
  const [y, m, d] = iso.split("-");
  return `${parseInt(d)}-${SHORT_MONTHS[parseInt(m)-1]}-${y.slice(-2)}`;
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function parseShortDate(str: string, referenceDate?: Date): Date {
  const [dayNum, mon] = str.split(SHORT_PARTS_RE);
  const mIdx = SHORT_MONTHS.indexOf(mon);
  const m = mIdx >= 0 ? mIdx : 0;
  const d = parseInt(dayNum) || 1;
  const y = inferYear(m, d, referenceDate);
  return new Date(y, m, d);
}

export function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split("-");
  return new Date(+y, +m - 1, +d);
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function formatCurrency(n: number | null | undefined): string {
  return `$${(n || 0).toLocaleString()}`;
}
