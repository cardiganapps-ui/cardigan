import { describe, it, expect } from "vitest";
import {
  evaluateTutorReminders,
  buildTutorPushPayload,
  resolveCycleAnchor,
  hasUpcomingTutorSession,
  shortDateToIsoNearTodayTz,
  daysBetweenIso,
  tzTodayIso,
} from "../_tutorReminders.js";

/* The evaluator is the only logic that decides who gets a tutor push.
   Tests stub the I/O (patient + session rows, alreadySent set, todayIso)
   and assert the returned (patient, kind, cycleAnchor) tuples — exactly
   the shape the cron sends to web-push. Covers the eligibility windows
   user committed to in design (only-on-due-day + single follow-up at
   day 7 overdue) and the per-cycle dedupe model. */

function eligiblePatient(overrides = {}) {
  return {
    id: "P-MINOR",
    name: "Lucía",
    parent: "Ana Pérez",
    tutor_frequency: 4, // weeks → due every 28 days
    status: "active",
    start_date: "2025-01-01",
    created_at: "2025-01-01T10:00:00Z",
    ...overrides,
  };
}

function tutorSession(overrides = {}) {
  return {
    patient_id: "P-MINOR",
    session_type: "tutor",
    initials: "T·AP",
    date: "1-Ene",
    status: "completed",
    ...overrides,
  };
}

describe("evaluateTutorReminders — eligibility", () => {
  it("skips patients without a parent (adults)", () => {
    const out = evaluateTutorReminders({
      patients: [eligiblePatient({ parent: "" })],
      tutorSessions: [],
      alreadySent: new Set(),
      todayIso: "2025-01-29",
    });
    expect(out).toHaveLength(0);
  });

  it("skips patients without tutor_frequency", () => {
    const out = evaluateTutorReminders({
      patients: [eligiblePatient({ tutor_frequency: null })],
      tutorSessions: [],
      alreadySent: new Set(),
      todayIso: "2025-01-29",
    });
    expect(out).toHaveLength(0);
  });

  it("skips inactive patients (ended / potential)", () => {
    const out = evaluateTutorReminders({
      patients: [eligiblePatient({ status: "ended" })],
      tutorSessions: [],
      alreadySent: new Set(),
      todayIso: "2025-01-29",
    });
    expect(out).toHaveLength(0);
  });

  it("skips when the therapist already has a scheduled future tutor session", () => {
    // Day-28 with no upcoming would normally fire tutor_due, but the
    // scheduled row on 2025-02-05 means the therapist already acted —
    // we must stop nudging them for this cycle.
    const out = evaluateTutorReminders({
      patients: [eligiblePatient()],
      tutorSessions: [
        tutorSession({ date: "1-Ene", status: "completed" }),
        tutorSession({ date: "5-Feb", status: "scheduled" }),
      ],
      alreadySent: new Set(),
      todayIso: "2025-01-29",
    });
    expect(out).toHaveLength(0);
  });
});

