import { formatShortDate, getInitials } from "../utils/dates";
import { DEFAULT_PROFESSION } from "./constants";

/* ── Demo data generator ──
   Generates 9 months of past + 4 weeks of future activity for the demo
   landing — patients, sessions, payments, and notes. The shape matches
   the live Supabase rows exactly so every screen renders unmodified.

   Profession-aware: pass a profession key to `generateDemoData()` and
   get patient names + note topics flavored for that profession. The
   scheduling/billing engine below is intentionally profession-agnostic
   — only the seed data and a few text fields differ. Falls back to
   psychologist's seed for any profession that hasn't shipped its own
   defs yet (Phase 3+: tutor, music_teacher, trainer). */

function uuid() {
  return "demo-" + Math.random().toString(36).slice(2, 11);
}

function dateStr(d) {
  return formatShortDate(d);
}

function addWeeks(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n * 7);
  return r;
}

const COLORS = 7;
const METHODS = ["Transferencia", "Efectivo", "Transferencia", "Transferencia", "Efectivo"];
const CANCEL_REASONS = [
  "Paciente canceló por enfermedad",
  "Reagendada a la siguiente semana",
  "Conflicto de horario",
  null, null, null,
];
const PAYMENT_NOTES = [
  "Abono parcial del mes",
  "Última sesión del mes",
  "Pago adelantado",
  null, null, null, null, null,
];

// 20 realistic Mexican therapy patient names. phone/email/birthdate mirror the
// real schema so the Expediente contact card and edit form have content to
// render in demo — birthdate only filled for minors (those with a parent).
// `overdue` means the patient has missed their last 2-3 months of payments,
// producing a visible saldo on the Home and Finances screens. `paidAhead`
// means they pay like clockwork, producing a zero or near-zero balance.
const PSYCHOLOGIST_PATIENT_DEFS = [
  { name: "Sofía Ramírez",      day: "Lunes",     time: "09:00", rate: 800, status: "active", phone: "+52 55 1234 5678", email: "sofia.ramirez@example.com", paidAhead: true },
  { name: "Diego Hernández",    day: "Lunes",     time: "11:00", rate: 700, status: "active", modality: "virtual", phone: "+52 55 2345 6789", email: "diego.hernandez@example.com", overdue: true },
  { name: "Valentina Torres",   day: "Lunes",     time: "16:00", rate: 800, status: "active", phone: "+52 55 3456 7890" },
  { name: "Mateo García",       day: "Martes",    time: "10:00", rate: 750, status: "active", parent: "Laura García",   tutor_frequency: 4, birthdate: "2012-03-14", phone: "+52 55 4567 8901", email: "laura.garcia@example.com" },
  { name: "Isabella Morales",   day: "Martes",    time: "14:00", rate: 800, status: "active", phone: "+52 55 5678 9012", email: "isabella.morales@example.com", paidAhead: true },
  { name: "Santiago López",     day: "Martes",    time: "17:00", rate: 700, status: "active", parent: "Roberto López",  tutor_frequency: 6, birthdate: "2013-05-30" },
  { name: "Camila Flores",      day: "Miércoles", time: "09:00", rate: 850, status: "active", phone: "+52 55 6789 0123" },
  { name: "Sebastián Ruiz",     day: "Miércoles", time: "12:00", rate: 700, status: "active", parent: "Patricia Ruiz",  tutor_frequency: 4, birthdate: "2014-08-02", phone: "+52 55 7890 1234", email: "patricia.ruiz@example.com", overdue: true },
  { name: "Regina Díaz",        day: "Miércoles", time: "16:00", rate: 800, status: "active", phone: "+52 55 8901 2345", email: "regina.diaz@example.com" },
  { name: "Emiliano Cruz",      day: "Jueves",    time: "10:00", rate: 750, status: "active", modality: "virtual", phone: "+52 55 9012 3456", parent: "Ana Cruz", tutor_frequency: 8, birthdate: "2010-09-11" },
  { name: "María José Vargas",  day: "Jueves",    time: "13:00", rate: 800, status: "active", email: "mjose.vargas@example.com", paidAhead: true },
  { name: "Leonardo Mendoza",   day: "Jueves",    time: "16:00", rate: 700, status: "active", phone: "+52 55 1122 3344" },
  { name: "Renata Castillo",    day: "Viernes",   time: "09:00", rate: 800, status: "active", modality: "virtual", phone: "+52 55 2233 4455", email: "renata.castillo@example.com" },
  { name: "Andrés Ortega",      day: "Viernes",   time: "11:00", rate: 750, status: "active", parent: "Carmen Ortega",  tutor_frequency: 8, birthdate: "2011-11-21", phone: "+52 55 3344 5566", email: "carmen.ortega@example.com" },
  { name: "Paula Salazar",      day: "Viernes",   time: "15:00", rate: 800, status: "active", phone: "+52 55 4455 6677", overdue: true },
  { name: "Nicolás Guzmán",     day: "Lunes",     time: "14:00", rate: 700, status: "active", parent: "Mariana Guzmán", tutor_frequency: 6, birthdate: "2015-02-18" },
  { name: "Luciana Peña",       day: "Miércoles", time: "10:00", rate: 850, status: "ended",  phone: "+52 55 5566 7788" },
  { name: "Fernando Reyes",     day: "Jueves",    time: "11:00", rate: 700, status: "ended" },
  { name: "Daniela Herrera",    day: "Martes",    time: "09:00", rate: 800, status: "active", phone: "+52 55 6677 8899", email: "daniela.herrera@example.com" },
  { name: "Alejandro Romero",   day: "Viernes",   time: "13:00", rate: 750, status: "active", phone: "+52 55 7788 9900" },
];

