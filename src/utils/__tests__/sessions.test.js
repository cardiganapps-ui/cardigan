import { describe, it, expect } from "vitest";
import {
  isTutorSession, tutorDisplayInitials, isCancelledStatus,
  statusClass, statusLabel, sessionDisplayLabel,
} from "../sessions";

describe("isTutorSession", () => {
  it("detects tutor sessions by T· prefix", () => {
    expect(isTutorSession({ initials: "T·AB" })).toBe(true);
    expect(isTutorSession({ initials: "AB" })).toBe(false);
    expect(isTutorSession({ initials: null })).toBeFalsy();
  });
});

describe("tutorDisplayInitials", () => {
  it("strips T· prefix", () => {
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
    expect(statusClass("charged")).toBe("status-cancelled");
  });
});

describe("statusLabel", () => {
  it("returns Spanish labels", () => {
    expect(statusLabel("scheduled")).toBe("Agendada");
    expect(statusLabel("completed")).toBe("Completada");
    expect(statusLabel("cancelled")).toBe("Cancelada");
    expect(statusLabel("charged")).toBe("Cancelada");
  });
});

describe("sessionDisplayLabel", () => {
  it("formats session for display", () => {
    const s = { date: "10 Abr", time: "16:00", status: "completed" };
    expect(sessionDisplayLabel(s)).toBe("10 Abr · 16:00 — Completada");
  });
});
