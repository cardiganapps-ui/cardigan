import { describe, it, expect } from "vitest";
import {
  isTutorSession, tutorDisplayInitials, isCancelledStatus,
  statusClass, statusLabel, sessionDisplayLabel,
} from "../sessions";

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
