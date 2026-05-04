/* ── Cardi tools ──────────────────────────────────────────────────────
   Tool definitions + executors for the Cardi AI helper. When the user
   asks a question that requires real data ("¿quién me debe más?",
   "¿cuántas sesiones tuve este mes?", "muéstrame el balance de
   Pepito"), Claude calls one of these tools, the server executes it
   scoped to the authed user, and the result is fed back to Claude
   for the final answer.

   What's included in tool outputs:
     - Patient name, status (active/ended), rate, balance, paid total
     - Session metadata: date, time, status, rate, duration, modality
     - Payment metadata: date, amount, method
     - Recurring schedule (day + time)

   What's NEVER included (defense-in-depth — the queries don't even
   select these columns):
     - Note bodies (encrypted or plain)
     - Phone numbers
     - Email addresses
     - Birthdate
     - Allergies / medical conditions
     - Goal weight, height, anthropometrics
     - Document file paths

   All queries filter by user_id. The service-role client bypasses
   RLS so the user_id filter is the *only* boundary — must never be
   omitted from any query in this file. */

import { getServiceClient } from "./_admin.js";

// Spanish month abbreviations matching utils/dates.js::SHORT_MONTHS.
// Sessions/payments store dates as "D-MMM" strings (e.g. "8-Abr").
const SHORT_MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const SHORT_PARTS_RE = /[\s-]/;

// Mirror of utils/dates.js::parseShortDate. Year is inferred from
// reference (assumes the date is within ~6 months of today).
function parseShortDate(str, ref = new Date()) {
  if (!str) return new Date(NaN);
  const parts = String(str).split(SHORT_PARTS_RE).filter(Boolean);
  const dayNum = parts[0];
  const mon = parts[1];
  const mIdx = SHORT_MONTHS.indexOf(mon);
  const m = mIdx >= 0 ? mIdx : 0;
  const d = parseInt(dayNum, 10) || 1;
  // Year inference: closest year that puts this date within +/- 6 months
  // of the reference. Same heuristic as the React side.
  const refY = ref.getFullYear();
  const candidates = [refY - 1, refY, refY + 1];
  let best = candidates[1];
  let bestDelta = Infinity;
  for (const y of candidates) {
    const dt = new Date(y, m, d);
    const delta = Math.abs(dt - ref);
    if (delta < bestDelta) { bestDelta = delta; best = y; }
  }
  return new Date(best, m, d);
}

// Mirror of utils/accounting.js::sessionCountsTowardBalance. Keep in
// sync — if the predicate drifts the balances Cardi reports won't
// match the in-app numbers and users will lose trust.
function sessionEndMoment(s) {
  const d = parseShortDate(s.date);
  if (s.time) {
    const [h, m] = s.time.split(":");
    d.setHours(parseInt(h, 10) || 0, parseInt(m, 10) || 0);
  }
  d.setTime(d.getTime() + 60 * 60 * 1000);
  return d;
}
function sessionCountsTowardBalance(s, now) {
  if (!s) return false;
  if (s.status === "completed" || s.status === "charged") return true;
  if (s.status === "scheduled") return now >= sessionEndMoment(s);
  return false;
}

