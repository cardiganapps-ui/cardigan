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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

// Spanish month abbreviations matching utils/dates.js::SHORT_MONTHS.
// Sessions/payments store dates as "D-MMM" strings (e.g. "8-Abr").
const SHORT_MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const SHORT_PARTS_RE = /[\s-]/;

// Mirror of utils/dates.js::parseShortDate. Year is inferred from
// reference (assumes the date is within ~6 months of today).
function parseShortDate(str: Row, ref = new Date()): Date {
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
    const delta = Math.abs(dt.getTime() - ref.getTime());
    if (delta < bestDelta) { bestDelta = delta; best = y; }
  }
  return new Date(best, m, d);
}

// Mirror of utils/accounting.js::sessionCountsTowardBalance. Keep in
// sync — if the predicate drifts the balances Cardi reports won't
// match the in-app numbers and users will lose trust.
function sessionEndMoment(s: Row): Date {
  // Anchor the yearless date's year inference on created_at, not today —
  // otherwise a scheduled session >~6 months old infers to a future year
  // and stops counting (understated balance). Mirrors utils/accounting.ts.
  const created = s.created_at ? new Date(s.created_at) : null;
  const ref = created && !isNaN(created.getTime()) ? created : new Date();
  const d = parseShortDate(s.date, ref);
  if (s.time) {
    const [h, m] = s.time.split(":");
    d.setHours(parseInt(h, 10) || 0, parseInt(m, 10) || 0);
  }
  d.setTime(d.getTime() + 60 * 60 * 1000);
  return d;
}
function sessionCountsTowardBalance(s: Row, now: Row): boolean {
  if (!s) return false;
  if (s.status === "completed" || s.status === "charged") return true;
  if (s.status === "scheduled") return now >= sessionEndMoment(s);
  return false;
}

// Date range helpers for the get_finance_summary tool. Inputs are
// ISO YYYY-MM-DD strings; we compare against parsed session/payment
// dates which are "D-MMM" strings.
function isoToDate(iso: Row): Date | null {
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
  {
    name: "get_expense_summary",
    description:
      "Resumen de GASTOS (egresos / dinero saliente) para un rango de fechas. Regresa: total egresos, desglose por categoría, desglose por tratamiento fiscal (deducible/no deducible/personal), conteo de gastos sin recibo adjunto, y la utilidad neta del período (ingresos − egresos). Los gastos 'personal' se EXCLUYEN del total y de utilidad. Úsalo para preguntas como '¿cuánto gasté este mes?', '¿en qué categorías estoy gastando más?', '¿cuál fue mi utilidad neta en abril?', '¿cuántos recibos me faltan adjuntar?'.",
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
        category: {
          type: "string",
          description: "Filtra a una sola categoría: consultorio, servicios, software, insumos, formacion, honorarios, transporte, marketing, comisiones, impuestos, otro. Omite para todas.",
        },
      },
    },
  },
  {
    name: "list_recurring_expenses",
    description:
      "Lista las plantillas de gastos recurrentes del usuario (rentas, suscripciones de software, etc. que se generan cada mes). Regresa: monto, categoría, día del mes, estado (activo/pausado), tratamiento fiscal, y el costo mensual total combinado de todas las plantillas activas. Úsalo para '¿cuánto pago en gastos recurrentes al mes?', '¿qué suscripciones tengo activas?'.",
    input_schema: {
      type: "object",
      properties: {
        active_only: {
          type: "boolean",
          description: "Si es true, omite plantillas pausadas. Default: false.",
        },
      },
    },
  },
];

// ────────────────────────────────────────────────────────────────────
// Executors
// ────────────────────────────────────────────────────────────────────

