/* ── Widget snapshot builder ──────────────────────────────────────────
   The single source of the compact JSON the iOS widgets render.

   Consumed from BOTH sides (this is the whole point — one builder,
   zero drift):
     - src/lib/widgetSync.ts (native app): builds the snapshot from the
       in-memory data right after every successful refresh and writes it
       into the App Group container via the WidgetBridge plugin.
     - api/widget-data.ts (Vercel): builds the same snapshot server-side
       from raw DB rows so the widget extension can refresh itself on
       WidgetKit's timeline schedule without the app being opened.

   The Swift decoder (ios-config/widgets/SharedModels.swift) is the
   third party to this contract. Bump `v` on ANY breaking shape change —
   the decoder rejects unknown versions and falls back to its cached
   snapshot rather than rendering garbage.

   Money numbers follow the Prime Directive: balances come from
   enrichPatientsWithBalance over RAW session rows (canonical predicate,
   created_at-anchored year inference). The `status` shown per session
   is display-flavored (past scheduled renders as completed, same as
   useCardiganData::enrichedSessions) but it feeds pixels only — never
   the amounts. */

// NOTE: explicit .js extensions — this module is imported from BOTH the
// Vite client (src/lib/widgetSync.ts) and the Vercel Node functions
// (api/widget-data.ts, NodeNext resolution, which requires them). The
// production Vite build resolves .js → .ts (verified), so the targeted
// disables below are safe.
// eslint-disable-next-line no-restricted-syntax -- NodeNext consumer requires the extension
import { SHORT_MONTHS, formatShortDate, parseShortDate, getInitials } from "./dates.js";
// eslint-disable-next-line no-restricted-syntax -- NodeNext consumer requires the extension
import { enrichPatientsWithBalance, sessionCountsTowardBalance } from "./accounting.js";
// eslint-disable-next-line no-restricted-syntax -- NodeNext consumer requires the extension
import { SESSION_STATUS, isPotentialOrDiscarded, PATIENT_STATUS } from "../data/constants.js";

export const WIDGET_SNAPSHOT_VERSION = 1;

const MONTHS_FULL = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DAYS_FULL = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const DAYS_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