// Date range helpers for the get_finance_summary tool. Inputs are
// ISO YYYY-MM-DD strings; we compare against parsed session/payment
// dates which are "D-MMM" strings.
function isoToDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// ────────────────────────────────────────────────────────────────────
// Tool definitions — exposed to Claude verbatim.
// ────────────────────────────────────────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: "list_patients",
    description:
      "Lista todos los pacientes/clientes del usuario con: nombre, estado (activo/archivado), honorarios, balance pendiente, crédito a favor, total pagado, conteo de sesiones (total, completadas, canceladas, últimos 30 días), horario recurrente, fecha de inicio, y fecha del último pago. Úsalo para preguntas como '¿quién me debe más?', '¿cuántos pacientes activos tengo?', '¿cuántas sesiones tuve esta semana?'. Ordenado por balance pendiente descendente.",
    input_schema: {
      type: "object",
      properties: {
        active_only: {
          type: "boolean",
          description: "Si es true, excluye pacientes archivados. Default: true.",
        },
        limit: {
          type: "integer",
          description: "Máximo de pacientes a regresar. Default: 100, máx: 200.",
        },
      },
    },
  },
  {
    name: "get_patient_detail",
    description:
      "Obtiene el detalle completo de UN paciente: balance, todas las sesiones (fecha, hora, estado, modalidad, honorarios) y todos los pagos (fecha, monto, método). Acepta el nombre completo o parcial — hace búsqueda fuzzy. Si hay varios candidatos regresa la lista para que aclares con el usuario. Úsalo para preguntas específicas sobre un paciente: '¿cuándo fue la última cita de Pepito?', 'muéstrame los pagos de María'.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Nombre del paciente, completo o parcial.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "get_finance_summary",
    description:
      "Resumen financiero y de asistencia para un rango de fechas. Regresa: ingresos totales recibidos, ingresos por método de pago, número de sesiones programadas/completadas/canceladas, balance pendiente total entre todos los pacientes. Úsalo para preguntas como '¿cuánto cobré en mayo?', '¿cuántas sesiones tuve el mes pasado?', '¿cuánto me deben en total?'.",
    input_schema: {
      type: "object",
      properties: {
        date_from: {
          type: "string",
          description: "Fecha inicial (incluida) en formato ISO YYYY-MM-DD. Si se omite, no hay límite inferior.",
        },
        date_to: {
          type: "string",
          description: "Fecha final (incluida) en formato ISO YYYY-MM-DD. Si se omite, no hay límite superior.",
        },
      },
    },
  },
];

// ────────────────────────────────────────────────────────────────────
// Executors
// ────────────────────────────────────────────────────────────────────

