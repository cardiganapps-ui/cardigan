/* ── ICS generator (RFC 5545) ────────────────────────────────────────
   Pure, server-side helper. Takes an array of session rows + a
   timezone string and returns a text/calendar body suitable for
   serving to subscribing calendar clients (Google Calendar, Apple
   Calendar, Outlook, etc.).

   Privacy: SUMMARY uses the full patient name so therapists see at a
   glance who the session is with from inside their calendar app. The
   ICS URL behaves like a long unguessable secret — anyone who has it
   can read the feed, including the third-party calendar service the
   user pastes it into. Surface this trade-off in the Settings copy
   whenever the URL is exposed. Modality and a brief status note go
   into DESCRIPTION.

   Timezone: we emit DTSTART/DTEND with TZID=<tz> and include a single
   minimal VTIMEZONE block. Mexico abolished DST nationally in 2022,
   so a fixed -0600 offset works for America/Mexico_City. Calendar
   clients with their own zoneinfo (all major ones) prefer that over
   the embedded block, so this is mostly a fallback for off-grid
   readers.

   Date/time inputs: sessions store `date` as "D-MMM" (Spanish month
   abbrev) and `time` as "HH:MM"; the parser is shared with the rest
   of the app via parseShortDate / inferYear in src/utils/dates. We
   re-implement the bare minimum here to avoid pulling client code
   into a serverless function. */

const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

// Sessions are written with no year in the date string. Infer it from
// the reference (today): if the parsed (month, day) is more than 6 months
// in the past relative to today, assume next year. Same heuristic the
// client uses in inferYear(); kept in sync intentionally.
function inferYear(monthIdx, day, ref = new Date()) {
  const candidate = new Date(ref.getFullYear(), monthIdx, day);
  const diffMs = candidate.getTime() - ref.getTime();
  const sixMonthsMs = 1000 * 60 * 60 * 24 * 183;
  if (diffMs < -sixMonthsMs) return ref.getFullYear() + 1;
  if (diffMs >  sixMonthsMs) return ref.getFullYear() - 1;
  return ref.getFullYear();
}

function parseShortDate(str, ref = new Date()) {
  if (!str || typeof str !== "string") return null;
  const parts = str.split(/[\s-]+/);
  if (parts.length < 2) return null;
  const day = parseInt(parts[0], 10);
  const monthIdx = SHORT_MONTHS.indexOf(parts[1]);
  if (!Number.isFinite(day) || monthIdx < 0) return null;
  const year = inferYear(monthIdx, day, ref);
  return { year, month: monthIdx + 1, day };
}

function pad(n) { return String(n).padStart(2, "0"); }

function formatLocalDateTime({ year, month, day }, time) {
  // "HH:MM" → "HHMM00". Defaults to 00:00 if missing.
  let hours = 0, mins = 0;
  if (typeof time === "string") {
    const [h, m] = time.split(":").map((v) => parseInt(v, 10));
    if (Number.isFinite(h)) hours = h;
    if (Number.isFinite(m)) mins = m;
  }
  return `${year}${pad(month)}${pad(day)}T${pad(hours)}${pad(mins)}00`;
}

