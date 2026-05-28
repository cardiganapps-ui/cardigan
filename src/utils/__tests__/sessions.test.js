import { describe, it, expect } from "vitest";
import {
  isTutorSession, tutorDisplayInitials, isCancelledStatus,
  statusClass, statusLabel, sessionDisplayLabel,
  derivePatientSchedules, deriveSlotProps,
} from "../sessions";
import { formatShortDate } from "../dates";

describe("isTutorSession", () => {
  it("recognises session_type === 'tutor' (post-migration 023)", () => {
    expect(isTutorSession({ session_type: "tutor", initials: "AB" })).toBe(true);
    expect(isTutorSession({ session_type: "regular", initials: "AB" })).toBe(false);
  });

  it("falls back to the legacy T· initials prefix for unmigrated rows", () => {
    expect(isTutorSession({ initials: "T·AB" })).toBe(true);
    expect(isTutorSession({ initials: "AB" })).toBe(false);
  });

  it("treats either signal as authoritative when both are present", () => {
    // Defensive: a row with column='tutor' but missing prefix still wins.
    expect(isTutorSession({ session_type: "tutor", initials: "AB" })).toBe(true);
    // Legacy prefix without column still works.
    expect(isTutorSession({ session_type: "regular", initials: "T·AB" })).toBe(true);
  });

  it("is falsy for null / missing inputs", () => {
    expect(isTutorSession({ initials: null })).toBeFalsy();
    expect(isTutorSession({})).toBeFalsy();
    expect(isTutorSession(null)).toBeFalsy();
  });
});

describe("tutorDisplayInitials", () => {
  it("returns post-migration initials unchanged (no prefix to strip)", () => {
    expect(tutorDisplayInitials({ session_type: "tutor", initials: "AB" })).toBe("AB");
  });

  it("strips a legacy T· prefix when present", () => {
    expect(tutorDisplayInitials({ initials: "T·AB" })).toBe("AB");
  });

  it("returns T for empty initials", () => {
    expect(tutorDisplayInitials({ initials: null })).toBe("T");
  });
});

describe("isCancelledStatus", () => {
  it("returns true for cancelled and charged", () => {
    expect(isCancelledStatus("cancelled")).toBe(true);
    expect(isCancelledStatus("charged")).toBe(true);
  });

  it("returns false for other statuses", () => {
    expect(isCancelledStatus("scheduled")).toBe(false);
    expect(isCancelledStatus("completed")).toBe(false);
  });
});

describe("statusClass", () => {
  it("returns correct CSS class for each status", () => {
    expect(statusClass("scheduled")).toBe("status-scheduled");
    expect(statusClass("completed")).toBe("status-completed");
    expect(statusClass("cancelled")).toBe("status-cancelled");
    expect(statusClass("charged")).toBe("status-charged");
  });
});

describe("statusLabel", () => {
  it("returns Spanish labels", () => {
    expect(statusLabel("scheduled")).toBe("Agendada");
    expect(statusLabel("completed")).toBe("Completada");
    expect(statusLabel("cancelled")).toBe("Cancelada");
    expect(statusLabel("charged")).toBe("Cancelada cobrada");
  });
});

describe("sessionDisplayLabel", () => {
  it("formats session for display", () => {
    const s = { date: "10-Abr", time: "16:00", status: "completed" };
    expect(sessionDisplayLabel(s)).toBe("10-Abr · 16:00 — Completada");
  });
});

// Helpers — generate "D-MMM" short-dates offset from today so tests
// don't go stale as the calendar moves.
function shortDateOffset(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return formatShortDate(d);
}
function makeSession(overrides = {}) {
  return {
    patient_id: "P1",
    day: "Lunes",
    time: "10:00",
    duration: 60,
    modality: "presencial",
    recurrence_frequency: "weekly",
    is_recurring: true,
    status: "scheduled",
    date: shortDateOffset(7),
    ...overrides,
  };
}

