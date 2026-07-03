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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

// Sessions are written with no year in the date string. Infer it from
// the reference (today): if the parsed (month, day) is more than 6 months
// in the past relative to today, assume next year. Same heuristic the
// client uses in inferYear(); kept in sync intentionally.
function inferYear(monthIdx: number, day: number, ref = new Date()): number {
  const candidate = new Date(ref.getFullYear(), monthIdx, day);
  const diffMs = candidate.getTime() - ref.getTime();
  const sixMonthsMs = 1000 * 60 * 60 * 24 * 183;
  if (diffMs < -sixMonthsMs) return ref.getFullYear() + 1;
  if (diffMs >  sixMonthsMs) return ref.getFullYear() - 1;
  return ref.getFullYear();
}

function parseShortDate(str: Row, ref = new Date()): Row {
  if (!str || typeof str !== "string") return null;
  const parts = str.split(/[\s-]+/);
  if (parts.length < 2) return null;
  const day = parseInt(parts[0], 10);
  const monthIdx = SHORT_MONTHS.indexOf(parts[1]);
  if (!Number.isFinite(day) || monthIdx < 0) return null;
  const year = inferYear(monthIdx, day, ref);
  return { year, month: monthIdx + 1, day };
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

function formatLocalDateTime({ year, month, day }: Row, time: Row): string {
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

function escapeText(s: Row): string {
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
function foldLine(line: string): string {
  const MAX = 73; // leave headroom for CRLF + space
  if (line.length <= MAX) return line;
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    out.push(line.slice(i, i + MAX));
    i += MAX;
  }
  return out.join("\r\n ");
}

function formatStatus(sessionStatus: Row): string {
  // Map our statuses to the small ICS vocabulary. Cancelled events
  // appear as strikethroughs in most clients; charged sessions are
  // confirmed (the appointment time was held even if the patient
  // didn't show, and we want it visible on the calendar).
  if (sessionStatus === "cancelled") return "CANCELLED";
  return "CONFIRMED";
}

function vtimezoneBlock(tz: string): string[] {
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
export function generateICS({ sessions, timezone = "America/Mexico_City", calendarName = "Cardigan", subjectOverride = null }: Row = {}): string {
  // subjectOverride: when set, every SUMMARY uses this string as the
  // event subject instead of the patient's name. Used by patient-side
  // feeds where the "patient" of the row IS the viewer themselves —
  // greeting the patient with their own name in their calendar would
  // be redundant. Pass the therapist's display name; the SUMMARY
  // becomes "Sesión con {therapist}" / "Entrevista con {therapist}".
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
    // Refresh hints — both required because clients respect different ones:
    //   REFRESH-INTERVAL is RFC 7986; honoured by modern Apple Calendar,
    //   Outlook 365 web/desktop, and Thunderbird.
    //   X-PUBLISHED-TTL is the older de-facto property; honoured by older
    //   Apple Calendar versions and most "Subscribe to calendar" apps.
    // Both ask the client to refresh every 15 minutes — the practical
    // floor for polled subscriptions. Cancellations show up within ~15 min
    // instead of Apple's default ~1 h. Google Calendar ignores both.
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
    ...vtimezoneBlock(timezone),
  ];

  // Collapse group occurrences (N member rows sharing group_id/date/time)
  // into ONE event so a class shows as a single calendar block, not N
  // overlapping events. Only on the therapist feed (no subjectOverride) —
  // a patient feed already contains just the viewer's own member row per
  // occurrence. The representative carries a member count + the group name.
  const eventRows: Row[] = [];
  if (subjectOverride) {
    eventRows.push(...(sessions || []));
  } else {
    const seen = new Map<string, Row>();
    for (const s of sessions || []) {
      if (!s.group_id) { eventRows.push(s); continue; }
      const key = `${s.group_id}|${s.date}|${s.time}`;
      if (seen.has(key)) { seen.get(key)._groupCount += 1; continue; }
      const rep = { ...s, _groupCount: 1, _groupName: s.groups?.name || null };
      seen.set(key, rep);
      eventRows.push(rep);
    }
  }

  for (const s of eventRows) {
    // Anchor the yearless "D-MMM" date on the row's created_at, not
    // today. A session completed 6-12 months ago, today-anchored, infers
    // to a FUTURE year and resurrects in the subscriber's calendar as a
    // confirmed upcoming event. created_at is within the recurrence
    // window of the real date. (bug-hunt: calendar resurrects old rows)
    const createdRef = s.created_at ? new Date(s.created_at) : ref;
    const parsed = parseShortDate(s.date, isNaN(createdRef.getTime()) ? ref : createdRef);
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

    // Interview sessions surface as "Entrevista - …" so a glance at
    // the calendar tells the practitioner this is an interview slot,
    // not a regular session. The SUMMARY also flows into the
    // notification when a calendar client surfaces upcoming events,
    // which matters for the unusual times interviews tend to land at.
    const interviewSession = s.session_type === "interview";
    const isGroupEvent = !subjectOverride && s.group_id;
    const summaryPrefix = interviewSession ? "Entrevista" : isGroupEvent ? "Sesión grupal" : "Sesión";
    // subjectOverride: patient-side feed uses "con {therapist}";
    // therapist-side feed retains the patient's name (or the group name +
    // member count for a collapsed group occurrence).
    const summarySubject = subjectOverride
      ? `con ${escapeText(subjectOverride)}`
      : isGroupEvent
        ? `- ${escapeText(s._groupName || "Grupo")} (${s._groupCount})`
        : `- ${escapeText(s.patient || s.initials || "?")}`;
    const summary = `${summaryPrefix} ${summarySubject}`;
    const descParts: string[] = [];
    if (s.modality) descParts.push(`Modalidad: ${s.modality}`);
    if (s.status === "charged") descParts.push("Cancelada con cargo.");
    if (s.status === "cancelled" && s.cancel_reason) descParts.push(`Motivo: ${s.cancel_reason}`);
    const description = escapeText(descParts.join("\n"));

    lines.push(
      "BEGIN:VEVENT",
      // Stable per-occurrence UID for group events so the same class keeps
      // one calendar entry across refreshes even as member rows change.
      `UID:${isGroupEvent ? `group-${s.group_id}-${s.date}-${s.time}` : s.id}@cardigan.mx`,
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