function formatUTCStamp(date = new Date()) {
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

function escapeText(s) {
  if (s == null) return "";
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

// RFC 5545 §3.1: lines longer than 75 octets must be folded — split with
// CRLF + a single leading space on the continuation line. We measure in
// UTF-16 code units, which is a small overestimate vs. UTF-8 octets but
// safe (folding earlier than required is allowed).
function foldLine(line) {
  const MAX = 73; // leave headroom for CRLF + space
  if (line.length <= MAX) return line;
  const out = [];
  let i = 0;
  while (i < line.length) {
    out.push(line.slice(i, i + MAX));
    i += MAX;
  }
  return out.join("\r\n ");
}

function formatStatus(sessionStatus) {
  // Map our statuses to the small ICS vocabulary. Cancelled events
  // appear as strikethroughs in most clients; charged sessions are
  // confirmed (the appointment time was held even if the patient
  // didn't show, and we want it visible on the calendar).
  if (sessionStatus === "cancelled") return "CANCELLED";
  return "CONFIRMED";
}

function vtimezoneBlock(tz) {
  // Hardcoded for America/Mexico_City (no DST since 2022). For other
  // zones we still emit a block with the same offset as a graceful
  // fallback; a properly-configured client will use its own zoneinfo
  // for any TZID it recognizes.
  return [
    "BEGIN:VTIMEZONE",
    `TZID:${tz}`,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:-0600",
    "TZOFFSETTO:-0600",
    "TZNAME:CST",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
}

/**
 * Generate a complete VCALENDAR body from session rows.
 *
 * @param {object} options
 * @param {Array<object>} options.sessions - DB rows. Required fields:
 *   id, date ("D-MMM"), time ("HH:MM"), duration (minutes),
 *   status, patient (full name). Optional: initials (fallback for
 *   missing patient), modality, cancel_reason.
 * @param {string} options.timezone - IANA TZ name. Defaults to America/Mexico_City.
 * @param {string} options.calendarName - Title shown in the subscriber's UI.
 */
export function generateICS({ sessions, timezone = "America/Mexico_City", calendarName = "Cardigan" } = {}) {
  const now = new Date();
  const ref = new Date(); // year inference reference
  const dtstamp = formatUTCStamp(now);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cardigan//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `NAME:${escapeText(calendarName)}`,
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    `X-WR-TIMEZONE:${timezone}`,
    ...vtimezoneBlock(timezone),
  ];

  for (const s of sessions || []) {
    const parsed = parseShortDate(s.date, ref);
    if (!parsed) continue;
    const durationMinutes = Number(s.duration) > 0 ? Number(s.duration) : 60;
    const dtStart = formatLocalDateTime(parsed, s.time);
    // Compute end by adding minutes to a JS Date in UTC then formatting
    // as a local string with the same TZ. Since the offset is constant
    // (-06:00) for the supported zones, plain minute arithmetic on the
    // local components is correct.
    const startMs = Date.UTC(parsed.year, parsed.month - 1, parsed.day,
      parseInt((s.time || "00:00").split(":")[0], 10) || 0,
      parseInt((s.time || "00:00").split(":")[1], 10) || 0);
    const endMs = startMs + durationMinutes * 60 * 1000;
    const endDate = new Date(endMs);
    const endLocal = formatLocalDateTime(
      {
        year: endDate.getUTCFullYear(),
        month: endDate.getUTCMonth() + 1,
        day: endDate.getUTCDate(),
      },
      `${pad(endDate.getUTCHours())}:${pad(endDate.getUTCMinutes())}`
    );

    const summary = `Sesión - ${escapeText(s.patient || s.initials || "?")}`;
    const descParts = [];
    if (s.modality) descParts.push(`Modalidad: ${s.modality}`);
    if (s.status === "charged") descParts.push("Cancelada con cargo.");
    if (s.status === "cancelled" && s.cancel_reason) descParts.push(`Motivo: ${s.cancel_reason}`);
    const description = escapeText(descParts.join("\n"));

    lines.push(
      "BEGIN:VEVENT",
      `UID:${s.id}@cardigan.mx`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;TZID=${timezone}:${dtStart}`,
      `DTEND;TZID=${timezone}:${endLocal}`,
      foldLine(`SUMMARY:${summary}`),
    );
    if (description) {
      lines.push(foldLine(`DESCRIPTION:${description}`));
    }
    lines.push(
      `STATUS:${formatStatus(s.status)}`,
      "TRANSP:OPAQUE",
      "CATEGORIES:Cardigan",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

// Exposed for the test harness.
export const _internals = { parseShortDate, inferYear, escapeText, foldLine };