describe("evaluateTutorReminders — tutor_due window", () => {
  it("fires on the exact due day (daysUntilDue === 0)", () => {
    const out = evaluateTutorReminders({
      patients: [eligiblePatient()],
      tutorSessions: [tutorSession({ date: "1-Ene", status: "completed" })],
      alreadySent: new Set(),
      todayIso: "2025-01-29", // 28 days after Jan 1 → daysUntilDue = 0
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "tutor_due",
      cycleAnchor: "2025-01-01",
    });
  });

  it("fires within the ±1 day catch-up window (covers a missed cron tick)", () => {
    // daysUntilDue = -1 (one day late)
    const lateOne = evaluateTutorReminders({
      patients: [eligiblePatient()],
      tutorSessions: [tutorSession({ date: "1-Ene", status: "completed" })],
      alreadySent: new Set(),
      todayIso: "2025-01-30",
    });
    expect(lateOne.some(r => r.kind === "tutor_due")).toBe(true);

    // daysUntilDue = +1 (one day early — covers cron firing late evening)
    const earlyOne = evaluateTutorReminders({
      patients: [eligiblePatient()],
      tutorSessions: [tutorSession({ date: "1-Ene", status: "completed" })],
      alreadySent: new Set(),
      todayIso: "2025-01-28",
    });
    expect(earlyOne.some(r => r.kind === "tutor_due")).toBe(true);
  });

  it("does NOT fire 7 days before due (no early heads-up — user direction)", () => {
    const out = evaluateTutorReminders({
      patients: [eligiblePatient()],
      tutorSessions: [tutorSession({ date: "1-Ene", status: "completed" })],
      alreadySent: new Set(),
      todayIso: "2025-01-22", // 21 days after → daysUntilDue = 7
    });
    expect(out).toHaveLength(0);
  });

  it("dedupes against an existing sent row for the same cycle", () => {
    const out = evaluateTutorReminders({
      patients: [eligiblePatient()],
      tutorSessions: [tutorSession({ date: "1-Ene", status: "completed" })],
      alreadySent: new Set(["P-MINOR::tutor_due::2025-01-01"]),
      todayIso: "2025-01-29",
    });
    expect(out).toHaveLength(0);
  });

  it("re-fires for a new cycle when a fresh tutor session has been completed", () => {
    // Therapist did a tutor session on Feb 1; next due Mar 1.
    // The Jan 1 dedupe row must NOT block the new cycle.
    const out = evaluateTutorReminders({
      patients: [eligiblePatient()],
      tutorSessions: [
        tutorSession({ date: "1-Ene", status: "completed" }),
        tutorSession({ date: "1-Feb", status: "completed" }),
      ],
      alreadySent: new Set(["P-MINOR::tutor_due::2025-01-01"]),
      todayIso: "2025-03-01",
    });
    expect(out).toHaveLength(1);
    expect(out[0].cycleAnchor).toBe("2025-02-01");
  });
});

describe("evaluateTutorReminders — tutor_overdue_7 window", () => {
  it("fires at day 7 overdue (single follow-up per user direction)", () => {
    const out = evaluateTutorReminders({
      patients: [eligiblePatient()],
      tutorSessions: [tutorSession({ date: "1-Ene", status: "completed" })],
      alreadySent: new Set(),
      todayIso: "2025-02-05", // 35 days after → daysUntilDue = -7
    });
    expect(out.some(r => r.kind === "tutor_overdue_7")).toBe(true);
  });

  it("does NOT re-fire at day 14, 21, 28… (no recurring nag per user direction)", () => {
    const day14 = evaluateTutorReminders({
      patients: [eligiblePatient()],
      tutorSessions: [tutorSession({ date: "1-Ene", status: "completed" })],
      alreadySent: new Set(["P-MINOR::tutor_overdue_7::2025-01-01"]),
      todayIso: "2025-02-12", // 42 days after → daysUntilDue = -14
    });
    expect(day14).toHaveLength(0);

    const day28 = evaluateTutorReminders({
      patients: [eligiblePatient()],
      tutorSessions: [tutorSession({ date: "1-Ene", status: "completed" })],
      alreadySent: new Set(["P-MINOR::tutor_overdue_7::2025-01-01"]),
      todayIso: "2025-02-26",
    });
    expect(day28).toHaveLength(0);
  });
});

describe("evaluateTutorReminders — anchor resolution", () => {
  it("uses start_date as the anchor when no tutor session has ever happened", () => {
    const out = evaluateTutorReminders({
      patients: [eligiblePatient({ start_date: "2025-01-01" })],
      tutorSessions: [],
      alreadySent: new Set(),
      todayIso: "2025-01-29",
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "tutor_due",
      cycleAnchor: "2025-01-01",
    });
  });

  it("falls back to created_at when start_date is missing", () => {
    const anchor = resolveCycleAnchor(
      eligiblePatient({ start_date: null, created_at: "2025-01-01T10:00:00Z" }),
      [],
      "2025-01-29",
    );
    expect(anchor).toBe("2025-01-01");
  });

  it("ignores future-dated 'completed' rows (data noise)", () => {
    // A row that says "completed" but with a future date is corrupt;
    // it shouldn't anchor the cycle forward in time.
    const anchor = resolveCycleAnchor(
      eligiblePatient(),
      [tutorSession({ date: "1-Feb", status: "completed" })],
      "2025-01-15",
    );
    // Future-dated row ignored → falls back to start_date.
    expect(anchor).toBe("2025-01-01");
  });

  it("recognises tutor sessions via the legacy T· initials prefix (unmigrated rows)", () => {
    // Pre-migration-023 rows lacked session_type. The cron's
    // `OR session_type.eq.tutor,initials.like.T·%` postgrest filter
    // still includes them; the evaluator must accept whichever sentinel
    // arrives. Note: evaluator does NOT re-check the tutor-ness; that
    // gate is in the query. This test is a smoke for "any row in the
    // tutorSessions arg participates" — the cron is responsible for
    // not handing us non-tutor rows.
    const anchor = resolveCycleAnchor(
      eligiblePatient(),
      [{ patient_id: "P-MINOR", date: "10-Ene", status: "completed", initials: "T·AP" }],
      "2025-01-29",
    );
    expect(anchor).toBe("2025-01-10");
  });
});