// Nutritionist demo: 20 mostly-adult clients (occasional teen with a
// parent). Schedules are weekly consultations, modalities mix presencial
// and virtual. Rates are a touch higher to reflect the typical
// Mexican-market pricing for nutrition consults.
const NUTRITIONIST_PATIENT_DEFS = [
  // First 5 entries carry rich anthropometric data so the Mediciones tab
  // and Salud block render well in demo. The rest leave the fields blank
  // (still valid — most clients won't have full data on day one).
  // Patients with `inbody: true` get the richer body-comp fields seeded
  // on every measurement (skeletal_muscle_kg, visceral_fat_level,
  // phase_angle, inbody_score, …) so the multi-metric sparkline + body-
  // composition stack + visceral pill + Resumen tile grid all demo live.
  // The other two stay manual to mirror real clinics where some patients
  // have InBody scans and others don't.
  // Episodic + InBody — the canonical "modern nutritionist" setup:
  // no weekly slot, biweekly-ish follow-ups, full body-comp scans.
  { name: "Natalia Bravo",      day: "Lunes",     time: "09:00", rate: 900, status: "active", phone: "+52 55 1010 2020", email: "natalia.bravo@example.com", paidAhead: true,
    height_cm: 168, goal_weight_kg: 65, goal_body_fat_pct: 26, allergies: "Lácteos", medical_conditions: "Hipotiroidismo controlado",
    inbody: true, scheduling_mode: "episodic", episodicCadenceWeeks: [2, 3], episodicNextInWeeks: 2,
    start_weight_kg: 78, start_waist_cm: 92, start_body_fat_pct: 32 },
  { name: "Roberto Aguilar",    day: "Lunes",     time: "11:00", rate: 850, status: "active", modality: "virtual", phone: "+52 55 2020 3030", overdue: true,
    height_cm: 178, goal_weight_kg: 80, allergies: "", medical_conditions: "Diabetes tipo 2",
    inbody: true, scheduling_mode: "episodic", episodicCadenceWeeks: [3, 4], episodicNextInWeeks: 1,
    start_weight_kg: 96, start_waist_cm: 105, start_body_fat_pct: 28 },
  { name: "Mariana Velasco",    day: "Lunes",     time: "16:00", rate: 900, status: "active", phone: "+52 55 3030 4040",
    height_cm: 162, goal_weight_kg: 58, allergies: "Mariscos", medical_conditions: "",
    inbody: true, scheduling_mode: "episodic", episodicCadenceWeeks: [4, 6], episodicNextInWeeks: 4,
    // Mariana is in maintenance phase — past goal, occasional
    // check-ins. Last 3 visits get tagged maintenance to demo the
    // visit-type taxonomy alongside the cadence variation.
    maintenanceTail: 3,
    start_weight_kg: 70, start_waist_cm: 84, start_body_fat_pct: 30 },
  // Recurring nutrition patients — kept on a fixed weekly slot to demo
  // the per-patient override (a nutritionist with stable workshop-style
  // clients won't always work episodically).
  { name: "Pablo Estrada",      day: "Martes",    time: "10:00", rate: 850, status: "active", phone: "+52 55 4040 5050", email: "pablo.estrada@example.com",
    height_cm: 175, goal_weight_kg: 75, allergies: "Frutos secos",
    start_weight_kg: 88, start_waist_cm: 100 },
  { name: "Carolina Mora",      day: "Martes",    time: "14:00", rate: 950, status: "active", phone: "+52 55 5050 6060", email: "carolina.mora@example.com", paidAhead: true,
    height_cm: 170, goal_weight_kg: 62, medical_conditions: "Hipertensión leve",
    start_weight_kg: 73, start_waist_cm: 86, start_body_fat_pct: 27 },
  { name: "Tomás Quintero",     day: "Martes",    time: "17:00", rate: 850, status: "active", modality: "virtual" },
  { name: "Ximena Beltrán",     day: "Miércoles", time: "09:00", rate: 900, status: "active", phone: "+52 55 6060 7070" },
  { name: "Iván Domínguez",     day: "Miércoles", time: "12:00", rate: 850, status: "active", phone: "+52 55 7070 8080", email: "ivan.dominguez@example.com", overdue: true },
  { name: "Lucía Cárdenas",     day: "Miércoles", time: "16:00", rate: 950, status: "active", phone: "+52 55 8080 9090" },
  { name: "Ana Sofía Trejo",    day: "Jueves",    time: "10:00", rate: 850, status: "active", parent: "Berta Trejo", tutor_frequency: 6, birthdate: "2010-04-12", phone: "+52 55 9090 0101" },
  { name: "Jorge Escobedo",     day: "Jueves",    time: "13:00", rate: 900, status: "active", email: "jorge.escobedo@example.com", paidAhead: true },
  { name: "Valeria Acosta",     day: "Jueves",    time: "16:00", rate: 850, status: "active", modality: "virtual", phone: "+52 55 1212 3434" },
  { name: "Felipe Alarcón",     day: "Viernes",   time: "09:00", rate: 900, status: "active", phone: "+52 55 2323 4545", email: "felipe.alarcon@example.com" },
  { name: "Rocío Bermúdez",     day: "Viernes",   time: "11:00", rate: 850, status: "active", phone: "+52 55 3434 5656" },
  { name: "Bruno Cisneros",     day: "Viernes",   time: "15:00", rate: 900, status: "active", phone: "+52 55 4545 6767", overdue: true },
  { name: "Adriana Lozano",     day: "Lunes",     time: "14:00", rate: 850, status: "active", phone: "+52 55 5656 7878" },
  { name: "Eduardo Murillo",    day: "Miércoles", time: "10:00", rate: 950, status: "ended",  phone: "+52 55 6767 8989" },
  { name: "Gabriela Núñez",     day: "Jueves",    time: "11:00", rate: 850, status: "ended" },
  { name: "Héctor Pérez",       day: "Martes",    time: "09:00", rate: 900, status: "active", phone: "+52 55 7878 9090", email: "hector.perez@example.com" },
  { name: "Inés Rangel",        day: "Viernes",   time: "13:00", rate: 850, status: "active", phone: "+52 55 8989 0101" },
];

const PSYCHOLOGIST_NOTE_TOPICS = [
  { title: "Progreso general", content: "El paciente muestra mejoría notable en las últimas semanas. Se observa mayor apertura emocional y mejor manejo de ansiedad en situaciones sociales." },
  { title: "Sesión inicial", content: "Primera sesión de evaluación. Se identificaron los principales motivos de consulta: dificultades para dormir, estrés laboral y conflictos familiares. Se acordó un plan de trabajo de 12 sesiones." },
  { title: "Ejercicios de mindfulness", content: "Se introdujeron técnicas de respiración y mindfulness. El paciente respondió positivamente y se comprometió a practicar 10 minutos diarios." },
  { title: "Revisión de objetivos", content: "Se revisaron los objetivos terapéuticos establecidos al inicio. Se ajustó el enfoque para trabajar más en autoestima y límites personales." },
  { title: "Nota de seguimiento", content: "Paciente reporta mejor calidad de sueño después de implementar rutina nocturna. Continúa con dificultades en el ámbito laboral." },
  { title: "Avance significativo", content: "Sesión muy productiva. El paciente logró identificar patrones de pensamiento negativos recurrentes y practicó reestructuración cognitiva exitosamente." },
];

