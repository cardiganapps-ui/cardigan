/* ── ICS generator tests ──
   Pure unit tests for the calendar feed body. Verifies the ICS shape
   stays compatible with what Google Calendar, Apple Calendar, and
   Outlook expect, and that the SUMMARY surfaces the full patient name
   so the therapist can read their own calendar at a glance. */

import { describe, it, expect } from "vitest";
import { generateICS, _internals } from "../_calendar.js";

describe("generateICS", () => {
  it("produces a syntactically-valid VCALENDAR envelope", () => {
    const ics = generateICS({ sessions: [], timezone: "America/Mexico_City" });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("PRODID:-//Cardigan//ES");
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics).toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain("TZID:America/Mexico_City");
    expect(ics).toContain("END:VTIMEZONE");
  });

  it("emits a VEVENT for each session with TZID-anchored times", () => {
    const ics = generateICS({
      sessions: [
        {
          id: "00000000-0000-0000-0000-000000000001",
          date: "8-Abr",
          time: "10:00",
          duration: 60,
          status: "scheduled",
          patient: "Ana López",
          initials: "AL",
          modality: "presencial",
        },
      ],
      timezone: "America/Mexico_City",
    });
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:00000000-0000-0000-0000-000000000001@cardigan.mx");
    expect(ics).toMatch(/DTSTART;TZID=America\/Mexico_City:\d{4}0408T100000/);
    expect(ics).toMatch(/DTEND;TZID=America\/Mexico_City:\d{4}0408T110000/);
    expect(ics).toContain("SUMMARY:Sesión - Ana López");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics).toContain("END:VEVENT");
  });

  // SUMMARY uses the full patient name. Anyone with the feed URL can
  // read it (including third-party calendar services), so the user-
  // facing copy where the URL is shown communicates that trade-off.
  it("includes the full patient name in SUMMARY", () => {
    const ics = generateICS({
      sessions: [
        {
          id: "s-1",
          date: "8-Abr",
          time: "10:00",
          duration: 60,
          status: "scheduled",
          initials: "AL",
          patient: "Ana López",
          modality: "presencial",
        },
      ],
    });
    expect(ics).toContain("SUMMARY:Sesión - Ana López");
  });

  it("falls back to initials when patient name is missing", () => {
    const ics = generateICS({
      sessions: [
        {
          id: "s-1", date: "8-Abr", time: "10:00", duration: 60,
          status: "scheduled", initials: "AL",
        },
      ],
    });
    expect(ics).toContain("SUMMARY:Sesión - AL");
  });

  it("marks cancelled sessions as STATUS:CANCELLED so clients render strikethroughs", () => {
    const ics = generateICS({
      sessions: [
        {
          id: "s-1", date: "8-Abr", time: "10:00", duration: 60,
          status: "cancelled", initials: "AL", cancel_reason: "Paciente avisó tarde",
        },
      ],
    });
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("Motivo: Paciente avisó tarde");
  });

  it("treats charged sessions as confirmed but notes the charge in the description", () => {
    const ics = generateICS({
      sessions: [
        { id: "s-1", date: "8-Abr", time: "10:00", duration: 60, status: "charged", initials: "AL" },
      ],
    });
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics).toContain("Cancelada con cargo.");
  });

  it("computes DTEND from duration even for sessions crossing the next day in some zones", () => {
    const ics = generateICS({
      sessions: [
        { id: "s-1", date: "8-Abr", time: "23:30", duration: 90, status: "scheduled", initials: "AL" },
      ],
    });
    // 23:30 + 90 min = 01:00 next day (April 9).
    expect(ics).toMatch(/DTSTART;TZID=America\/Mexico_City:\d{4}0408T233000/);
    expect(ics).toMatch(/DTEND;TZID=America\/Mexico_City:\d{4}0409T010000/);
  });

  it("escapes commas, semicolons, and newlines in description fields", () => {
    const ics = generateICS({
      sessions: [
        {
          id: "s-1", date: "8-Abr", time: "10:00", duration: 60,
          status: "cancelled", initials: "AL",
          cancel_reason: "No vino; reagendar, mañana",
        },
      ],
    });
    expect(ics).toContain("Motivo: No vino\\; reagendar\\, mañana");
  });

  it("skips sessions with malformed dates rather than crashing", () => {
    const ics = generateICS({
      sessions: [
        { id: "s-1", date: "garbage", time: "10:00", duration: 60, status: "scheduled", initials: "X" },
        { id: "s-2", date: "8-Abr", time: "10:00", duration: 60, status: "scheduled", initials: "Y" },
      ],
    });
    expect(ics).not.toContain("UID:s-1@");
    expect(ics).toContain("UID:s-2@");
  });
});

describe("ICS internals", () => {
  it("folds long lines at the 73-character mark per RFC 5545", () => {
    const long = "X".repeat(200);
    const folded = _internals.foldLine(long);
    // Each segment after a CRLF + space should be the size we asked for.
    const parts = folded.split("\r\n ");
    expect(parts[0].length).toBe(73);
    expect(parts.every((p, i) => i === parts.length - 1 || p.length === 73)).toBe(true);
  });

  it("escapes ICS metacharacters", () => {
    const e = _internals.escapeText;
    expect(e("a, b; c\nd")).toBe("a\\, b\\; c\\nd");
    expect(e("a\\b")).toBe("a\\\\b");
  });

  it("infers the year so dates near the rollover land in the right calendar year", () => {
    const dec1 = new Date(2026, 11, 1); // Dec 1, 2026
    // A Jan date seen from Dec is the next year.
    expect(_internals.inferYear(0, 5, dec1)).toBe(2027);
    // A same-year date is unchanged.
    expect(_internals.inferYear(11, 20, dec1)).toBe(2026);
  });
});
