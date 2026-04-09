/* ── Date utilities used across Cardigan ── */

export const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

export function formatShortDate(date = new Date()) {
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`;
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function shortDateToISO(str) {
  if (!str) return todayISO();
  const [day, mon] = str.split(" ");
  const mIdx = SHORT_MONTHS.indexOf(mon);
  if (mIdx < 0) return todayISO();
  const y = new Date().getFullYear();
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

export function parseShortDate(str) {
  const [dayNum, mon] = str.split(" ");
  const mIdx = SHORT_MONTHS.indexOf(mon);
  return new Date(new Date().getFullYear(), mIdx >= 0 ? mIdx : 0, parseInt(dayNum) || 1);
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
