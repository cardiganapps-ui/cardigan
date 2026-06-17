import { describe, it, expect } from "vitest";
import { computeGroupSessionRows, computeGroupAutoExtendRows, resolveGroupRate } from "../groupRecurrence";
import { toISODate, formatShortDate, parseShortDate } from "../dates";
import { GROUP_STATUS, SCHEDULING_MODE, SESSION_STATUS, RECURRENCE_EXTEND_THRESHOLD_DAYS, RECURRENCE_WINDOW_WEEKS } from "../../data/constants";

// These pin the prime-directive surface for group fan-out: a flat rate on
// every member row, never a past-dated row, active-members-only, and the
// same threshold/clamp rules as the per-patient auto-extend.

const DAY_MS = 86400000;

function ctx(today) {
  const t = new Date(today); t.setHours(0, 0, 0, 0);
  const threshold = new Date(t); threshold.setDate(t.getDate() + RECURRENCE_EXTEND_THRESHOLD_DAYS);
  const extendEnd = toISODate(new Date(t.getTime() + RECURRENCE_WINDOW_WEEKS * 7 * DAY_MS));
  return { today: t, threshold, extendEnd, userId: "u1" };
}

function group(overrides = {}) {
  return {
    id: "g1", day: "Lunes", time: "17:00", duration: 60, rate: 500,
    modality: "presencial", recurrence_frequency: "weekly",
    scheduling_mode: SCHEDULING_MODE.RECURRING, status: GROUP_STATUS.ACTIVE,
    color_idx: 2, ...overrides,
  };
}

const patientsById = new Map([
  ["pa", { id: "pa", name: "Ana", initials: "AN", rate: 999 }],
  ["pb", { id: "pb", name: "Beto", initials: "BE", rate: 111 }],
  ["pc", { id: "pc", name: "Caro", initials: "CA", rate: 222 }],
]);

const members = (ids, leftIds = []) =>
  ids.map(id => ({ id: `m-${id}`, group_id: "g1", patient_id: id, left_at: leftIds.includes(id) ? "2020-01-01" : null }));

describe("resolveGroupRate", () => {
  it("uses the flat group rate for every member", () => {
    expect(resolveGroupRate(group({ rate: 500 }), patientsById.get("pa"))).toBe(500);
  });
  it("falls back to patient rate when the group rate is null", () => {
    expect(resolveGroupRate(group({ rate: null }), patientsById.get("pb"))).toBe(111);
  });
});

describe("computeGroupSessionRows", () => {
  it("emits one row per (active member, occurrence) at the flat group rate", () => {
    const startISO = "2026-06-01"; // a Monday-containing window
    const endISO = "2026-06-22";
    const rows = computeGroupSessionRows({
      group: group(), members: members(["pa", "pb"]), patientsById,
      startISO, endISO, existingSlots: new Set(), userId: "u1",
    });
    // 4 Mondays (Jun 1, 8, 15, 22) × 2 members = 8 rows
    expect(rows.length).toBe(8);
    expect(rows.every(r => r.rate === 500)).toBe(true);
    expect(rows.every(r => r.group_id === "g1")).toBe(true);
    expect(rows.every(r => r.is_recurring === true)).toBe(true);
    expect(new Set(rows.map(r => r.patient_id))).toEqual(new Set(["pa", "pb"]));
  });

  it("excludes members who have left", () => {
    const rows = computeGroupSessionRows({
      group: group(), members: members(["pa", "pb"], ["pb"]), patientsById,
      startISO: "2026-06-01", endISO: "2026-06-08", existingSlots: new Set(), userId: "u1",
    });
    expect(new Set(rows.map(r => r.patient_id))).toEqual(new Set(["pa"]));
  });

  it("dedups against existing slots (patient|date|time)", () => {
    const existing = new Set(["pa|1-Jun|17:00"]);
    const rows = computeGroupSessionRows({
      group: group(), members: members(["pa"]), patientsById,
      startISO: "2026-06-01", endISO: "2026-06-08", existingSlots: existing, userId: "u1",
    });
    // Jun 1 deduped, Jun 8 remains
    expect(rows.map(r => r.date)).toEqual(["8-Jun"]);
  });

  it("restricts to onlyPatientIds when backfilling a new member", () => {
    const rows = computeGroupSessionRows({
      group: group(), members: members(["pa", "pb"]), patientsById,
      startISO: "2026-06-01", endISO: "2026-06-08", existingSlots: new Set(),
      userId: "u1", onlyPatientIds: new Set(["pb"]),
    });
    expect(new Set(rows.map(r => r.patient_id))).toEqual(new Set(["pb"]));
  });

  it("one-off window (startISO === endISO on the slot weekday) yields exactly one row per active member", () => {
    // 2026-06-01 is a Monday; group.day is Lunes.
    const rows = computeGroupSessionRows({
      group: group({ scheduling_mode: SCHEDULING_MODE.EPISODIC }),
      members: members(["pa", "pb"]), patientsById,
      startISO: "2026-06-01", endISO: "2026-06-01", existingSlots: new Set(), userId: "u1",
    });
    expect(rows.length).toBe(2);
    expect(rows.every(r => r.date === "1-Jun")).toBe(true);
    expect(new Set(rows.map(r => r.patient_id))).toEqual(new Set(["pa", "pb"]));
  });

  it("returns nothing when the group has no day/time (episodic/unscheduled)", () => {
    const rows = computeGroupSessionRows({
      group: group({ day: null, time: null }), members: members(["pa"]), patientsById,
      startISO: "2026-06-01", endISO: "2026-06-08", existingSlots: new Set(), userId: "u1",
    });
    expect(rows).toEqual([]);
  });
});

