/* ── Landing-page mock data ──────────────────────────────────────────
   Single source of truth for every mockup on the landing page —
   ProductPreview (the phone frame), MiniSessions, MiniPatients, and
   MiniFinances all read from the same generated set so the visitor
   sees coherent data across the page instead of three independently
   hand-coded scenarios.

   Profession-aware: getLandingMock("nutritionist") swaps every name,
   rate, and KPI to the nutrition demo seed; "music_teacher" surfaces
   tutor sessions with the a-domicilio modality; etc. The chip row in
   the hero drives this so visitors see multi-profession support
   viscerally.

   Reuses src/data/demoData.js::generateDemoData so we don't fork the
   demo. The mock here is just a curation layer: pick a small,
   presentable subset and roll up the KPIs the way Home + Finances
   do in the live app. */

import { generateDemoData } from "../../data/demoData";
import { formatShortDate } from "../../utils/dates";

const SHORT_MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function parseShort(short) {
  if (!short) return null;
  const m = String(short).match(/^(\d{1,2})[\s-]([A-Za-z]{3})/);
  if (!m) return null;
  const monthIdx = SHORT_MONTHS_ES.findIndex(x => x.toLowerCase() === m[2].toLowerCase());
  if (monthIdx < 0) return null;
  return { day: parseInt(m[1], 10), monthIdx };
}

/* Build a Date from the row's "D-MMM" string in the current year.
   Demo data only stores month-day (matches the live app's date
   format). For ranking purposes we just need monotonic comparison
   with `now`, so picking the closest year (current) is enough. */
function shortToDate(short, now) {
  const p = parseShort(short);
  if (!p) return null;
  return new Date(now.getFullYear(), p.monthIdx, p.day);
}

/* Pick a small subset of upcoming sessions starting from `now`,
   sorted by date+time ascending. We prefer sessions that land
   today; if there aren't enough, we extend forward. The demo
   generator produces 4 weeks of future sessions, so this always
   has material to show. */
function pickUpcomingSessions(sessions, now, n = 3) {
  const today = formatShortDate(now);
  const todays = sessions
    .filter((s) => s.date === today)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  if (todays.length >= n) return todays.slice(0, n);

  // Extend with the next-N upcoming sessions (date >= today).
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const upcoming = sessions
    .map((s) => ({ s, d: shortToDate(s.date, now) }))
    .filter((x) => x.d && x.d.getTime() >= todayMs && x.s.status === "scheduled")
    .sort((a, b) => {
      const dt = a.d.getTime() - b.d.getTime();
      if (dt !== 0) return dt;
      return (a.s.time || "").localeCompare(b.s.time || "");
    })
    .map((x) => x.s);

  // Merge today's first + the rest, dedupe by id, slice.
  const seen = new Set(todays.map((s) => s.id));
  const out = [...todays];
  for (const s of upcoming) {
    if (seen.has(s.id)) continue;
    out.push(s);
    seen.add(s.id);
    if (out.length >= n) break;
  }
  return out.slice(0, n);
}

function startOfMonth(now) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function paymentsThisMonth(payments, now) {
  const start = startOfMonth(now).getTime();
  const monthIdx = now.getMonth();
  let total = 0;
  for (const p of payments || []) {
    const parsed = parseShort(p.date);
    if (!parsed || parsed.monthIdx !== monthIdx) continue;
    const d = shortToDate(p.date, now);
    if (!d || d.getTime() < start || d.getTime() > now.getTime()) continue;
    const amt = Number(p.amount);
    if (Number.isFinite(amt)) total += amt;
  }
  return total;
}

function outstandingTotal(patients) {
  let total = 0;
  for (const p of patients || []) {
    const billed = Number(p.billed) || 0;
    const paid = Number(p.paid) || 0;
    const owed = Math.max(0, billed - paid);
    total += owed;
  }
  return total;
}

function patientsWithBalance(patients) {
  let n = 0;
  for (const p of patients || []) {
    if ((Number(p.billed) || 0) - (Number(p.paid) || 0) > 0) n += 1;
  }
  return n;
}

/* Compose the curated mock the landing components consume. Shape is
   intentionally narrow — only the fields each mock surface actually
   reads — so a future profession seed addition doesn't ripple into
   landing component changes. */
export function getLandingMock(profession = "psychologist") {
  const { patients, sessions, payments } = generateDemoData(profession);
  const now = new Date();

  const todaySessions = pickUpcomingSessions(sessions, now, 3);
  const activePatients = patients.filter((p) => p.status === "active");

  const monthlyCollected = paymentsThisMonth(payments, now);
  const outstanding = outstandingTotal(activePatients);
  const owingCount = patientsWithBalance(activePatients);

  // Two patient cards for MiniPatients — pick a "regular adult"
  // and a "tutor relationship" (parent set) when available so the
  // mini-card showcases both common shapes the app supports. Falls
  // back to the first two active patients otherwise.
  const tutorPatient = activePatients.find((p) => !!p.parent);
  const adultPatient = activePatients.find((p) => !p.parent && p !== tutorPatient);
  const featuredPatients = [adultPatient, tutorPatient].filter(Boolean);
  if (featuredPatients.length < 2) {
    for (const p of activePatients) {
      if (featuredPatients.includes(p)) continue;
      featuredPatients.push(p);
      if (featuredPatients.length >= 2) break;
    }
  }

  const monthLabel = SHORT_MONTHS_ES[now.getMonth()];

  return {
    profession,
    todaySessions,
    activeCount: activePatients.length,
    totalCount: patients.length,
    monthlyCollected,
    outstanding,
    owingCount,
    monthLabel,
    todayShort: formatShortDate(now),
    featuredPatients,
  };
}

/* Format a session's time range from "HH:MM" + duration → "HH:MM - HH:MM"
   (the format the live SessionRow uses). Centralised so every mock
   surface displays the same shape. */
export function formatTimeRange(time, durationMin = 60) {
  if (!time) return "";
  const [hStr, mStr] = String(time).split(":");
  const h = parseInt(hStr, 10) || 0;
  const m = parseInt(mStr, 10) || 0;
  const end = new Date(0, 0, 0, h, m + (Number(durationMin) || 60));
  const eh = String(end.getHours()).padStart(2, "0");
  const em = String(end.getMinutes()).padStart(2, "0");
  const sh = String(h).padStart(2, "0");
  const sm = String(m).padStart(2, "0");
  return `${sh}:${sm} - ${eh}:${em}`;
}

/* MXN formatter matching the rest of the app. */
export function formatMxn(n) {
  return `$${Number(n || 0).toLocaleString("es-MX")}`;
}

/* Pull the avatar background colour from a patient/session row. The
   live app derives this from `colorIdx` via getClientColor; for
   landing we map the same way so the rows visually match production. */
export { getClientColor } from "../../data/seedData";
