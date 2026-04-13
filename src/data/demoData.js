import { SHORT_MONTHS, formatShortDate, getInitials } from "../utils/dates";
import { DAY_ORDER } from "./seedData";

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

// 20 realistic Mexican therapy patient names
const PATIENT_DEFS = [
  { name: "Sofía Ramírez", day: "Lunes", time: "09:00", rate: 800, status: "active" },
  { name: "Diego Hernández", day: "Lunes", time: "11:00", rate: 700, status: "active" },
  { name: "Valentina Torres", day: "Lunes", time: "16:00", rate: 800, status: "active" },
  { name: "Mateo García", day: "Martes", time: "10:00", rate: 750, status: "active", parent: "Laura García" },
  { name: "Isabella Morales", day: "Martes", time: "14:00", rate: 800, status: "active" },
  { name: "Santiago López", day: "Martes", time: "17:00", rate: 700, status: "active" },
  { name: "Camila Flores", day: "Miércoles", time: "09:00", rate: 850, status: "active" },
  { name: "Sebastián Ruiz", day: "Miércoles", time: "12:00", rate: 700, status: "active", parent: "Patricia Ruiz" },
  { name: "Regina Díaz", day: "Miércoles", time: "16:00", rate: 800, status: "active" },
  { name: "Emiliano Cruz", day: "Jueves", time: "10:00", rate: 750, status: "active" },
  { name: "María José Vargas", day: "Jueves", time: "13:00", rate: 800, status: "active" },
  { name: "Leonardo Mendoza", day: "Jueves", time: "16:00", rate: 700, status: "active" },
  { name: "Renata Castillo", day: "Viernes", time: "09:00", rate: 800, status: "active" },
  { name: "Andrés Ortega", day: "Viernes", time: "11:00", rate: 750, status: "active", parent: "Carmen Ortega" },
  { name: "Paula Salazar", day: "Viernes", time: "15:00", rate: 800, status: "active" },
  { name: "Nicolás Guzmán", day: "Lunes", time: "14:00", rate: 700, status: "active" },
  { name: "Luciana Peña", day: "Miércoles", time: "10:00", rate: 850, status: "ended" },
  { name: "Fernando Reyes", day: "Jueves", time: "11:00", rate: 700, status: "ended" },
  { name: "Daniela Herrera", day: "Martes", time: "09:00", rate: 800, status: "active" },
  { name: "Alejandro Romero", day: "Viernes", time: "13:00", rate: 750, status: "active" },
];

const DAY_TO_JS = { "Lunes":1, "Martes":2, "Miércoles":3, "Jueves":4, "Viernes":5, "Sábado":6, "Domingo":0 };

function getNextDay(dayName, fromDate) {
  const target = DAY_TO_JS[dayName];
  const d = new Date(fromDate);
  let diff = target - d.getDay();
  if (diff < 0) diff += 7;
  d.setDate(d.getDate() + diff);
  return d;
}

export function generateDemoData() {
  const now = new Date();
  const startDate = new Date(now);
  startDate.setMonth(startDate.getMonth() - 9);
  startDate.setDate(1);

  const demoUserId = "demo-user";
  const patients = [];
  const sessions = [];
  const payments = [];
  const notes = [];

  PATIENT_DEFS.forEach((def, idx) => {
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
        status,
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
          status: "completed",
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
    const completedPast = patientSessions.filter(s => s.status === "completed" || s.status === "charged");
    const monthlyBill = def.rate * 4;
    let payMonth = new Date(startDate);

    while (payMonth < now) {
      // Most patients pay monthly, some skip or partial
      const rand = Math.random();
      if (rand < 0.75) {
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
          color_idx: colorIdx,
          colorIdx: colorIdx,
          created_at: payMonth.toISOString(),
        });
      } else if (rand < 0.90) {
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
          color_idx: colorIdx,
          colorIdx: colorIdx,
          created_at: payMonth.toISOString(),
        });
      }
      // else: skipped month (creates outstanding balance)

      payMonth.setMonth(payMonth.getMonth() + 1);
    }

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
      billed: Math.min(billed, totalPaid + def.rate * 8), // keep realistic
      paid: totalPaid,
      sessions: sessionCount,
      color_idx: colorIdx,
      colorIdx: colorIdx,
      created_at: startDate.toISOString(),
    });

    // Add notes for some patients
    const noteTopics = [
      { title: "Progreso general", content: "El paciente muestra mejoría notable en las últimas semanas. Se observa mayor apertura emocional y mejor manejo de ansiedad en situaciones sociales." },
      { title: "Sesión inicial", content: "Primera sesión de evaluación. Se identificaron los principales motivos de consulta: dificultades para dormir, estrés laboral y conflictos familiares. Se acordó un plan de trabajo de 12 sesiones." },
      { title: "Ejercicios de mindfulness", content: "Se introdujeron técnicas de respiración y mindfulness. El paciente respondió positivamente y se comprometió a practicar 10 minutos diarios." },
      { title: "Revisión de objetivos", content: "Se revisaron los objetivos terapéuticos establecidos al inicio. Se ajustó el enfoque para trabajar más en autoestima y límites personales." },
      { title: "Nota de seguimiento", content: "Paciente reporta mejor calidad de sueño después de implementar rutina nocturna. Continúa con dificultades en el ámbito laboral." },
      { title: "Avance significativo", content: "Sesión muy productiva. El paciente logró identificar patrones de pensamiento negativos recurrentes y practicó reestructuración cognitiva exitosamente." },
    ];

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
