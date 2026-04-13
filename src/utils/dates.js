/* ── Date utilities used across Cardigan ── */

export const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

/**
 * Infer the most likely year for a "D MMM" date that has no year.
 * Picks the year (current, previous, or next) that places the date
 * closest to the reference date (defaults to today).  This handles
 * the Dec/Jan boundary: a "31 Dic" date viewed in January resolves
 * to the previous year, and a "2 Ene" date viewed in December
 * resolves to the next year.
 */
function inferYear(monthIdx, day, referenceDate) {
  const ref = referenceDate || new Date();
  const refYear = ref.getFullYear();
  let best = refYear;
  let bestDiff = Infinity;
  for (const y of [refYear - 1, refYear, refYear + 1]) {
    const diff = Math.abs(new Date(y, monthIdx, day) - ref);
    if (diff < bestDiff) { bestDiff = diff; best = y; }
  }
  return best;
}

export function formatShortDate(date = new Date()) {
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`;
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function shortDateToISO(str, referenceDate) {
  if (!str) return todayISO();
  const [day, mon] = str.split(" ");
  const mIdx = SHORT_MONTHS.indexOf(mon);
  if (mIdx < 0) return todayISO();
  const y = inferYear(mIdx, parseInt(day), referenceDate);
  return `${y}-${String(mIdx+1).padStart(2,"0")}-${String(parseInt(day)).padStart(2,"0")}`;
}

export function isoToShortDate(iso) {
  if (!iso) return formatShortDate();
  const [y, m, d] = iso.split("-");
  return `${parseInt(d)} ${SHORT_MONTHS[parseInt(m)-1]}`;
}

export function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function parseShortDate(str, referenceDate) {
  const [dayNum, mon] = str.split(" ");
  const mIdx = SHORT_MONTHS.indexOf(mon);
  const m = mIdx >= 0 ? mIdx : 0;
  const d = parseInt(dayNum) || 1;
  const y = inferYear(m, d, referenceDate);
  return new Date(y, m, d);
}

export function parseLocalDate(str) {
  const [y, m, d] = str.split("-");
  return new Date(+y, +m - 1, +d);
}

export function getInitials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function formatCurrency(n) {
  return `$${(n || 0).toLocaleString()}`;
}
