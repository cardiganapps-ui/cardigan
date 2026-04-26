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
  { name: "Natalia Bravo",      day: "Lunes",     time: "09:00", rate: 900, status: "active", phone: "+52 55 1010 2020", email: "natalia.bravo@example.com", paidAhead: true },
  { name: "Roberto Aguilar",    day: "Lunes",     time: "11:00", rate: 850, status: "active", modality: "virtual", phone: "+52 55 2020 3030", overdue: true },
  { name: "Mariana Velasco",    day: "Lunes",     time: "16:00", rate: 900, status: "active", phone: "+52 55 3030 4040" },
  { name: "Pablo Estrada",      day: "Martes",    time: "10:00", rate: 850, status: "active", phone: "+52 55 4040 5050", email: "pablo.estrada@example.com" },
  { name: "Carolina Mora",      day: "Martes",    time: "14:00", rate: 950, status: "active", phone: "+52 55 5050 6060", email: "carolina.mora@example.com", paidAhead: true },
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
};

const NOTE_TOPICS_BY_PROFESSION = {
  psychologist:  PSYCHOLOGIST_NOTE_TOPICS,
  nutritionist:  NUTRITIONIST_NOTE_TOPICS,
  tutor:         TUTOR_NOTE_TOPICS,
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

  patientDefs.forEach((def, idx) => {
    const patientId = uuid();
    const initials = getInitials(def.name);
    const colorIdx = idx % COLORS;

    // Generate weekly sessions from 9 months ago to 4 weeks from now
    const firstSession = getNextDay(def.day, startDate);
    const endGen = addWeeks(now, 4);
    const patientSessions = [];
    let current = new Date(firstSession);

    // Ended patients stop 2-3 months ago
    const endDate = def.status === "ended"
      ? new Date(now.getFullYear(), now.getMonth() - 2, 15)
      : endGen;

    while (current <= endDate) {
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
        color_idx: colorIdx,
        colorIdx: colorIdx,
        created_at: current.toISOString(),
      });

      current = addWeeks(current, 1);
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
          initials: "T·" + getInitials(def.parent),
          time: "18:00",
          day: def.day,
          date: dateStr(tutorDate),
          duration: 60,
          rate: def.rate,
          status: "completed",
          cancel_reason: null,
          modality: "presencial",
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
      day: def.day,
      time: def.time,
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
      created_at: startDate.toISOString(),
    });

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

  return { patients, sessions, payments, notes };
}