describe("derivePatientSchedules", () => {
  it("returns one row per (day, time) slot", () => {
    const sessions = [
      makeSession({ id: "a", date: shortDateOffset(7) }),
      makeSession({ id: "b", date: shortDateOffset(14) }),
      makeSession({ id: "c", date: shortDateOffset(21) }),
    ];
    const out = derivePatientSchedules(sessions, "P1");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ day: "Lunes", time: "10:00", duration: 60 });
  });

  it("picks the EARLIEST upcoming session per slot — the regression guard for the Resumen <-> Agenda mismatch", () => {
    // A stale older-created session (still future) with duration 60,
    // alongside a freshly-created later session with duration 90.
    // Iteration by created_at would have surfaced 60 in the summary
    // while the agenda showed 90 for the upcoming instance — exactly
    // the user-reported bug. Sorting by date ASC inside the helper
    // picks the soonest-upcoming row, matching what the user sees on
    // the next calendar tile.
    const sessions = [
      makeSession({ id: "stale-old", duration: 60, date: shortDateOffset(60) }),
      makeSession({ id: "fresh-soon", duration: 90, date: shortDateOffset(7) }),
    ];
    const out = derivePatientSchedules(sessions, "P1");
    expect(out).toHaveLength(1);
    expect(out[0].duration).toBe(90);
  });

  it("drops cancelled and charged rows", () => {
    const sessions = [
      makeSession({ id: "a", status: "cancelled", date: shortDateOffset(7) }),
      makeSession({ id: "b", status: "charged",   date: shortDateOffset(14) }),
      makeSession({ id: "c", date: shortDateOffset(21) }),
    ];
    const out = derivePatientSchedules(sessions, "P1");
    expect(out).toHaveLength(1);
    expect(out[0].time).toBe("10:00");
  });

  it("excludes is_recurring=false one-offs", () => {
    const sessions = [
      makeSession({ id: "a", is_recurring: false, date: shortDateOffset(7) }),
      makeSession({ id: "b", date: shortDateOffset(14) }),
    ];
    expect(derivePatientSchedules(sessions, "P1")).toHaveLength(1);
  });

  it("excludes past sessions when includePast is false (default)", () => {
    const sessions = [
      makeSession({ id: "past", date: shortDateOffset(-7) }),
      makeSession({ id: "future", date: shortDateOffset(7) }),
    ];
    expect(derivePatientSchedules(sessions, "P1")).toHaveLength(1);
  });

  it("includes past sessions when includePast=true (for ended patients)", () => {
    const sessions = [
      makeSession({ id: "past", date: shortDateOffset(-30), day: "Martes", time: "14:00" }),
      makeSession({ id: "future", date: shortDateOffset(7) }),
    ];
    expect(derivePatientSchedules(sessions, "P1", true)).toHaveLength(2);
  });

  it("filters by patientId", () => {
    const sessions = [
      makeSession({ patient_id: "P1", date: shortDateOffset(7) }),
      makeSession({ patient_id: "P2", date: shortDateOffset(7) }),
    ];
    const out = derivePatientSchedules(sessions, "P1");
    expect(out).toHaveLength(1);
  });

  it("sorts result Mon→Sun then time ascending", () => {
    const sessions = [
      makeSession({ day: "Viernes", time: "09:00", date: shortDateOffset(11) }),
      makeSession({ day: "Lunes",   time: "14:00", date: shortDateOffset(7) }),
      makeSession({ day: "Lunes",   time: "10:00", date: shortDateOffset(7) }),
    ];
    const out = derivePatientSchedules(sessions, "P1");
    expect(out.map(s => `${s.day} ${s.time}`)).toEqual([
      "Lunes 10:00", "Lunes 14:00", "Viernes 09:00",
    ]);
  });
});

describe("deriveSlotProps", () => {
  it("returns hard defaults for an empty session list", () => {
    expect(deriveSlotProps({ id: "P1", day: "Lunes", time: "10:00" }, [])).toEqual({
      duration: 60, modality: "presencial", frequency: "weekly",
    });
  });

  it("returns hard defaults when patient has no day/time (episodic)", () => {
    expect(deriveSlotProps({ id: "P1" }, [])).toEqual({
      duration: 60, modality: "presencial", frequency: "weekly",
    });
  });

  it("pulls duration/modality/frequency from the EARLIEST upcoming session in the slot", () => {
    // Mirrors the editor-seed contract: the form must display what the
    // patient actually has so a rate-only save can't silently rewrite
    // duration via the applyScheduleChange fallback.
    const patient = { id: "P1", day: "Lunes", time: "10:00" };
    const sessions = [
      makeSession({ duration: 90, modality: "videollamada", recurrence_frequency: "biweekly", date: shortDateOffset(7) }),
      makeSession({ duration: 60, modality: "presencial",  recurrence_frequency: "weekly",   date: shortDateOffset(21) }),
    ];
    expect(deriveSlotProps(patient, sessions)).toEqual({
      duration: 90, modality: "videollamada", frequency: "biweekly",
    });
  });

  it("ignores sessions for other slots even with matching patientId", () => {
    const patient = { id: "P1", day: "Lunes", time: "10:00" };
    const sessions = [
      makeSession({ day: "Martes", time: "14:00", duration: 30 }),
    ];
    expect(deriveSlotProps(patient, sessions)).toEqual({
      duration: 60, modality: "presencial", frequency: "weekly",
    });
  });

  it("falls back to any matching row when no future row exists", () => {
    const patient = { id: "P1", day: "Lunes", time: "10:00" };
    const sessions = [
      makeSession({ duration: 45, date: shortDateOffset(-30) }),
    ];
    expect(deriveSlotProps(patient, sessions).duration).toBe(45);
  });
});