// Legacy space-separated short date ("8 Abr") — still present in old DB
// rows. Mirrors api/_push.ts::formatShortDateLegacy.
function formatShortDateLegacy(date: Date): string {
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`;
}

// "Now" as a wall-clock Date in the given IANA timezone — same
// toLocaleString trick as api/send-session-reminders.ts::toTimezone.
// When tz is the runtime's own zone this is (values-wise) an identity.
function toTimezone(date: Date, tz: string): Date {
  try {
    return new Date(date.toLocaleString("en-US", { timeZone: tz }));
  } catch {
    return date; // unknown tz string — fall back to runtime-local
  }
}

/** Minimal raw-row shapes the builder reads. Callers pass their full
    rows; extra fields are ignored. */
export interface SnapshotSessionRow {
  id?: string;
  patient_id?: string | null;
  patient?: string | null;
  initials?: string | null;
  time?: string | null;
  date: string;
  status?: string | null;
  rate?: number | null;
  created_at?: string | null;
  modality?: string | null;
  group_id?: string | null;
  // PostgREST returns the embedded many-to-one as an object at runtime,
  // but supabase-js (without generated types) types it as an array —
  // accept both and normalize in toEntry.
  groups?: { name?: string | null } | { name?: string | null }[] | null;
}
export interface SnapshotPatientRow {
  id: string;
  status?: string | null;
  rate?: number | null;
  paid?: number | null;
  opening_balance?: number | null;
}
export interface SnapshotPaymentRow {
  amount?: number | null;
  date?: string | null;
  created_at?: string | null;
}

export interface SnapshotSessionEntry {
  id: string;
  time: string;
  patientName: string;
  initials: string;
  modality: string;
  status: string;
  isGroup?: boolean;
}

export interface WidgetSnapshot {
  v: number;
  generatedAt: string;
  tz: string;
  todayLabel: string;
  sessionsToday: SnapshotSessionEntry[];
  nextSession: (SnapshotSessionEntry & { dayLabel: string }) | null;
  kpis: {
    sessionsToday: number;
    activePatients: number;
    collectedMonth: number;
    pendingTotal: number;
    owingPatients: number;
    monthLabel: string;
    currency: string;
  };
  week: { d: string; count: number; isToday: boolean }[];
}

// Both short-date spellings a given calendar day can appear under.
function dayKeys(d: Date): [string, string] {
  return [formatShortDate(d), formatShortDateLegacy(d)];
}

function sessionMinutes(time: string | null | undefined): number {
  if (!time) return 0;
  const [h, m] = time.split(":");
  return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
}

// Occurrence status for a collapsed group, mirroring
// utils/groups.ts::deriveOccurrenceStatus: all-cancelled → cancelled;
// any still-upcoming attendee → scheduled; otherwise → completed.
// First-attendee-wins (the old behavior) mislabeled the whole occurrence
// when e.g. one member cancelled but the class still ran.
function deriveGroupStatus(attendees: SnapshotSessionRow[], now: Date): string {
  if (attendees.length === 0) return SESSION_STATUS.SCHEDULED;
  if (attendees.every(a => a.status === SESSION_STATUS.CANCELLED)) return SESSION_STATUS.CANCELLED;
  const anyUpcoming = attendees.some(a =>
    a.status === SESSION_STATUS.SCHEDULED && !sessionCountsTowardBalance(a, now)
  );
  return anyUpcoming ? SESSION_STATUS.SCHEDULED : SESSION_STATUS.COMPLETED;
}

// Collapse group-class occurrences: N member rows sharing
// (group_id, time) render as ONE agenda entry, same as
// Home.tsx::collapseGroupOccurrences does for the in-app list. The
// representative row's status is replaced with the occurrence-derived
// status (bug-hunt: group collapse kept an arbitrary member's status).
function collapseGroups(rows: SnapshotSessionRow[], now: Date): SnapshotSessionRow[] {
  const buckets = new Map<string, SnapshotSessionRow[]>();
  const out: SnapshotSessionRow[] = [];
  for (const s of rows) {
    if (s.group_id) {
      const key = `${s.group_id}|${s.time || ""}`;
      const bucket = buckets.get(key);
      if (bucket) { bucket.push(s); continue; }
      buckets.set(key, [s]);
      out.push(s); // representative — original position preserved
    } else {
      out.push(s);
    }
  }
  return out.map(s => {
    if (!s.group_id) return s;
    const attendees = buckets.get(`${s.group_id}|${s.time || ""}`) || [s];
    return { ...s, status: deriveGroupStatus(attendees, now) };
  });
}

function toEntry(s: SnapshotSessionRow, displayCompleted: boolean): SnapshotSessionEntry {
  const isGroup = !!s.group_id;
  const g = Array.isArray(s.groups) ? s.groups[0] : s.groups;
  const groupName = g?.name || "Grupo";
  const name = isGroup ? groupName : (s.patient || "");
  const entry: SnapshotSessionEntry = {
    id: s.id || "",
    time: s.time || "",
    patientName: name,
    initials: isGroup ? getInitials(groupName) : (s.initials || getInitials(name)),
    modality: s.modality || "presencial",
    // Display parity with enrichedSessions: a past scheduled slot reads
    // as completed. Pixels only — balances never come from this field.
    status: displayCompleted && s.status === SESSION_STATUS.SCHEDULED
      ? SESSION_STATUS.COMPLETED
      : (s.status || SESSION_STATUS.SCHEDULED),
  };
  if (isGroup) entry.isGroup = true;
  return entry;
}

/**
 * Build the widget snapshot. Pure — inject `now` (real instant) and the
 * user's IANA `tz` (wall-clock date keys + month bucketing are computed
 * in that zone; the accounting predicate keeps the real instant).
 */
export function buildWidgetSnapshot({
  sessions,
  patients,
  payments,
  tz = "America/Mexico_City",
  now = new Date(),
}: {
  sessions: SnapshotSessionRow[] | null | undefined;
  patients: SnapshotPatientRow[] | null | undefined;
  payments: SnapshotPaymentRow[] | null | undefined;
  tz?: string;
  now?: Date;
}): WidgetSnapshot {
  const allSessions = sessions || [];
  const allPatients = patients || [];
  const allPayments = payments || [];
  const userNow = toTimezone(now, tz);
  const nowMin = userNow.getHours() * 60 + userNow.getMinutes();
  const [todayKey, todayKeyLegacy] = dayKeys(userNow);

  // ── Today's agenda ──
  // Same population as Home.tsx::todaySessions: every row dated today
  // regardless of status (cancelled rows render muted, exactly like the
  // in-app list — the KPI count must match what the app shows).
  const todayRows = collapseGroups(
    allSessions
      .filter(s => s.date === todayKey || s.date === todayKeyLegacy)
      .sort((a, b) => (a.time || "").localeCompare(b.time || "")),
    now
  );
  const sessionsToday = todayRows.map(s =>
    // +60 min grace before a scheduled slot flips to "completed" —
    // matches useCardiganData::enrichedSessions / sessionEndMoment.
    toEntry(s, sessionMinutes(s.time) + 60 <= nowMin)
  );

  // ── Next session ──
  // First scheduled slot today still within its hour, else the earliest
  // scheduled slot in the next 7 days.
  let nextSession: WidgetSnapshot["nextSession"] = null;
  const upcomingToday = todayRows.find(s =>
    s.status === SESSION_STATUS.SCHEDULED && sessionMinutes(s.time) + 60 > nowMin
  );
  if (upcomingToday) {
    nextSession = { ...toEntry(upcomingToday, false), dayLabel: "Hoy" };
  } else {
    for (let offset = 1; offset <= 7 && !nextSession; offset++) {
      const day = new Date(userNow);
      day.setDate(day.getDate() + offset);
      const [key, keyLegacy] = dayKeys(day);
      const dayRows = collapseGroups(
        allSessions
          .filter(s => (s.date === key || s.date === keyLegacy) && s.status === SESSION_STATUS.SCHEDULED)
          .sort((a, b) => (a.time || "").localeCompare(b.time || "")),
        now
      );
      if (dayRows.length) {
        const dayLabel = offset === 1 ? "Mañana" : DAYS_FULL[(day.getDay() + 6) % 7];
        nextSession = { ...toEntry(dayRows[0], false), dayLabel };
      }
    }
  }

  // ── Week occupancy (Lun–Dom of the current week) ──
  const monday = new Date(userNow);
  monday.setDate(monday.getDate() - ((userNow.getDay() + 6) % 7));
  const week = DAYS_SHORT.map((d, i) => {
    const day = new Date(monday);
    day.setDate(day.getDate() + i);
    const [key, keyLegacy] = dayKeys(day);
    const count = collapseGroups(
      allSessions.filter(s =>
        (s.date === key || s.date === keyLegacy)
        && (s.status === SESSION_STATUS.SCHEDULED || s.status === SESSION_STATUS.COMPLETED)
      ),
      now
    ).length;
    return { d, count, isToday: i === (userNow.getDay() + 6) % 7 };
  });

  // ── Money KPIs (Prime Directive path) ──
  // Raw sessions + canonical predicate; potentials/discarded excluded
  // from the outstanding lane, same as Home.tsx::totalOwed.
  //
  // Pass userNow (the wall-clock-in-tz reference), NOT the raw UTC
  // instant. sessionEndMoment builds the session's end from its local
  // "HH:MM" as a runtime-local Date; on the client the runtime IS the
  // user's tz so `now` lines up, but this builder also runs server-side
  // (api/widget-data on UTC Vercel), where feeding raw `now` compares a
  // Mexico-wall-clock session end against a UTC instant — 6h of drift
  // that makes a session near its hour count toward "Por cobrar" hours
  // early. userNow re-frames the reference into the same wall-clock
  // space as sessionEndMoment. (bug-hunt: widget UTC balance)
  const enriched = enrichPatientsWithBalance(allPatients, allSessions, userNow);
  let pendingTotal = 0;
  let owingPatients = 0;
  for (const p of enriched) {
    if (isPotentialOrDiscarded(p)) continue;
    pendingTotal += p.amountDue;
    if (p.amountDue > 0) owingPatients++;
  }

  // Current-month payments: created_at bucketed in the user's tz,
  // legacy rows without created_at fall back to the short-date month
  // (mirrors Home.tsx::currentMonthPayments).
  let collectedMonth = 0;
  for (const p of allPayments) {
    let inMonth = false;
    if (p.created_at) {
      const d = toTimezone(new Date(p.created_at), tz);
      inMonth = d.getFullYear() === userNow.getFullYear() && d.getMonth() === userNow.getMonth();
    } else if (p.date) {
      const d = parseShortDate(p.date, userNow);
      inMonth = d.getMonth() === userNow.getMonth();
    }
    if (inMonth) collectedMonth += p.amount || 0;
  }

  return {
    v: WIDGET_SNAPSHOT_VERSION,
    generatedAt: now.toISOString(),
    tz,
    todayLabel: `${DAYS_FULL[(userNow.getDay() + 6) % 7]} ${todayKey}`,
    sessionsToday,
    nextSession,
    kpis: {
      sessionsToday: sessionsToday.length,
      activePatients: allPatients.filter(p => p.status === PATIENT_STATUS.ACTIVE).length,
      collectedMonth,
      pendingTotal,
      owingPatients,
      monthLabel: MONTHS_FULL[userNow.getMonth()],
      currency: "MXN",
    },
    week,
  };
}