describe("hasUpcomingTutorSession", () => {
  it("returns true when a scheduled tutor row is today or later", () => {
    expect(hasUpcomingTutorSession(
      eligiblePatient(),
      [tutorSession({ date: "5-Feb", status: "scheduled" })],
      "2025-02-01",
    )).toBe(true);
  });
  it("returns false when the only scheduled row is in the past", () => {
    // Past-dated scheduled rows display as completed but the row stays
    // scheduled (CLAUDE.md prime directive). They must NOT count as
    // 'upcoming' here or a patient who missed a session would never get
    // a follow-up reminder.
    expect(hasUpcomingTutorSession(
      eligiblePatient(),
      [tutorSession({ date: "1-Ene", status: "scheduled" })],
      "2025-02-01",
    )).toBe(false);
  });
});

describe("shortDateToIsoNearTodayTz — year disambiguation", () => {
  it("rolls 'Dic' from the previous year when today is January", () => {
    // "28-Dic" parsed today=2025-01-03 should resolve to 2024-12-28,
    // not 2025-12-28 (which would be wildly future-dated).
    expect(shortDateToIsoNearTodayTz("28-Dic", "2025-01-03")).toBe("2024-12-28");
  });
  it("stays in the current year for in-bounds short-dates", () => {
    expect(shortDateToIsoNearTodayTz("15-Mar", "2025-03-20")).toBe("2025-03-15");
  });
  it("accepts the legacy space-separated form", () => {
    expect(shortDateToIsoNearTodayTz("15 Mar", "2025-03-20")).toBe("2025-03-15");
  });
});

describe("daysBetweenIso", () => {
  it("computes the day difference across calendar months", () => {
    expect(daysBetweenIso("2025-01-29", "2025-02-05")).toBe(7);
  });
  it("is negative when b precedes a", () => {
    expect(daysBetweenIso("2025-02-05", "2025-01-29")).toBe(-7);
  });
});

describe("tzTodayIso", () => {
  it("returns an ISO date for a valid IANA zone", () => {
    const iso = tzTodayIso("America/Mexico_City", new Date("2025-01-15T12:00:00Z"));
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("falls back to MX default when zone is missing", () => {
    const iso = tzTodayIso("", new Date("2025-01-15T12:00:00Z"));
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("buildTutorPushPayload", () => {
  it("emits a 'sesión con tutor pendiente' payload for tutor_due", () => {
    const payload = buildTutorPushPayload({
      patient: { id: "P1", name: "Lucía" },
      kind: "tutor_due",
    });
    expect(payload.title).toMatch(/pendiente/i);
    expect(payload.body).toContain("Lucía");
    expect(payload.url).toContain("P1");
    expect(payload.tag).toBe("tutor-due-P1");
  });

  it("emits a 'sesión con tutor atrasada' payload for tutor_overdue_7", () => {
    const payload = buildTutorPushPayload({
      patient: { id: "P1", name: "Lucía" },
      kind: "tutor_overdue_7",
    });
    expect(payload.title).toMatch(/atrasada/i);
    expect(payload.body).toContain("7 días");
    expect(payload.tag).toBe("tutor-overdue-P1");
  });
});