// Tutor (profesor particular) demo: 20 students, mostly minors with a
// parent contact. Schedules mix `presencial`, `a-domicilio`, and
// `virtual`. Rates are per-class, lower than therapy/nutrition.
const TUTOR_PATIENT_DEFS = [
  { name: "Mateo Solís",          day: "Lunes",     time: "16:00", rate: 350, status: "active", parent: "Laura Solís",     tutor_frequency: 6, birthdate: "2012-04-09", phone: "+52 55 1010 0001", email: "laura.solis@example.com", paidAhead: true },
  { name: "Camila Iturbide",      day: "Lunes",     time: "17:30", rate: 350, status: "active", parent: "Roberto Iturbide", tutor_frequency: 6, birthdate: "2013-08-22", phone: "+52 55 1010 0002", modality: "a-domicilio" },
  { name: "Diego Fonseca",        day: "Lunes",     time: "19:00", rate: 400, status: "active", parent: "Patricia Fonseca", tutor_frequency: 6, birthdate: "2010-06-14", overdue: true },
  { name: "Sofía Marín",          day: "Martes",    time: "16:00", rate: 350, status: "active", parent: "Carolina Marín",   tutor_frequency: 6, birthdate: "2014-02-03", phone: "+52 55 1010 0003" },
  { name: "Andrés Quiroga",       day: "Martes",    time: "17:30", rate: 350, status: "active", parent: "Marisol Quiroga",  tutor_frequency: 6, birthdate: "2011-11-30", modality: "a-domicilio", phone: "+52 55 1010 0004", email: "marisol.quiroga@example.com" },
  { name: "Valentina Robles",     day: "Martes",    time: "19:00", rate: 400, status: "active", parent: "Federico Robles",  tutor_frequency: 6, birthdate: "2009-05-18", paidAhead: true },
  { name: "Emiliano Ponce",       day: "Miércoles", time: "16:00", rate: 350, status: "active", parent: "Adriana Ponce",    tutor_frequency: 6, birthdate: "2013-01-25", phone: "+52 55 1010 0005" },
  { name: "Renata Cuevas",        day: "Miércoles", time: "17:30", rate: 350, status: "active", parent: "Gabriela Cuevas",  tutor_frequency: 6, birthdate: "2012-07-12", overdue: true },
  { name: "Sebastián Ledesma",    day: "Miércoles", time: "19:00", rate: 400, status: "active", parent: "Héctor Ledesma",   tutor_frequency: 6, birthdate: "2010-09-04", modality: "virtual", phone: "+52 55 1010 0006" },
  { name: "Isabella Carrillo",    day: "Jueves",    time: "16:00", rate: 350, status: "active", parent: "Mariana Carrillo", tutor_frequency: 6, birthdate: "2014-12-19", paidAhead: true },
  { name: "Leonardo Tapia",       day: "Jueves",    time: "17:30", rate: 350, status: "active", parent: "Sergio Tapia",     tutor_frequency: 6, birthdate: "2011-03-27", modality: "a-domicilio" },
  { name: "Regina Esquivel",      day: "Jueves",    time: "19:00", rate: 400, status: "active", parent: "Lucía Esquivel",   tutor_frequency: 6, birthdate: "2009-10-08", phone: "+52 55 1010 0007", email: "lucia.esquivel@example.com" },
  { name: "Nicolás Galván",       day: "Viernes",   time: "16:00", rate: 350, status: "active", parent: "Patricio Galván",  tutor_frequency: 6, birthdate: "2013-04-15" },
  { name: "Daniela Becerra",      day: "Viernes",   time: "17:30", rate: 350, status: "active", parent: "Verónica Becerra", tutor_frequency: 6, birthdate: "2012-08-29", modality: "virtual", overdue: true },
  { name: "Pablo Aldana",         day: "Viernes",   time: "19:00", rate: 400, status: "active", parent: "Ramón Aldana",     tutor_frequency: 6, birthdate: "2010-01-11", phone: "+52 55 1010 0008" },
  { name: "Ximena Bañuelos",      day: "Sábado",    time: "10:00", rate: 350, status: "active", parent: "Estela Bañuelos",  tutor_frequency: 6, birthdate: "2014-06-21" },
  { name: "Tomás Carbajal",       day: "Sábado",    time: "11:30", rate: 400, status: "active", parent: "Bruno Carbajal",   tutor_frequency: 6, birthdate: "2011-09-02", modality: "a-domicilio" },
  { name: "Lucía Pizarro",        day: "Lunes",     time: "15:00", rate: 350, status: "ended",  parent: "Olivia Pizarro",   birthdate: "2013-05-17" },
  { name: "Adrián Rendón",        day: "Miércoles", time: "15:00", rate: 350, status: "ended",  parent: "Fernando Rendón",  birthdate: "2012-12-08" },
  { name: "María José Ureña",     day: "Jueves",    time: "15:00", rate: 350, status: "active", parent: "Carolina Ureña",   tutor_frequency: 6, birthdate: "2013-03-19", phone: "+52 55 1010 0009" },
];

