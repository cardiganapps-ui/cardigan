const SHORT_MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

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
