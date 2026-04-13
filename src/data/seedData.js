export const clientColors = ["#5B9BAF"];

// Safe lookup for a client avatar color. Always returns a valid color even if
// `idx` is nullish, negative, or out of range — use this instead of
// `clientColors[i]` directly.
export function getClientColor(idx) {
  const n = clientColors.length;
  const i = Number.isFinite(idx) ? ((idx % n) + n) % n : 0;
  return clientColors[i];
}

export const navItems = [
  { id:"home",      label:"Inicio",      iconId:"home",      section:"principal" },
  { id:"agenda",    label:"Agenda",      iconId:"calendar",  section:"principal" },
  { id:"patients",  label:"Pacientes",   iconId:"users",     section:"principal" },
  { id:"notes",     label:"Notas",       iconId:"clipboard", section:"principal" },
  { id:"documents", label:"Documentos",  iconId:"document",  section:"principal" },
  { id:"finances",  label:"Finanzas",    iconId:"dollar",    section:"principal" },
  { id:"settings",  label:"Ajustes",    iconId:"settings", section:"cuenta"    },
];

export const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
export const DOW = ["LUN","MAR","MIÉ","JUE","VIE","SÁB","DOM"];
export const HOURS = ["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00","21:00"];
export const DAY_ORDER = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];

export const TODAY = new Date();