// Personal trainer demo: 18 adult clients with a mix of strength,
// hypertrofia, and weight-loss goals. Schedules mix presencial,
// a-domicilio, and virtual. Per-session rate.
const TRAINER_PATIENT_DEFS = [
  // First 5 entries carry rich anthropometric data so the Mediciones tab
  // and Salud block render well in demo. Trainer goals tend to be net
  // weight loss + body-fat reduction.
  { name: "Andrea Pelayo",        day: "Lunes",     time: "07:00", extraDay: "Miércoles", extraTime: "07:00", rate: 600, status: "active",                                 phone: "+52 55 3030 0001", email: "andrea.pelayo@example.com", paidAhead: true,
    height_cm: 165, goal_weight_kg: 60, medical_conditions: "",
    start_weight_kg: 72, start_waist_cm: 86, start_body_fat_pct: 30 },
  { name: "Bruno Salinas",        day: "Lunes",     time: "08:00", extraDay: "Jueves",    extraTime: "08:00", rate: 600, status: "active", modality: "a-domicilio",         phone: "+52 55 3030 0002",
    height_cm: 180, goal_weight_kg: 78, medical_conditions: "Lesión de rodilla derecha (2024)",
    start_weight_kg: 92, start_waist_cm: 102, start_body_fat_pct: 26 },
  { name: "Claudia Mejía",        day: "Lunes",     time: "18:00", extraDay: "Miércoles", extraTime: "18:00", rate: 700, status: "active",                                 phone: "+52 55 3030 0003", email: "claudia.mejia@example.com", overdue: true,
    height_cm: 158, goal_weight_kg: 55,
    start_weight_kg: 68, start_waist_cm: 84 },
  { name: "David Rangel",         day: "Martes",    time: "06:00", rate: 600, status: "active", modality: "virtual",             phone: "+52 55 3030 0004",
    height_cm: 175, goal_weight_kg: 80, allergies: "Polen",
    start_weight_kg: 90 },
  { name: "Elena Mier",           day: "Martes",    time: "07:30", rate: 650, status: "active",                                 phone: "+52 55 3030 0005", email: "elena.mier@example.com",
    height_cm: 168, goal_weight_kg: 62,
    start_weight_kg: 71, start_waist_cm: 80, start_body_fat_pct: 25 },
  { name: "Federico Avalos",      day: "Martes",    time: "19:00", rate: 700, status: "active", modality: "a-domicilio", paidAhead: true },
  { name: "Greta Saavedra",       day: "Miércoles", time: "07:00", rate: 600, status: "active",                                 phone: "+52 55 3030 0006" },
  { name: "Hugo Velázquez",       day: "Miércoles", time: "08:00", rate: 600, status: "active", modality: "virtual",             phone: "+52 55 3030 0007", email: "hugo.velazquez@example.com" },
  { name: "Inés Calvillo",        day: "Miércoles", time: "18:00", rate: 700, status: "active", modality: "a-domicilio", overdue: true },
  { name: "Joaquín Tovar",        day: "Jueves",    time: "06:30", rate: 650, status: "active",                                 phone: "+52 55 3030 0008" },
  { name: "Karla Berlanga",       day: "Jueves",    time: "08:00", rate: 600, status: "active", modality: "a-domicilio",         email: "karla.berlanga@example.com" },
  { name: "Luis Olivares",        day: "Jueves",    time: "19:00", rate: 700, status: "active",                                 phone: "+52 55 3030 0009", paidAhead: true },
  { name: "Mónica Bañales",       day: "Viernes",   time: "07:00", rate: 600, status: "active",                                 phone: "+52 55 3030 0010" },
  { name: "Néstor Pacheco",       day: "Viernes",   time: "08:00", rate: 600, status: "active", modality: "virtual",             phone: "+52 55 3030 0011" },
  { name: "Olga Rentería",        day: "Viernes",   time: "18:00", rate: 700, status: "active", modality: "a-domicilio",         phone: "+52 55 3030 0012", email: "olga.renteria@example.com" },
  { name: "Patricio Moncada",     day: "Sábado",    time: "09:00", rate: 700, status: "active",                                 phone: "+52 55 3030 0013" },
  { name: "Raúl Quintanilla",     day: "Sábado",    time: "10:00", rate: 650, status: "ended" },
  { name: "Silvia Treviño",       day: "Sábado",    time: "11:00", rate: 600, status: "active",                                 phone: "+52 55 3030 0014", email: "silvia.trevino@example.com" },
];

const TRAINER_NOTE_TOPICS = [
  { title: "Evaluación inicial", content: "Cliente de 34 años, 78 kg / 1.72 m. Sin lesiones previas. Objetivo: bajar 5 kg de grasa y ganar masa muscular en piernas. Plan: 3 sesiones/semana, 12 semanas, evaluación cada 4." },
  { title: "Rutina de hoy — pierna", content: "Calentamiento 8 min cardio + movilidad. Sentadilla 4x8 @ 60 kg. Peso muerto rumano 4x10 @ 50 kg. Press de pierna 3x12 @ 100 kg. Curl femoral 3x12. Pantorrillas 4x15. Cardio LISS 10 min." },
  { title: "Mediciones — semana 4", content: "Peso 76.2 kg (-1.8). Cintura 84 cm (-3 cm). Sentadilla subió de 60 kg a 70 kg @ 8 reps. Buena adherencia, 11 de 12 sesiones cumplidas." },
  { title: "Reporte de progreso (1er bloque)", content: "Cierre del primer bloque de 12 semanas. Objetivos cumplidos: -5 kg, sentadilla 80 kg @ 5RM. Continuamos con bloque de hipertrofia próximas 8 semanas." },
  { title: "Ajuste de plan", content: "El cliente reporta dolor lumbar leve después de peso muerto convencional. Cambiamos a peso muerto rumano + extensión lumbar. Reducir carga 20% por 2 semanas y reevaluar." },
  { title: "Comunicación con cliente", content: "Mensaje breve: confirmar sesión del miércoles 7 am, recordatorio de comer 60 min antes y traer agua. Acordar día de medición la próxima semana." },
];

