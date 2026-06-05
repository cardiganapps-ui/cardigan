#!/usr/bin/env node
/* ── seed-reviewer-demo.mjs ────────────────────────────────────────
   Seeds a stable demo account that App Store + Play Store reviewers
   sign in with. Idempotent: re-running wipes the demo user's rows
   and reseeds, leaving the auth user (and its UUID) untouched so any
   notification_preferences or push_subscriptions stay attached.

   Email:    demo-reviewer@cardigan.mx
   Password: ReviewerDemo2026!

   Hand these to Google Play Console (Store listing → App access) and
   App Store Connect (App Information → App Review Information).
   Reviewers expect a working demo with realistic data — without it,
   they reject the submission as "incomplete".

   Run:    npm run demo:seed
   Or:     node --env-file=.env.local scripts/seed-reviewer-demo.mjs

   Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env (already
   in .env.local). The seed never touches any other user's data. */

import { createClient } from "@supabase/supabase-js";

const SUPA_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPA_URL || !SERVICE_KEY) {
  console.error("Missing env. Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Run with: node --env-file=.env.local scripts/seed-reviewer-demo.mjs");
  process.exit(2);
}

const DEMO_EMAIL    = "demo-reviewer@cardigan.mx";
const DEMO_PASSWORD = "ReviewerDemo2026!";
const DEMO_NAME     = "Dra. Demo (revisor)";
const DEMO_PROFESSION = "psicologo"; // matches PROFESSION enum

const supabase = createClient(SUPA_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
function shortDate(date) {
  return `${date.getDate()}-${MONTHS_ES[date.getMonth()]}`;
}
function isoDate(date) {
  return date.toISOString().slice(0, 10);
}
function daysFromNow(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}
function dayName(date) {
  return ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"][date.getDay()];
}
function initials(name) {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
}

// ── Patients ──────────────────────────────────────────────────────
// 4 patients with realistic Spanish names + ages + rates. Each has a
// weekly recurring slot so the agenda renders predictable cadence.
const PATIENTS = [
  {
    name: "María García Hernández",
    rate: 850, color: 0, day: "Lun", time: "10:00",
    phone: "5512345678", email: "maria.demo@example.com",
  },
  {
    name: "Juan Pablo Hernández Ruiz",
    rate: 1000, color: 2, day: "Mar", time: "16:00",
    phone: "5523456789", email: "juan.demo@example.com",
  },
  {
    name: "Sofía López Mendoza",
    rate: 900, color: 4, day: "Mié", time: "11:00",
    phone: "5534567890", email: "sofia.demo@example.com",
  },
  {
    name: "Carlos Martínez Vega",
    rate: 800, color: 6, day: "Vie", time: "17:30",
    phone: "5545678901", email: "carlos.demo@example.com",
  },
];

// Per patient: 3 past sessions + 2 future sessions, spaced 7 days apart.
const PAST_SESSION_OFFSETS   = [-21, -14, -7];
const FUTURE_SESSION_OFFSETS = [0, 7]; // 0 = today (visible on Home dashboard)

async function ensureDemoUser() {
  // List all auth users (paged) to find the demo by email. The
  // service-role client doesn't expose a get-by-email helper.
  let userId = null;
  let page = 1;
  while (!userId) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === DEMO_EMAIL);
    if (match) { userId = match.id; break; }
    if (data.users.length < 100) break;
    page++;
  }

  if (userId) {
    console.log(`[seed] demo user already exists: ${userId}`);
    // Update the password in case it drifted (e.g. someone reset it
    // from the Supabase dashboard for testing).
    await supabase.auth.admin.updateUserById(userId, { password: DEMO_PASSWORD });
  } else {
    console.log(`[seed] creating demo user…`);
    const { data, error } = await supabase.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: DEMO_NAME },
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`[seed] created demo user: ${userId}`);
  }

  // Profession is locked via user_profiles. Upsert so reseeding stays
  // safe even after a manual profession change.
  await supabase.from("user_profiles").upsert(
    { user_id: userId, profession: DEMO_PROFESSION },
    { onConflict: "user_id" }
  );

  return userId;
}

async function wipeDemoData(userId) {
  // Order matters because of FK cascades — wipe leaf tables first,
  // then patients, then peripheral profile state. user_subscriptions
  // and user_consents stay (reseeding shouldn't break the trial gate).
  const tables = [
    "notes",
    "documents",
    "measurements",
    "payments",
    "sessions",
    "expenses",
    "sent_reminders",
    "push_subscriptions",
    "notification_preferences",
    "patients",
  ];
  for (const t of tables) {
    const { error, count } = await supabase
      .from(t)
      .delete({ count: "exact" })
      .eq("user_id", userId);
    if (error) throw new Error(`[seed] delete from ${t}: ${error.message}`);
    if (count) console.log(`[seed]   wiped ${count} rows from ${t}`);
  }
}

async function seedPatients(userId) {
  const rows = PATIENTS.map((p, idx) => ({
    user_id: userId,
    name: p.name,
    parent: "",
    phone: p.phone,
    email: p.email,
    initials: initials(p.name),
    rate: p.rate,
    day: p.day,
    time: p.time,
    color_idx: p.color,
    scheduling_mode: "recurring",
    status: "active",
    start_date: isoDate(daysFromNow(-90)),
    sessions: 0, billed: 0, paid: 0,
  }));
  const { data, error } = await supabase.from("patients").insert(rows).select();
  if (error) throw error;
  console.log(`[seed] inserted ${data.length} patients`);
  return data;
}