export async function executeTool(name, input, userId) {
  if (!userId) throw new Error("userId required");
  const svc = getServiceClient();
  switch (name) {
    case "list_patients":
      return listPatients(svc, userId, input || {});
    case "get_patient_detail":
      return getPatientDetail(svc, userId, input || {});
    case "get_finance_summary":
      return getFinanceSummary(svc, userId, input || {});
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function listPatients(svc, userId, input) {
  const activeOnly = input.active_only !== false;
  const limit = Math.max(1, Math.min(200, Number(input.limit) || 100));

  let q = svc
    .from("patients")
    .select("id,name,status,rate,paid,day,time,start_date,parent")
    .eq("user_id", userId)
    .order("name", { ascending: true })
    .limit(limit);
  if (activeOnly) q = q.eq("status", "active");

  const { data: patients, error } = await q;
  if (error) throw new Error(error.message);
  if (!patients || patients.length === 0) return { count: 0, patients: [] };

  const ids = patients.map((p) => p.id);
  const [{ data: sessions, error: se }, { data: payments, error: pe }] = await Promise.all([
    svc.from("sessions")
      .select("patient_id,date,time,status,rate")
      .eq("user_id", userId)
      .in("patient_id", ids),
    svc.from("payments")
      .select("patient_id,amount,date")
      .eq("user_id", userId)
      .in("patient_id", ids),
  ]);
  if (se) throw new Error(se.message);
  if (pe) throw new Error(pe.message);

  const now = new Date();
  const ms30d = 30 * 24 * 60 * 60 * 1000;

  const out = patients.map((p) => {
    const sess = (sessions || []).filter((s) => s.patient_id === p.id);
    const pays = (payments || []).filter((py) => py.patient_id === p.id);

    // Consumed = sum of session rates that count toward the balance.
    // Uses the same predicate as utils/accounting.js — drift here
    // would make Cardi's numbers disagree with the in-app balance.
    const consumed = sess.reduce((sum, s) => {
      if (!sessionCountsTowardBalance(s, now)) return sum;
      const rate = s.rate != null ? s.rate : (p.rate || 0);
      return sum + rate;
    }, 0);
    const paid = p.paid || 0;
    const balance_mxn = Math.max(0, consumed - paid);
    const credit_mxn = Math.max(0, paid - consumed);

    const sessions_total = sess.length;
    const sessions_completed = sess.filter((s) => sessionCountsTowardBalance(s, now)).length;
    const sessions_cancelled = sess.filter((s) => s.status === "cancelled").length;
    const sessions_charged = sess.filter((s) => s.status === "charged").length;
    const sessions_last_30d = sess.filter((s) => {
      const d = parseShortDate(s.date);
      const delta = now - d;
      return delta >= 0 && delta <= ms30d && sessionCountsTowardBalance(s, now);
    }).length;

    const sortedPays = pays
      .map((py) => ({ ...py, parsed: parseShortDate(py.date) }))
      .sort((a, b) => b.parsed - a.parsed);
    const last_payment = sortedPays[0];

    return {
      name: p.name,
      status: p.status,
      rate_mxn: p.rate,
      balance_mxn,
      credit_mxn,
      total_paid_mxn: paid,
      sessions_total,
      sessions_completed,
      sessions_cancelled,
      sessions_charged,
      sessions_last_30d,
      schedule: p.day && p.time ? `${p.day} ${p.time}` : null,
      start_date: p.start_date || null,
      tutor: p.parent || null,
      last_payment_at: last_payment ? last_payment.date : null,
      last_payment_mxn: last_payment ? last_payment.amount : null,
    };
  });

  out.sort((a, b) => b.balance_mxn - a.balance_mxn);
  return { count: out.length, patients: out };
}

async function getPatientDetail(svc, userId, input) {
  const query = String(input.name || "").trim();
  if (!query) throw new Error("name is required");
  const lc = query.toLowerCase();

  const { data: candidates, error } = await svc
    .from("patients")
    .select("id,name,status,rate,paid,day,time,start_date,parent")
    .eq("user_id", userId)
    .ilike("name", `%${query}%`)
    .limit(10);
  if (error) throw new Error(error.message);

  if (!candidates || candidates.length === 0) {
    return { found: false, message: `No encontré ningún paciente cuyo nombre contenga "${query}".` };
  }

  // If multiple, prefer exact (case-insensitive) match; otherwise
  // return the list and let Claude ask the user to clarify.
  let target = candidates.find((c) => c.name.toLowerCase() === lc);
  if (!target && candidates.length === 1) target = candidates[0];
  if (!target) {
    return {
      found: false,
      ambiguous: true,
      candidates: candidates.map((c) => ({ name: c.name, status: c.status })),
      message: `Encontré varios pacientes que coinciden con "${query}". ¿A cuál te refieres?`,
    };
  }

  const [{ data: sessions, error: se }, { data: payments, error: pe }] = await Promise.all([
    svc.from("sessions")
      .select("date,time,status,rate,duration,modality,session_type,is_recurring")
      .eq("user_id", userId)
      .eq("patient_id", target.id)
      .order("date", { ascending: false })
      .limit(200),
    svc.from("payments")
      .select("date,amount,method")
      .eq("user_id", userId)
      .eq("patient_id", target.id)
      .order("date", { ascending: false })
      .limit(200),
  ]);
  if (se) throw new Error(se.message);
  if (pe) throw new Error(pe.message);

  const now = new Date();
  const consumed = (sessions || []).reduce((sum, s) => {
    if (!sessionCountsTowardBalance(s, now)) return sum;
    const rate = s.rate != null ? s.rate : (target.rate || 0);
    return sum + rate;
  }, 0);
  const paid = target.paid || 0;

  return {
    found: true,
    patient: {
      name: target.name,
      status: target.status,
      rate_mxn: target.rate,
      balance_mxn: Math.max(0, consumed - paid),
      credit_mxn: Math.max(0, paid - consumed),
      total_paid_mxn: paid,
      schedule: target.day && target.time ? `${target.day} ${target.time}` : null,
      start_date: target.start_date || null,
      tutor: target.parent || null,
    },
    sessions: (sessions || []).map((s) => ({
      date: s.date,
      time: s.time,
      status: s.status,
      rate_mxn: s.rate,
      duration_min: s.duration,
      modality: s.modality,
      type: s.session_type,
      recurring: s.is_recurring,
    })),
    payments: (payments || []).map((p) => ({
      date: p.date,
      amount_mxn: p.amount,
      method: p.method,
    })),
  };
}

async function getFinanceSummary(svc, userId, input) {
  const dateFrom = isoToDate(input.date_from);
  const dateTo = isoToDate(input.date_to);

  const [{ data: patients, error: pe }, { data: sessions, error: se }, { data: payments, error: paye }] = await Promise.all([
    svc.from("patients").select("id,rate,paid").eq("user_id", userId),
    svc.from("sessions").select("patient_id,date,time,status,rate,modality").eq("user_id", userId),
    svc.from("payments").select("date,amount,method").eq("user_id", userId),
  ]);
  if (pe) throw new Error(pe.message);
  if (se) throw new Error(se.message);
  if (paye) throw new Error(paye.message);

  const now = new Date();
  const inRange = (d) => {
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };

  // Sessions in range
  const sessRows = (sessions || []).map((s) => ({ ...s, _d: parseShortDate(s.date) }));
  const sessionsInRange = sessRows.filter((s) => inRange(s._d));

  const sessions_scheduled_total = sessionsInRange.length;
  const sessions_completed = sessionsInRange.filter((s) => sessionCountsTowardBalance(s, now)).length;
  const sessions_cancelled = sessionsInRange.filter((s) => s.status === "cancelled").length;
  const sessions_charged = sessionsInRange.filter((s) => s.status === "charged").length;

  const by_modality = {};
  for (const s of sessionsInRange) {
    if (!sessionCountsTowardBalance(s, now)) continue;
    by_modality[s.modality || "presencial"] = (by_modality[s.modality || "presencial"] || 0) + 1;
  }

  // Payments in range
  const payRows = (payments || []).map((p) => ({ ...p, _d: parseShortDate(p.date) }));
  const paymentsInRange = payRows.filter((p) => inRange(p._d));
  const total_received_mxn = paymentsInRange.reduce((sum, p) => sum + (p.amount || 0), 0);
  const by_method = {};
  for (const p of paymentsInRange) {
    by_method[p.method || "Otro"] = (by_method[p.method || "Otro"] || 0) + (p.amount || 0);
  }

  // Total outstanding balance across all patients (always "now",
  // not range-scoped — balance is a current snapshot).
  let total_outstanding_mxn = 0;
  let total_credit_mxn = 0;
  for (const p of patients || []) {
    const sess = sessRows.filter((s) => s.patient_id === p.id);
    const consumed = sess.reduce((sum, s) => {
      if (!sessionCountsTowardBalance(s, now)) return sum;
      return sum + (s.rate != null ? s.rate : (p.rate || 0));
    }, 0);
    const paid = p.paid || 0;
    total_outstanding_mxn += Math.max(0, consumed - paid);
    total_credit_mxn += Math.max(0, paid - consumed);
  }

  return {
    date_from: input.date_from || null,
    date_to: input.date_to || null,
    sessions_scheduled_total,
    sessions_completed,
    sessions_cancelled,
    sessions_charged,
    sessions_by_modality: by_modality,
    total_received_mxn,
    payments_by_method_mxn: by_method,
    payment_count: paymentsInRange.length,
    total_outstanding_mxn,
    total_credit_mxn,
    note: "balance/credit son al momento actual; ingresos y sesiones son del rango pedido.",
  };
}