// Music teacher demo: 18 students across instruments (piano, guitar,
// violin, voice, drums). Mostly minors with a parent contact. Schedules
// strongly favour 'a-domicilio' (home visits are the music-teacher
// flagship) but mix with presencial and virtual. Per-class rate.
const MUSIC_TEACHER_PATIENT_DEFS = [
  { name: "Mateo Solórzano",      day: "Lunes",     time: "16:00", rate: 450, status: "active", parent: "Laura Solórzano",  tutor_frequency: 6, birthdate: "2013-04-09", phone: "+52 55 2020 0001", email: "laura.solorzano@example.com", modality: "a-domicilio", paidAhead: true },
  { name: "Camila Iturralde",     day: "Lunes",     time: "17:30", rate: 450, status: "active", parent: "Roberto Iturralde", tutor_frequency: 6, birthdate: "2014-08-22", phone: "+52 55 2020 0002", modality: "a-domicilio" },
  { name: "Sofía Marqués",        day: "Lunes",     time: "19:00", rate: 500, status: "active",                                                                                                            phone: "+52 55 2020 0003", email: "sofia.marques@example.com" },
  { name: "Diego Fonseca",        day: "Martes",    time: "16:00", rate: 450, status: "active", parent: "Patricia Fonseca", tutor_frequency: 6, birthdate: "2011-06-14", modality: "a-domicilio", overdue: true },
  { name: "Andrés Quiroga",       day: "Martes",    time: "17:30", rate: 450, status: "active", parent: "Marisol Quiroga",  tutor_frequency: 6, birthdate: "2012-11-30", modality: "a-domicilio", phone: "+52 55 2020 0004" },
  { name: "Valentina Robles",     day: "Martes",    time: "19:00", rate: 500, status: "active", parent: "Federico Robles",  tutor_frequency: 6, birthdate: "2010-05-18", modality: "virtual", paidAhead: true },
  { name: "Emiliano Ponce",       day: "Miércoles", time: "16:00", rate: 450, status: "active", parent: "Adriana Ponce",    tutor_frequency: 6, birthdate: "2014-01-25", phone: "+52 55 2020 0005" },
  { name: "Renata Cuevas",        day: "Miércoles", time: "17:30", rate: 450, status: "active", parent: "Gabriela Cuevas",  tutor_frequency: 6, birthdate: "2013-07-12", modality: "a-domicilio" },
  { name: "Sebastián Ledesma",    day: "Miércoles", time: "19:00", rate: 500, status: "active", parent: "Héctor Ledesma",   tutor_frequency: 6, birthdate: "2011-09-04", phone: "+52 55 2020 0006", overdue: true },
  { name: "Isabella Carrillo",    day: "Jueves",    time: "16:00", rate: 450, status: "active", parent: "Mariana Carrillo", tutor_frequency: 6, birthdate: "2015-12-19", modality: "a-domicilio", paidAhead: true },
  { name: "Leonardo Tapia",       day: "Jueves",    time: "17:30", rate: 450, status: "active", parent: "Sergio Tapia",     tutor_frequency: 6, birthdate: "2012-03-27", modality: "a-domicilio" },
  { name: "Regina Esquivel",      day: "Jueves",    time: "19:00", rate: 500, status: "active",                                                                                                            phone: "+52 55 2020 0007", email: "regina.esquivel@example.com" },
  { name: "Nicolás Galván",       day: "Viernes",   time: "16:00", rate: 450, status: "active", parent: "Patricio Galván",  tutor_frequency: 6, birthdate: "2014-04-15", modality: "a-domicilio" },
  { name: "Daniela Becerra",      day: "Viernes",   time: "17:30", rate: 450, status: "active", parent: "Verónica Becerra", tutor_frequency: 6, birthdate: "2013-08-29", modality: "virtual", overdue: true },
  { name: "Pablo Aldana",         day: "Viernes",   time: "19:00", rate: 500, status: "active",                                                                                                            phone: "+52 55 2020 0008" },
  { name: "Ximena Bañuelos",      day: "Sábado",    time: "10:00", rate: 450, status: "active", parent: "Estela Bañuelos",  tutor_frequency: 6, birthdate: "2015-06-21", modality: "a-domicilio" },
  { name: "Tomás Carbajal",       day: "Sábado",    time: "11:30", rate: 500, status: "ended",  parent: "Bruno Carbajal",                          birthdate: "2012-09-02" },
  { name: "Lucía Pizarro",        day: "Sábado",    time: "13:00", rate: 450, status: "active", parent: "Olivia Pizarro",   tutor_frequency: 6, birthdate: "2014-05-17", modality: "a-domicilio", phone: "+52 55 2020 0009" },
];

const MUSIC_TEACHER_NOTE_TOPICS = [
  { title: "Diagnóstico inicial", content: "Primera clase de piano. Edad 9, sin estudios previos. Buena disposición y oído musical natural. Plan: 12 clases para cubrir lectura básica, postura y primera pieza simple. Material: método Bastien." },
  { title: "Repertorio en curso", content: "Trabajando 'Para Elisa' (primeras dos secciones). Memorización de la primera frase lograda. Pendiente: dinámica del crescendo en compases 9-12 y mantener tempo estable en la sección B." },
  { title: "Sesión de técnica", content: "Escalas mayores hasta 2 sostenidos a metrónomo 80. Arpegios de Do, Sol y Re. El alumno necesita reforzar la independencia de manos en velocidades superiores a 100 BPM." },
  { title: "Comunicación con padres", content: "Mensaje breve a la mamá: el alumno necesita una banca con altura ajustable y silencio durante los 20 min de práctica diaria. Se acordó práctica supervisada los fines de semana." },
  { title: "Preparación de recital", content: "Recital de fin de bloque el 15 de junio. Pieza: Sonatina en Do mayor de Clementi (1er movimiento). Plan de 6 sesiones: 2 de memorización, 2 de tempo, 1 de ensayo con público y 1 de pulido final." },
  { title: "Cierre de bloque", content: "Concluyó el método del nivel 1 con 98% de los ejercicios completos. Tocó su recital sin errores. Próximo bloque: introducción a improvisación y primer pieza barroca (Bach, BWV Anh. 114)." },
];

const TUTOR_NOTE_TOPICS = [
  { title: "Diagnóstico inicial", content: "Primera sesión de matemáticas (5° de primaria). Buen manejo de operaciones básicas, dificultad con fracciones y problemas de palabras. Plan de 12 clases enfocado en comprensión." },
  { title: "Reporte de progreso", content: "Avance notable en fracciones equivalentes. Resolvió 8/10 ejercicios sin ayuda. Falta reforzar suma de fracciones con distinto denominador. Tarea: 5 ejercicios de la página 42." },
  { title: "Tarea asignada", content: "Resumir capítulo 4 del libro de español, contestar preguntas 1-6 al final del capítulo. Entrega el viernes para revisar antes de la próxima clase." },
  { title: "Preparación de examen", content: "Examen de unidad el próximo lunes. Repasamos: fracciones, decimales, perímetro y área. Plan: 2 sesiones de repaso esta semana, exámenes practicar tipo MARV." },
  { title: "Comunicación con padres", content: "Reunión breve con la mamá. Pidió enfocarnos también en redacción para el examen de español. Acordamos dedicar 15 min al final de cada sesión a ortografía y composición." },
  { title: "Cierre de bloque", content: "Calificación del periodo: 9.2 en matemáticas (subió desde 7.4). Continuar con el plan en el siguiente bimestre, agregando geometría a partir de la próxima clase." },
];

const NUTRITIONIST_NOTE_TOPICS = [
  { title: "Consulta inicial", content: "Primer encuentro. Peso 78 kg, estatura 1.68 m. Objetivo: bajar 6 kg en 4 meses con plan equilibrado, sin dietas restrictivas. Se acordó seguimiento quincenal." },
  { title: "Plan alimenticio entregado", content: "Se entregó plan de 1700 kcal/día con macros 30P / 30G / 40C. El paciente prefiere desayuno frío y comidas con tortilla 1-2 veces por semana." },
  { title: "Seguimiento semana 4", content: "Pérdida de 1.8 kg desde la primera consulta. Cintura -2 cm. Adherencia ~85%. Reporta más energía y mejor digestión. Mantenemos plan, ajustamos colaciones." },
  { title: "Apego al plan", content: "Reporta dificultad con la cena entre semana por horarios laborales. Propuse alternativas listas en 10 min. Acordamos preparar 2 días por adelantado el domingo." },
  { title: "Revisión de objetivos", content: "A 8 semanas, el paciente bajó 4.2 kg. Ajustamos el objetivo a -3 kg adicionales antes del verano y agregamos 2 sesiones de actividad física semanales." },
  { title: "Cierre de etapa", content: "Logró el peso meta. Se entregó plan de mantenimiento con 200 kcal adicionales. Próxima consulta en 1 mes para revisar adherencia post-meta." },
];