describe("computeGroupAutoExtendRows", () => {
  function groupSession(daysFromToday, today, overrides = {}) {
    const d = new Date(today.getTime() + daysFromToday * DAY_MS);
    return {
      id: `gs-${daysFromToday}`, group_id: "g1", patient_id: "pa",
      date: formatShortDate(d), time: "17:00", status: SESSION_STATUS.SCHEDULED,
      rate: 500, ...overrides,
    };
  }

  it("extends only when the latest future occurrence is within the threshold", () => {
    const today = new Date("2026-06-15"); const c = ctx(today);
    // Latest scheduled occurrence is ~5 days out → well within threshold.
    const groupSessions = [groupSession(-7, c.today), groupSession(5, c.today)];
    const rows = computeGroupAutoExtendRows({
      group: group({ day: formatDay(new Date(c.today.getTime() + 5 * DAY_MS)) }),
      members: members(["pa"]), patientsById, groupSessions, ...c,
    });
    expect(rows.length).toBeGreaterThan(0);
    // every generated row is in the future
    expect(rows.every(r => toISODate(parseShortDate(r.date)) >= toISODate(c.today))).toBe(true);
  });

  it("does not extend when the schedule runs comfortably past the threshold", () => {
    const today = new Date("2026-06-15"); const c = ctx(today);
    const farOut = groupSession(RECURRENCE_EXTEND_THRESHOLD_DAYS + 14, c.today);
    const rows = computeGroupAutoExtendRows({
      group: group(), members: members(["pa"]), patientsById,
      groupSessions: [farOut], ...c,
    });
    expect(rows).toEqual([]);
  });

  it("never back-fills past dates (phantom prevention)", () => {
    const today = new Date("2026-06-15"); const c = ctx(today);
    // Only past scheduled rows exist → no future anchor → no extend.
    const rows = computeGroupAutoExtendRows({
      group: group(), members: members(["pa"]), patientsById,
      groupSessions: [groupSession(-30, c.today), groupSession(-7, c.today)], ...c,
    });
    expect(rows).toEqual([]);
  });

  it("skips ended and episodic groups", () => {
    const today = new Date("2026-06-15"); const c = ctx(today);
    const gs = [groupSession(3, c.today)];
    expect(computeGroupAutoExtendRows({ group: group({ status: GROUP_STATUS.ENDED }), members: members(["pa"]), patientsById, groupSessions: gs, ...c })).toEqual([]);
    expect(computeGroupAutoExtendRows({ group: group({ scheduling_mode: SCHEDULING_MODE.EPISODIC }), members: members(["pa"]), patientsById, groupSessions: gs, ...c })).toEqual([]);
  });

  it("returns nothing when there are no active members", () => {
    const today = new Date("2026-06-15"); const c = ctx(today);
    const rows = computeGroupAutoExtendRows({
      group: group(), members: members(["pa"], ["pa"]), patientsById,
      groupSessions: [groupSession(3, c.today)], ...c,
    });
    expect(rows).toEqual([]);
  });
});

// Spanish weekday name for a Date (matches getRecurringDates' DAY_TO_JS).
function formatDay(d) {
  return ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"][d.getDay()];
}
