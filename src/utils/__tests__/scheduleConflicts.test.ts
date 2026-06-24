import { describe, it, expect } from "vitest";
import { detectScheduleConflicts } from "../scheduleConflicts";

const sched = (day: string, time: string) => ({ day, time });

describe("detectScheduleConflicts", () => {
  it("no conflicts on a clean grid", () => {
    const r = detectScheduleConflicts([sched("Lunes", "16:00")], [
      { status: "scheduled", day: "Martes", time: "10:00" },
    ]);
    expect(r.externalConflicts).toEqual([]);
    expect(r.internalConflictRows).toEqual([]);
  });

  it("flags an external collision with an existing SCHEDULED session", () => {
    const r = detectScheduleConflicts([sched("Lunes", "16:00")], [
      { status: "scheduled", day: "Lunes", time: "16:00", id: "s1" },
    ]);
    expect(r.externalConflicts).toHaveLength(1);
    expect(r.externalConflicts[0].row).toBe(0);
    expect(r.externalConflicts[0].match).toMatchObject({ id: "s1" });
  });

  it("ignores non-scheduled sessions (completed/cancelled don't block)", () => {
    const r = detectScheduleConflicts([sched("Lunes", "16:00")], [
      { status: "completed", day: "Lunes", time: "16:00" },
      { status: "cancelled", day: "Lunes", time: "16:00" },
    ]);
    expect(r.externalConflicts).toEqual([]);
  });

  it("flags BOTH rows of an internal day/time duplicate", () => {
    const r = detectScheduleConflicts(
      [sched("Lunes", "16:00"), sched("Martes", "10:00"), sched("Lunes", "16:00")],
      [],
    );
    // first occurrence (0) + the duplicate (2), not the unrelated row (1)
    expect(r.internalConflictRows.sort()).toEqual([0, 2]);
  });

  it("tolerates null sessions", () => {
    const r = detectScheduleConflicts([sched("Lunes", "16:00")], null);
    expect(r.externalConflicts).toEqual([]);
    expect(r.internalConflictRows).toEqual([]);
  });
});