const PATIENT_DEFS_BY_PROFESSION = {
  psychologist:  PSYCHOLOGIST_PATIENT_DEFS,
  nutritionist:  NUTRITIONIST_PATIENT_DEFS,
  tutor:         TUTOR_PATIENT_DEFS,
  music_teacher: MUSIC_TEACHER_PATIENT_DEFS,
  trainer:       TRAINER_PATIENT_DEFS,
};

const NOTE_TOPICS_BY_PROFESSION = {
  psychologist:  PSYCHOLOGIST_NOTE_TOPICS,
  nutritionist:  NUTRITIONIST_NOTE_TOPICS,
  tutor:         TUTOR_NOTE_TOPICS,
  music_teacher: MUSIC_TEACHER_NOTE_TOPICS,
  trainer:       TRAINER_NOTE_TOPICS,
};

const DAY_TO_JS = { "Lunes":1, "Martes":2, "Miércoles":3, "Jueves":4, "Viernes":5, "Sábado":6, "Domingo":0 };

function getNextDay(dayName, fromDate) {
  const target = DAY_TO_JS[dayName];
  const d = new Date(fromDate);
  let diff = target - d.getDay();
  if (diff < 0) diff += 7;
  d.setDate(d.getDate() + diff);
  return d;
}

// Inverse of DAY_TO_JS — used when seeding episodic sessions, which
// have no fixed weekday. The row's `day` column still holds the
// literal weekday-of-the-date for calendar display.
const JS_TO_DAY = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
function weekdayName(date) {
  return JS_TO_DAY[date.getDay()];
}