export async function executeTool(name: Row, input: Row, userId: Row): Promise<Row> {
  if (!userId) throw new Error("userId required");
  const svc = getServiceClient();
  switch (name) {
    case "list_patients":
      return listPatients(svc, userId, input || {});
    case "get_patient_detail":
      return getPatientDetail(svc, userId, input || {});
    case "get_finance_summary":
      return getFinanceSummary(svc, userId, input || {});
    case "get_expense_summary":
      return getExpenseSummary(svc, userId, input || {});
    case "list_recurring_expenses":
      return listRecurringExpenses(svc, userId, input || {});
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function listPatients(svc: Row, userId: Row, input: Row): Promise<Row> {
  const activeOnly = input.active_only !== false;
  const limit = Math.max(1, Math.min(200, Number(input.limit) || 100));

  let q = svc
    .from("patients")
    .select("id,name,status,rate,paid,opening_balance,day,time,start_date,parent")
    .eq("user_id", userId)
    .order("name", { ascending: true })
    .limit(limit);
  if (activeOnly) q = q.eq("status", "active");

  const { data: patients, error } = await q;
  if (error) throw new Error(error.message);
  if (!patients || patients.length === 0) return { count: 0, patients: [] };

  const ids = patients.map((p: Row) => p.id);
  const [{ data: sessions, error: se }, { data: payments, error: pe }] = await Promise.all([
    svc.from("sessions")
      .select("patient_id,date,time,status,rate,created_at")
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

  const out = patients.map((p: Row) => {
    const sess = (sessions || []).filter((s: Row) => s.patient_id === p.id);
    const pays = (payments || []).filter((py: Row) => py.patient_id === p.id);

    // Consumed = sum of session rates that count toward the balance.
    // Uses the same predicate as utils/accounting.js — drift here
    // would make Cardi's numbers disagree with the in-app balance.
    const consumed = sess.reduce((sum: Row, s: Row) => {
      if (!sessionCountsTowardBalance(s, now)) return sum;
      const rate = s.rate != null ? s.rate : (p.rate || 0);
      return sum + rate;
    }, 0);
    const paid = p.paid || 0;
    // opening_balance (migration 078): signed starting balance, folded
    // into the delta exactly like utils/accounting.js so Cardi's numbers
    // match the in-app balance.
    const opening = p.opening_balance || 0;
    const balance_mxn = Math.max(0, consumed - paid + opening);
    const credit_mxn = Math.max(0, paid - consumed - opening);

    const sessions_total = sess.length;
    const sessions_completed = sess.filter((s: Row) => sessionCountsTowardBalance(s, now)).length;
    const sessions_cancelled = sess.filter((s: Row) => s.status === "cancelled").length;
    const sessions_charged = sess.filter((s: Row) => s.status === "charged").length;
    const sessions_last_30d = sess.filter((s: Row) => {
      const d = parseShortDate(s.date);
      const delta = now.getTime() - d.getTime();
      return delta >= 0 && delta <= ms30d && sessionCountsTowardBalance(s, now);
    }).length;

    const sortedPays = pays
      .map((py: Row) => ({ ...py, parsed: parseShortDate(py.date) }))
      .sort((a: Row, b: Row) => b.parsed - a.parsed);
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

  out.sort((a: Row, b: Row) => b.balance_mxn - a.balance_mxn);
  return { count: out.length, patients: out };
}

async function getPatientDetail(svc: Row, userId: Row, input: Row): Promise<Row> {
  const query = String(input.name || "").trim();
  if (!query) throw new Error("name is required");
  const lc = query.toLowerCase();

  const { data: candidates, error } = await svc
    .from("patients")
    .select("id,name,status,rate,paid,opening_balance,day,time,start_date,parent")
    .eq("user_id", userId)
    .ilike("name", `%${query}%`)
    .limit(10);
  if (error) throw new Error(error.message);

  if (!candidates || candidates.length === 0) {
    return { found: false, message: `No encontré ningún paciente cuyo nombre contenga "${query}".` };
  }

  // If multiple, prefer exact (case-insensitive) match; otherwise
  // return the list and let Claude ask the user to clarify.
  let target = candidates.find((c: Row) => c.name.toLowerCase() === lc);
  if (!target && candidates.length === 1) target = candidates[0];
  if (!target) {
    return {
      found: false,
      ambiguous: true,
      candidates: candidates.map((c: Row) => ({ name: c.name, status: c.status })),
      message: `Encontré varios pacientes que coinciden con "${query}". ¿A cuál te refieres?`,
    };
  }

  const [{ data: sessions, error: se }, { data: payments, error: pe }] = await Promise.all([
    svc.from("sessions")
      .select("date,time,status,rate,duration,modality,session_type,is_recurring,created_at")
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
  const consumed = (sessions || []).reduce((sum: Row, s: Row) => {
    if (!sessionCountsTowardBalance(s, now)) return sum;
    const rate = s.rate != null ? s.rate : (target.rate || 0);
    return sum + rate;
  }, 0);
  const paid = target.paid || 0;
  // opening_balance (migration 078): signed starting balance, same delta
  // term as utils/accounting.js so Cardi agrees with the in-app number.
  const opening = target.opening_balance || 0;

  return {
    found: true,
    patient: {
      name: target.name,
      status: target.status,
      rate_mxn: target.rate,
      balance_mxn: Math.max(0, consumed - paid + opening),
      credit_mxn: Math.max(0, paid - consumed - opening),
      total_paid_mxn: paid,
      schedule: target.day && target.time ? `${target.day} ${target.time}` : null,
      start_date: target.start_date || null,
      tutor: target.parent || null,
    },
    sessions: (sessions || []).map((s: Row) => ({
      date: s.date,
      time: s.time,
      status: s.status,
      rate_mxn: s.rate,
      duration_min: s.duration,
      modality: s.modality,
      type: s.session_type,
      recurring: s.is_recurring,
    })),
    payments: (payments || []).map((p: Row) => ({
      date: p.date,
      amount_mxn: p.amount,
      method: p.method,
    })),
  };
}

async function getFinanceSummary(svc: Row, userId: Row, input: Row): Promise<Row> {
  const dateFrom = isoToDate(input.date_from);
  const dateTo = isoToDate(input.date_to);

  // Cardi's finance summary belongs to the regular-patient lane.
  // Potentials and discarded leads stay out of total_outstanding_mxn /
  // total_credit_mxn so a free-trial interview that auto-completed
  // doesn't surface as a phantom debt when the user asks "¿cuánto se
  // me debe?". We still pull all sessions (interviews on potentials
  // skip the loop below via the patient filter) so range-scoped session
  // counters stay consistent with what the user sees on Agenda.
  const [{ data: patients, error: pe }, { data: sessions, error: se }, { data: payments, error: paye }] = await Promise.all([
    svc.from("patients").select("id,rate,paid,opening_balance,status").eq("user_id", userId).in("status", ["active", "ended"]),
    svc.from("sessions").select("patient_id,date,time,status,rate,modality,session_type,created_at").eq("user_id", userId),
    svc.from("payments").select("date,amount,method").eq("user_id", userId),
  ]);
  if (pe) throw new Error(pe.message);
  if (se) throw new Error(se.message);
  if (paye) throw new Error(paye.message);

  const now = new Date();
  const inRange = (d: Row) => {
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };

  // Sessions in range
  const sessRows = (sessions || []).map((s: Row) => ({ ...s, _d: parseShortDate(s.date) }));
  const sessionsInRange = sessRows.filter((s: Row) => inRange(s._d));

  const sessions_scheduled_total = sessionsInRange.length;
  const sessions_completed = sessionsInRange.filter((s: Row) => sessionCountsTowardBalance(s, now)).length;
  const sessions_cancelled = sessionsInRange.filter((s: Row) => s.status === "cancelled").length;
  const sessions_charged = sessionsInRange.filter((s: Row) => s.status === "charged").length;

  const by_modality: Row = {};
  for (const s of sessionsInRange) {
    if (!sessionCountsTowardBalance(s, now)) continue;
    by_modality[s.modality || "presencial"] = (by_modality[s.modality || "presencial"] || 0) + 1;
  }

  // Payments in range
  const payRows = (payments || []).map((p: Row) => ({ ...p, _d: parseShortDate(p.date) }));
  const paymentsInRange = payRows.filter((p: Row) => inRange(p._d));
  const total_received_mxn = paymentsInRange.reduce((sum: Row, p: Row) => sum + (p.amount || 0), 0);
  const by_method: Row = {};
  for (const p of paymentsInRange) {
    by_method[p.method || "Otro"] = (by_method[p.method || "Otro"] || 0) + (p.amount || 0);
  }

  // Total outstanding balance across all patients (always "now",
  // not range-scoped — balance is a current snapshot).
  let total_outstanding_mxn = 0;
  let total_credit_mxn = 0;
  for (const p of patients || []) {
    const sess = sessRows.filter((s: Row) => s.patient_id === p.id);
    const consumed = sess.reduce((sum: Row, s: Row) => {
      if (!sessionCountsTowardBalance(s, now)) return sum;
      return sum + (s.rate != null ? s.rate : (p.rate || 0));
    }, 0);
    const paid = p.paid || 0;
    const opening = p.opening_balance || 0; // migration 078 — see above
    total_outstanding_mxn += Math.max(0, consumed - paid + opening);
    total_credit_mxn += Math.max(0, paid - consumed - opening);
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

async function getExpenseSummary(svc: Row, userId: Row, input: Row): Promise<Row> {
  const dateFrom = isoToDate(input.date_from);
  const dateTo = isoToDate(input.date_to);
  const categoryFilter = typeof input.category === "string" ? input.category : null;

  // Pull both expenses and payments in the same range — Cardi's most
  // valuable summary answers "what did I make minus what I spent" in
  // one shot. Personal-treatment rows stay in the raw fetch so we can
  // surface a separate "personal_total_mxn" for transparency, but
  // they're EXCLUDED from total_expenses_mxn and net_profit_mxn (same
  // rule the in-app Resumen tab uses).
  const [{ data: expenses, error: ee }, { data: payments, error: pe }] = await Promise.all([
    svc.from("expenses")
      .select("amount,date,category,description,tax_treatment,recurring_id,receipt_document_id,cfdi_uuid")
      .eq("user_id", userId),
    svc.from("payments").select("date,amount").eq("user_id", userId),
  ]);
  if (ee) throw new Error(ee.message);
  if (pe) throw new Error(pe.message);

  const inRange = (d: Row) => {
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };

  const expRows = (expenses || []).map((e: Row) => ({ ...e, _d: parseShortDate(e.date) }));
  let scoped = expRows.filter((e: Row) => inRange(e._d));
  if (categoryFilter) scoped = scoped.filter((e: Row) => e.category === categoryFilter);

  const businessRows = scoped.filter((e: Row) => e.tax_treatment !== "personal");
  const personalRows = scoped.filter((e: Row) => e.tax_treatment === "personal");

  const total_expenses_mxn = businessRows.reduce((s: Row, e: Row) => s + (e.amount || 0), 0);
  const personal_total_mxn = personalRows.reduce((s: Row, e: Row) => s + (e.amount || 0), 0);

  const by_category_mxn: Row = {};
  for (const e of businessRows) {
    by_category_mxn[e.category] = (by_category_mxn[e.category] || 0) + (e.amount || 0);
  }
  const by_treatment_mxn = {
    deductible: 0, non_deductible: 0,
  };
  for (const e of businessRows) {
    if (e.tax_treatment === "deductible") by_treatment_mxn.deductible += e.amount || 0;
    else if (e.tax_treatment === "non_deductible") by_treatment_mxn.non_deductible += e.amount || 0;
  }

  // Top 10 individual expenses by amount, filtered down to a small
  // payload so Cardi can name the biggest ones if asked.
  const top = [...businessRows]
    .sort((a: Row, b: Row) => (b.amount || 0) - (a.amount || 0))
    .slice(0, 10)
    .map((e: Row) => ({
      date: e.date,
      amount_mxn: e.amount,
      category: e.category,
      description: e.description || null,
      tax_treatment: e.tax_treatment,
      has_receipt: !!e.receipt_document_id,
    }));

  // "Recibo pendiente" is a deductible row with no receipt attached —
  // a real-world friction point the therapist needs reminding about
  // before the contador deadline. Count it scoped to the same range.
  const receipts_pending = businessRows.filter(
    (e: Row) => e.tax_treatment === "deductible" && !e.receipt_document_id
  ).length;

  // Income (revenue) in the same range, so we can surface net profit
  // without forcing Cardi to call get_finance_summary too.
  const payRows = (payments || []).map((p: Row) => ({ ...p, _d: parseShortDate(p.date) }));
  const total_income_mxn = payRows
    .filter((p: Row) => inRange(p._d))
    .reduce((s: Row, p: Row) => s + (p.amount || 0), 0);

  return {
    date_from: input.date_from || null,
    date_to: input.date_to || null,
    category_filter: categoryFilter,
    expense_count: scoped.length,
    total_expenses_mxn,
    personal_total_mxn,
    total_income_mxn,
    net_profit_mxn: total_income_mxn - total_expenses_mxn,
    by_category_mxn,
    by_treatment_mxn,
    receipts_pending,
    top_expenses: top,
    note: "personal está excluido de total_expenses_mxn y net_profit_mxn pero se reporta en personal_total_mxn.",
  };
}

async function listRecurringExpenses(svc: Row, userId: Row, input: Row): Promise<Row> {
  const activeOnly = input.active_only === true;
  let q = svc
    .from("recurring_expenses")
    .select("amount,category,description,day_of_month,active,tax_treatment,start_year,start_month,paused_at")
    .eq("user_id", userId)
    .order("active", { ascending: false })
    .order("amount", { ascending: false });
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const templates = (data || []).map((t: Row) => ({
    amount_mxn: t.amount,
    category: t.category,
    description: t.description || null,
    day_of_month: t.day_of_month,
    tax_treatment: t.tax_treatment,
    active: t.active,
    started: t.start_year && t.start_month ? `${t.start_year}-${String(t.start_month).padStart(2,"0")}` : null,
    paused_at: t.paused_at || null,
  }));

  const monthly_total_active_mxn = templates
    .filter((t: Row) => t.active && t.tax_treatment !== "personal")
    .reduce((s: Row, t: Row) => s + (t.amount_mxn || 0), 0);

  return {
    count: templates.length,
    active_count: templates.filter((t: Row) => t.active).length,
    monthly_total_active_mxn,
    templates,
  };
}