async function seedSessions(userId, patients) {
  const rows = [];
  for (const p of patients) {
    // Past sessions — status='completed' so the accounting shows
    // realistic billed amounts.
    for (const offset of PAST_SESSION_OFFSETS) {
      const d = daysFromNow(offset);
      rows.push({
        user_id: userId,
        patient_id: p.id,
        patient: p.name,
        initials: p.initials,
        time: p.time,
        day: dayName(d),
        date: shortDate(d),
        duration: 50,
        rate: p.rate,
        modality: "presencial",
        session_type: "regular",
        is_recurring: true,
        color_idx: p.color_idx,
        status: "completed",
      });
    }
    // Future sessions — status='scheduled', includes today so the
    // Home dashboard renders a populated "Sesiones de hoy" block.
    for (const offset of FUTURE_SESSION_OFFSETS) {
      const d = daysFromNow(offset);
      rows.push({
        user_id: userId,
        patient_id: p.id,
        patient: p.name,
        initials: p.initials,
        time: p.time,
        day: dayName(d),
        date: shortDate(d),
        duration: 50,
        rate: p.rate,
        modality: "presencial",
        session_type: "regular",
        is_recurring: true,
        color_idx: p.color_idx,
        status: "scheduled",
      });
    }
  }
  const { data, error } = await supabase.from("sessions").insert(rows).select();
  if (error) throw error;
  console.log(`[seed] inserted ${data.length} sessions (${PAST_SESSION_OFFSETS.length} past + ${FUTURE_SESSION_OFFSETS.length} future per patient)`);
}

async function seedPayments(userId, patients) {
  // One payment per patient — partial in some cases so amountDue
  // renders varied: some "$0 al corriente", some "$X pendiente".
  const rows = patients.map((p, idx) => ({
    user_id: userId,
    patient_id: p.id,
    patient: p.name,
    initials: p.initials,
    // Cover the first 2 past sessions only — leaves 1 outstanding
    // (or 0 for the patient that's paid in full).
    amount: p.rate * (idx === 0 ? 3 : 2),
    date: shortDate(daysFromNow(-7)),
    method: "Transferencia",
    note: null,
    color_idx: p.color_idx,
  }));
  const { data, error } = await supabase.from("payments").insert(rows).select();
  if (error) throw error;
  console.log(`[seed] inserted ${data.length} payments`);
}

async function seedNotes(userId, patients) {
  const rows = [
    {
      user_id: userId,
      patient_id: patients[0].id,
      title: "Resumen — primera quincena",
      content: "La paciente reporta mejoría en el patrón de sueño. Continuar con respiración 4-7-8 antes de dormir. Revisar progreso en próxima sesión.",
      encrypted: false,
      pinned: true,
    },
    {
      user_id: userId,
      patient_id: patients[1].id,
      title: "Plan de sesiones",
      content: "Acordamos pausa de 1 semana por viaje del paciente. Retomar terapia el siguiente martes a la hora habitual.",
      encrypted: false,
      pinned: false,
    },
    {
      user_id: userId,
      patient_id: null,
      title: "Ideas para taller grupal",
      content: "Tema: manejo de ansiedad pre-examen. Audiencia: estudiantes universitarios. Formato: 90 min, máx 12 participantes.",
      encrypted: false,
      pinned: false,
    },
  ];
  const { data, error } = await supabase.from("notes").insert(rows).select();
  if (error) throw error;
  console.log(`[seed] inserted ${data.length} notes`);
}

async function recalcCounters(userId, patients) {
  // Drive sessions/billed/paid counters off the seeded rows. The
  // app's amountDue formula reads patient.billed - paid + adjustments,
  // so accurate counters at seed time make the demo financial view
  // look correct out of the gate.
  for (const p of patients) {
    const { data: sessions } = await supabase
      .from("sessions")
      .select("status, rate")
      .eq("patient_id", p.id);
    const completed = (sessions || []).filter((s) => s.status === "completed");
    const billed = completed.reduce((sum, s) => sum + (s.rate || 0), 0);

    const { data: payments } = await supabase
      .from("payments")
      .select("amount")
      .eq("patient_id", p.id);
    const paid = (payments || []).reduce((sum, x) => sum + (x.amount || 0), 0);

    await supabase
      .from("patients")
      .update({
        sessions: (sessions || []).length,
        billed,
        paid,
      })
      .eq("id", p.id);
  }
  console.log(`[seed] recalculated counters for ${patients.length} patients`);
}

async function main() {
  console.log(`[seed] target: ${SUPA_URL}`);
  const userId = await ensureDemoUser();
  await wipeDemoData(userId);
  const patients = await seedPatients(userId);
  await seedSessions(userId, patients);
  await seedPayments(userId, patients);
  await seedNotes(userId, patients);
  await recalcCounters(userId, patients);

  console.log("");
  console.log("┌───────────────────────────────────────────────────");
  console.log("│ Demo reviewer account ready");
  console.log("│");
  console.log(`│   Email:    ${DEMO_EMAIL}`);
  console.log(`│   Password: ${DEMO_PASSWORD}`);
  console.log("│");
  console.log("│ Hand these to Google Play Console");
  console.log("│   Store listing → App access");
  console.log("│ and App Store Connect");
  console.log("│   App Information → App Review Information");
  console.log("└───────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error("[seed] FAILED:", err.message || err);
  process.exit(1);
});