export function generateDemoData(profession = DEFAULT_PROFESSION) {
  const patientDefs = PATIENT_DEFS_BY_PROFESSION[profession]
    ?? PATIENT_DEFS_BY_PROFESSION[DEFAULT_PROFESSION];
  const noteTopics = NOTE_TOPICS_BY_PROFESSION[profession]
    ?? NOTE_TOPICS_BY_PROFESSION[DEFAULT_PROFESSION];

  const now = new Date();
  const startDate = new Date(now);
  startDate.setMonth(startDate.getMonth() - 9);
  startDate.setDate(1);

  const demoUserId = "demo-user";
  const patients = [];
  const sessions = [];
  const payments = [];
  const notes = [];
  const measurements = [];

  patientDefs.forEach((def, idx) => {
    const patientId = uuid();
    const initials = getInitials(def.name);
    const colorIdx = idx % COLORS;

    // Episodic = no perpetual weekly slot. Default for nutrition seeds
    // unless the def opts back into recurring (we keep 1-2 nutrition
    // patients on recurring to demo per-patient overrides). Other
    // professions stay on weekly recurrence as today.
    const isEpisodicPatient = def.scheduling_mode === "episodic";

    // Generate weekly sessions from 9 months ago to 4 weeks from now
    const firstSession = getNextDay(def.day, startDate);
    const endGen = addWeeks(now, 4);
    const patientSessions = [];
    let current = new Date(firstSession);

    // Some professions/clients meet more than once per week. The flag
    // `extraDay` declares the second weekday and time (e.g. trainer
    // clients training Mon+Wed). Stays opt-in per def so the existing
    // weekly-only seeds are unaffected.
    const extraStart = def.extraDay
      ? getNextDay(def.extraDay, startDate)
      : null;
    let extraCurrent = extraStart ? new Date(extraStart) : null;

    // Ended patients stop 2-3 months ago
    const endDate = def.status === "ended"
      ? new Date(now.getFullYear(), now.getMonth() - 2, 15)
      : endGen;

    if (isEpisodicPatient) {
      // Episodic seed: a stream of past one-offs every 2–5 weeks
      // (variable, modulated per patient via def.episodicCadenceWeeks)
      // plus 0–2 future scheduled rows so "Próxima consulta" demos
      // live on the Resumen tab. Rows are NOT is_recurring — they
      // mirror what an episodic patient's calendar actually looks
      // like: standalone visits scheduled at the end of each prior
      // visit, no perpetual slot.
      // Visit-type taxonomy is layered post-loop: first chronological
      // visit → intake; the rest → followup; the very last 1–2 if
      // the patient is in maintenance phase per def.maintenanceTail.
      const cadenceWeeks = def.episodicCadenceWeeks || [3, 4]; // min, max
      // Walk backward from "first future visit" so the next visit
      // sits at the end and the past stretches behind it. This
      // produces a more realistic "I just saw them" pattern than
      // marching forward from the start_date.
      const futureOffsetWeeks = def.episodicNextInWeeks ?? 2;
      let walker = addWeeks(now, futureOffsetWeeks);
      const horizonBack = endDate < now ? endDate : startDate;
      while (walker >= horizonBack) {
        const isPast = walker < now;
        let status = "scheduled";
        if (isPast) {
          const rand = Math.random();
          if (rand < 0.85) status = "completed";
          else if (rand < 0.92) status = "charged";
          else status = "cancelled";
        }
        patientSessions.push({
          id: uuid(),
          user_id: demoUserId,
          patient_id: patientId,
          patient: def.name,
          initials,
          time: def.time,
          // Episodic patients have no perpetual day-of-week, but the
          // sessions table still stores the row's literal weekday for
          // calendar display. Derive it from the date so the name
          // matches the actual day.
          day: weekdayName(walker),
          date: dateStr(walker),
          duration: 60,
          rate: def.rate,
          status,
          cancel_reason: status === "cancelled" || status === "charged"
            ? CANCEL_REASONS[Math.floor(Math.random() * CANCEL_REASONS.length)]
            : null,
          modality: def.modality || "presencial",
          session_type: "regular",
          color_idx: colorIdx,
          colorIdx,
          created_at: walker.toISOString(),
        });
        // Step back by a varying-but-realistic cadence.
        const jitter = cadenceWeeks[0] + Math.floor(Math.random() * (cadenceWeeks[1] - cadenceWeeks[0] + 1));
        walker = addWeeks(walker, -jitter);
      }
      // Layer visit-types post-loop. patientSessions is in reverse-
      // chronological order (we walked back from the future), so
      // index N-1 is the chronologically-first visit (the intake).
      // The remaining rows default to followup; if the patient is in
      // maintenance phase (def.maintenanceTail truthy), the most
      // recent N rows get tagged 'maintenance' instead.
      if (patientSessions.length > 0) {
        const tail = def.maintenanceTail || 0;
        for (let i = 0; i < patientSessions.length; i++) {
          if (i === patientSessions.length - 1) patientSessions[i].visit_type = "intake";
          else if (i < tail)                    patientSessions[i].visit_type = "maintenance";
          else                                  patientSessions[i].visit_type = "followup";
        }
      }
    } else while (current <= endDate) {
      const sessId = uuid();
      const sessDate = dateStr(current);
      const isPast = current < now;

      // Determine status for past sessions
      let status = "scheduled";
      if (isPast) {
        const rand = Math.random();
        if (rand < 0.82) status = "completed";
        else if (rand < 0.90) status = "charged";
        else status = "cancelled";
      }

      patientSessions.push({
        id: sessId,
        user_id: demoUserId,
        patient_id: patientId,
        patient: def.name,
        initials: initials,
        time: def.time,
        day: def.day,
        date: sessDate,
        duration: 60,
        rate: def.rate,
        status,
        cancel_reason: status === "cancelled" || status === "charged"
          ? CANCEL_REASONS[Math.floor(Math.random() * CANCEL_REASONS.length)]
          : null,
        modality: def.modality || "presencial",
        session_type: "regular",
        color_idx: colorIdx,
        colorIdx: colorIdx,
        created_at: current.toISOString(),
      });

      current = addWeeks(current, 1);
    }

    // Second weekly slot — same generator, different weekday/time.
    // Mirrors the primary loop so the schedule density looks right
    // for clients who train / study twice a week.
    while (extraCurrent && extraCurrent <= endDate) {
      const sessId = uuid();
      const isPast = extraCurrent < now;
      let status = "scheduled";
      if (isPast) {
        const rand = Math.random();
        if (rand < 0.82) status = "completed";
        else if (rand < 0.90) status = "charged";
        else status = "cancelled";
      }
      patientSessions.push({
        id: sessId,
        user_id: demoUserId,
        patient_id: patientId,
        patient: def.name,
        initials,
        time: def.extraTime || def.time,
        day: def.extraDay,
        date: dateStr(extraCurrent),
        duration: 60,
        rate: def.rate,
        status,
        cancel_reason: status === "cancelled" || status === "charged"
          ? CANCEL_REASONS[Math.floor(Math.random() * CANCEL_REASONS.length)]
          : null,
        modality: def.modality || "presencial",
        session_type: "regular",
        color_idx: colorIdx,
        colorIdx: colorIdx,
        created_at: extraCurrent.toISOString(),
      });
      extraCurrent = addWeeks(extraCurrent, 1);
    }

    // Add tutor sessions for minors (roughly monthly)
    if (def.parent) {
      let tutorDate = addWeeks(firstSession, 4);
      while (tutorDate < now) {
        patientSessions.push({
          id: uuid(),
          user_id: demoUserId,
          patient_id: patientId,
          patient: def.name,
          // Post-migration 023 the parent's initials live unprefixed in
          // `initials`; `session_type === "tutor"` carries the marker.
          initials: getInitials(def.parent),
          time: "18:00",
          day: def.day,
          date: dateStr(tutorDate),
          duration: 60,
          rate: def.rate,
          status: "completed",
          cancel_reason: null,
          modality: "presencial",
          session_type: "tutor",
          color_idx: colorIdx,
          colorIdx: colorIdx,
          created_at: tutorDate.toISOString(),
        });
        tutorDate = addWeeks(tutorDate, 4);
      }
    }

    sessions.push(...patientSessions);

    // Compute billing
    const billableSessions = patientSessions.filter(s => s.status !== "cancelled");
    const billed = billableSessions.length * def.rate;
    const sessionCount = patientSessions.length;

    // Generate payments (roughly monthly, slightly less than billed to create realistic saldos)
    let totalPaid = 0;
    const monthlyBill = def.rate * 4;
    let payMonth = new Date(startDate);
    // Skip-threshold: months within this many back are "recent" and the
    // `overdue` flag will stop generating payments for those to create a
    // visible outstanding balance.
    const overdueCutoff = new Date(now.getFullYear(), now.getMonth() - 2, 1);

    while (payMonth < now) {
      const isRecent = payMonth >= overdueCutoff;
      if (def.overdue && isRecent) {
        // Skip recent months entirely to leave an outstanding balance.
        payMonth.setMonth(payMonth.getMonth() + 1);
        continue;
      }
      const rand = Math.random();
      const fullPayChance = def.paidAhead ? 0.95 : 0.75;
      const partialChance = def.paidAhead ? 1.0 : 0.90;
      if (rand < fullPayChance) {
        // Full month payment
        const payAmount = monthlyBill;
        totalPaid += payAmount;
        payments.push({
          id: uuid(),
          user_id: demoUserId,
          patient_id: patientId,
          patient: def.name,
          initials: initials,
          amount: payAmount,
          date: dateStr(new Date(payMonth.getFullYear(), payMonth.getMonth(), 1 + Math.floor(Math.random() * 15))),
          method: METHODS[Math.floor(Math.random() * METHODS.length)],
          note: PAYMENT_NOTES[Math.floor(Math.random() * PAYMENT_NOTES.length)],
          color_idx: colorIdx,
          colorIdx: colorIdx,
          created_at: payMonth.toISOString(),
        });
      } else if (rand < partialChance) {
        // Partial payment
        const payAmount = Math.round(monthlyBill * 0.5);
        totalPaid += payAmount;
        payments.push({
          id: uuid(),
          user_id: demoUserId,
          patient_id: patientId,
          patient: def.name,
          initials: initials,
          amount: payAmount,
          date: dateStr(new Date(payMonth.getFullYear(), payMonth.getMonth(), 5 + Math.floor(Math.random() * 20))),
          method: METHODS[Math.floor(Math.random() * METHODS.length)],
          note: "Abono parcial",
          color_idx: colorIdx,
          colorIdx: colorIdx,
          created_at: payMonth.toISOString(),
        });
      }
      // else: skipped month (creates outstanding balance)

      payMonth.setMonth(payMonth.getMonth() + 1);
    }

    // Cap billed so saldo stays in a realistic range: paid-ahead patients owe
    // at most ~2 sessions, regulars owe up to ~6, overdue owe up to ~14.
    const maxOwedSessions = def.paidAhead ? 2 : def.overdue ? 14 : 6;
    patients.push({
      id: patientId,
      user_id: demoUserId,
      name: def.name,
      parent: def.parent || "",
      initials,
      rate: def.rate,
      // Episodic patients have no perpetual weekly slot — set day/time
      // to NULL so the rest of the app reads "no recurring schedule"
      // cleanly. Recurring patients keep today's behavior.
      day:  isEpisodicPatient ? null : def.day,
      time: isEpisodicPatient ? null : def.time,
      scheduling_mode: isEpisodicPatient ? "episodic" : "recurring",
      status: def.status,
      phone: def.phone || "",
      email: def.email || "",
      birthdate: def.birthdate || null,
      start_date: dateStr(firstSession),
      end_date: def.status === "ended" ? dateStr(endDate) : null,
      billed: Math.min(billed, totalPaid + def.rate * maxOwedSessions),
      paid: totalPaid,
      sessions: sessionCount,
      color_idx: colorIdx,
      colorIdx: colorIdx,
      tutor_frequency: def.tutor_frequency || null,
      // Anthropometric / health-history fields. Only meaningful for the
      // nutri + trainer demo seeds; the others leave them null/empty.
      height_cm: def.height_cm ?? null,
      goal_weight_kg: def.goal_weight_kg ?? null,
      goal_body_fat_pct: def.goal_body_fat_pct ?? null,
      goal_skeletal_muscle_kg: def.goal_skeletal_muscle_kg ?? null,
      allergies: def.allergies || "",
      medical_conditions: def.medical_conditions || "",
      created_at: startDate.toISOString(),
    });

    // Anthropometric measurements timeline. Only generated when the
    // patient def declares a `start_weight_kg`. We back-fill biweekly
    // entries trending towards `goal_weight_kg` (capped at the goal).
    if (def.start_weight_kg && def.goal_weight_kg) {
      const start = Number(def.start_weight_kg);
      const goal = Number(def.goal_weight_kg);
      // 12 biweekly readings (~6 months of demo data). Weight moves
      // linearly from start to goal across that span.
      const N = 12;
      const startMs = startDate.getTime();
      const totalLossKg = start - goal;
      for (let i = 0; i < N; i++) {
        const dayOffset = i * 14;
        const measureDate = new Date(startMs + dayOffset * 86400000);
        if (measureDate > now) break;
        const t = i / (N - 1);
        const weightKg = +(start - totalLossKg * t).toFixed(1);
        // Waist tracks weight ~loosely (1cm per 0.7kg).
        const waistCm = def.start_waist_cm
          ? +(def.start_waist_cm - (start - weightKg) / 0.7).toFixed(1)
          : null;
        const bodyFatPct = def.start_body_fat_pct
          ? +(def.start_body_fat_pct - (start - weightKg) * 0.4).toFixed(1)
          : null;

        const baseRow = {
          id: uuid(),
          user_id: demoUserId,
          patient_id: patientId,
          taken_at: measureDate.toISOString().slice(0, 10),
          weight_kg: weightKg,
          waist_cm: waistCm,
          hip_cm: null,
          body_fat_pct: bodyFatPct,
          notes: "",
          created_at: measureDate.toISOString(),
        };

        // InBody-rich rows: layer the body-comp body of work on top of
        // the basic weight + waist + body fat already computed. Values
        // are derived deterministically from weight + body fat so the
        // chart trends look real (muscle slightly improves as fat
        // drops, water tracks lean mass, score climbs with progress).
        if (def.inbody && bodyFatPct != null) {
          const fatKg = +(weightKg * (bodyFatPct / 100)).toFixed(1);
          const leanKg = +(weightKg - fatKg).toFixed(1);
          const muscleKg = +(leanKg * 0.55).toFixed(1);     // SMM ≈ 55% of lean
          const waterKg = +(leanKg * 0.62).toFixed(1);      // TBW ≈ 62% of lean
          const proteinKg = +(leanKg * 0.18).toFixed(1);    // Protein ≈ 18% of lean
          const mineralsKg = +(leanKg * 0.04).toFixed(2);   // Bone + minerals ≈ 4%
          // Visceral fat trends from elevado → normal as the patient
          // progresses; capped at the typical clinical range.
          const visceralStart = bodyFatPct > 30 ? 13 : (bodyFatPct > 25 ? 11 : 9);
          const visceralLevel = Math.max(5, Math.round(visceralStart - t * 4));
          // BMR follows Mifflin-St Jeor approximation, gendered output
          // omitted for brevity — close enough for demo visuals.
          const bmr = Math.round(10 * weightKg + 6.25 * (def.height_cm || 170) - 5 * 35 + 5);
          // Phase angle: 4.5–6.5 typical, drifts up with progress.
          const phaseAngle = +(4.8 + t * 0.9 + (Math.random() * 0.2 - 0.1)).toFixed(2);
          // InBody Score: 60–90 typical, climbs with progress.
          const inbodyScore = Math.min(95, Math.round(70 + t * 15));

          Object.assign(baseRow, {
            source: "inbody_csv",
            scanned_at: measureDate.toISOString(),
            device_model: "InBody 770",
            skeletal_muscle_kg: muscleKg,
            body_fat_kg: fatKg,
            visceral_fat_level: visceralLevel,
            total_body_water_kg: waterKg,
            protein_kg: proteinKg,
            minerals_kg: mineralsKg,
            basal_metabolic_rate_kcal: bmr,
            phase_angle: phaseAngle,
            inbody_score: inbodyScore,
          });
        } else {
          baseRow.source = "manual";
        }

        measurements.push(baseRow);
      }
    }

    // 2-4 notes per patient
    const noteCount = 2 + Math.floor(Math.random() * 3);
    const pastSessions = patientSessions.filter(s => s.status === "completed");
    for (let n = 0; n < noteCount && n < noteTopics.length; n++) {
      const linkedSession = pastSessions[Math.floor(Math.random() * pastSessions.length)];
      const noteDate = new Date(now);
      noteDate.setDate(noteDate.getDate() - Math.floor(Math.random() * 180));
      notes.push({
        id: uuid(),
        user_id: demoUserId,
        patient_id: patientId,
        session_id: linkedSession?.id || null,
        title: noteTopics[n].title,
        content: noteTopics[n].content,
        // Pin the first note per patient for ~1 in 4 patients so the pinned-
        // notes feature is visible on the Notes screen in demo.
        pinned: n === 0 && idx % 4 === 0,
        created_at: noteDate.toISOString(),
        updated_at: noteDate.toISOString(),
      });
    }
  });

  // Sort payments newest first
  payments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  // Sort notes newest first
  notes.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  return { patients, sessions, payments, notes, measurements };
}
