export const clientColors = ["#5B9BAF","#7AB5C7","#4A8799","#3D6470","#84C5D4","#9E8BC4","#B08DC8"];

export const seedPatients = [
  { id:1,  name:"María Cordera",     parent:"Paola",      initials:"MC", rate:700, day:"Miércoles", time:"13:15", status:"active", billed:3500, paid:0,    sessions:5 },
  { id:2,  name:"Emilia Romero",     parent:"María José", initials:"ER", rate:700, day:"Martes",    time:"19:15", status:"active", billed:3500, paid:2800, sessions:5 },
  { id:3,  name:"Marina Nuñez",      parent:"Ana Belén",  initials:"MN", rate:700, day:"Martes",    time:"16:30", status:"active", billed:3500, paid:3500, sessions:5 },
  { id:5,  name:"Inés Sagües",       parent:"Inés",       initials:"IS", rate:500, day:"Lunes",     time:"16:30", status:"active", billed:2500, paid:2000, sessions:5 },
  { id:6,  name:"Regina Carrillo",   parent:"Guadalupe",  initials:"RC", rate:700, day:"Jueves",    time:"17:30", status:"active", billed:1400, paid:700,  sessions:2 },
  { id:7,  name:"Olivia Rivera",     parent:"Kitsia",     initials:"OR", rate:700, day:"Miércoles", time:"19:15", status:"ended",  billed:3500, paid:2900, sessions:5 },
  { id:8,  name:"Fernando Guerrero", parent:"Rossana",    initials:"FG", rate:700, day:"Martes",    time:"13:00", status:"active", billed:4200, paid:2100, sessions:6 },
  { id:9,  name:"Elena González",    parent:"Mercedes",   initials:"EG", rate:700, day:"Lunes",     time:"17:15", status:"ended",  billed:1400, paid:700,  sessions:2 },
  { id:10, name:"Eugenia Del Río",   parent:"Fernanda",   initials:"ED", rate:700, day:"Martes",    time:"20:15", status:"active", billed:0,    paid:0,    sessions:0 },
];

export const seedUpcomingSessions = [
  { id:1, patient:"Inés Sagües",       initials:"IS", time:"16:30", day:"Lunes",     date:"7 Abr",  status:"scheduled", colorIdx:3 },
  { id:2, patient:"Fernando Guerrero", initials:"FG", time:"13:00", day:"Martes",    date:"8 Abr",  status:"scheduled", colorIdx:6 },
  { id:3, patient:"Marina Nuñez",      initials:"MN", time:"16:30", day:"Martes",    date:"8 Abr",  status:"scheduled", colorIdx:2 },
  { id:4, patient:"Emilia Romero",     initials:"ER", time:"19:15", day:"Martes",    date:"8 Abr",  status:"scheduled", colorIdx:1 },
  { id:5, patient:"María Cordera",     initials:"MC", time:"13:15", day:"Miércoles", date:"9 Abr",  status:"scheduled", colorIdx:0 },
  { id:6, patient:"Olivia Rivera",     initials:"OR", time:"19:15", day:"Miércoles", date:"9 Abr",  status:"cancelled", colorIdx:5 },
  { id:7, patient:"Regina Carrillo",   initials:"RC", time:"17:30", day:"Jueves",    date:"10 Abr", status:"scheduled", colorIdx:4 },
];

export const seedPayments = [
  { id:1, patient:"Regina Carrillo",   initials:"RC", amount:700,  date:"15 Ene", method:"Transferencia", colorIdx:4 },
  { id:2, patient:"Olivia Rivera",     initials:"OR", amount:1400, date:"21 Ene", method:"Transferencia", colorIdx:5 },
  { id:3, patient:"Elena González",    initials:"EG", amount:700,  date:"26 Ene", method:"Efectivo",      colorIdx:7 },
  { id:4, patient:"Fernando Guerrero", initials:"FG", amount:700,  date:"27 Ene", method:"Transferencia", colorIdx:6 },
  { id:5, patient:"Marina Nuñez",      initials:"MN", amount:3500, date:"27 Ene", method:"Transferencia", colorIdx:2 },
  { id:6, patient:"Emilia Romero",     initials:"ER", amount:2800, date:"9 Feb",  method:"Efectivo",      colorIdx:1 },
  { id:7, patient:"Inés Sagües",       initials:"IS", amount:2000, date:"10 Feb", method:"Transferencia", colorIdx:3 },
];

export const calDays = [
  { name:"LUN", num:"7",  hasS:true  },
  { name:"MAR", num:"8",  hasS:true  },
  { name:"MIÉ", num:"9",  hasS:true  },
  { name:"JUE", num:"10", hasS:true  },
  { name:"VIE", num:"11", hasS:false },
  { name:"SÁB", num:"12", hasS:false },
  { name:"DOM", num:"13", hasS:false },
];

export const monthlyData = [
  { mes:"Sep", year:2025, cobrado:5600, sesiones:8,  pendiente:700  },
  { mes:"Oct", year:2025, cobrado:7000, sesiones:10, pendiente:1400 },
  { mes:"Nov", year:2025, cobrado:6300, sesiones:9,  pendiente:700  },
  { mes:"Dic", year:2025, cobrado:4200, sesiones:6,  pendiente:0    },
  { mes:"Ene", year:2026, cobrado:8400, sesiones:12, pendiente:2100 },
  { mes:"Feb", year:2026, cobrado:9500, sesiones:14, pendiente:1600 },
];

export const navItems = [
  { id:"home",     label:"Inicio",   icon:"🏠", section:"principal" },
  { id:"agenda",   label:"Agenda",   icon:"📅", section:"principal" },
  { id:"patients", label:"Pacientes",icon:"👤", section:"principal" },
  { id:"finances", label:"Finanzas", icon:"💰", section:"principal" },
  { id:"settings", label:"Ajustes",  icon:"⚙️", section:"cuenta"    },
];

export const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
export const DOW = ["LUN","MAR","MIÉ","JUE","VIE","SÁB","DOM"];
export const HOURS = ["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00","21:00"];
export const DAY_ORDER = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];

export const TODAY = new Date(2026, 3, 7); // April 7, 2026

const SHORT_MONTHS_TOPBAR = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const FULL_MONTHS_TOPBAR  = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function todayGreeting() {
  const h = TODAY.getHours();
  if (h < 12) return "Buenos días ☀️";
  if (h < 19) return "Buenas tardes 🌤️";
  return "Buenas noches 🌙";
}

function todayLabel() {
  const dayName = DAY_ORDER[((TODAY.getDay() + 6) % 7)];
  return `${dayName} ${TODAY.getDate()} de ${FULL_MONTHS_TOPBAR[TODAY.getMonth()]}`;
}

function todayShort() {
  return `${TODAY.getDate()} ${SHORT_MONTHS_TOPBAR[TODAY.getMonth()]}`;
}

export function buildTopbarMeta(patients) {
  const total = patients.length;
  const active = patients.filter(p => p.status === "active").length;
  return {
    home:     { title: todayGreeting(), sub: todayLabel() },
    agenda:   { title:"Agenda",          sub:`Semana del ${todayShort()}` },
    patients: { title:"Pacientes",       sub:`${total} en total · ${active} activos` },
    finances: { title:"Finanzas",        sub: FULL_MONTHS_TOPBAR[TODAY.getMonth()] + " " + TODAY.getFullYear() },
    settings: { title:"Ajustes",         sub:"Cardigan Pro" },
  };
}
