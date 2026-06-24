import { describe, it, expect } from "vitest";
import { findEmptySlot, SLOT_SEARCH_DAYS, SLOT_SEARCH_TIMES, DEFAULT_SLOT } from "../scheduleSlots";

const sess = (day: string, time: string, status = "scheduled") => ({ day, time, status });

describe("findEmptySlot", () => {
  it("returns the very first grid slot (Lunes 09:00) when nothing is booked", () => {
    expect(findEmptySlot([], [])).toEqual({ day: "Lunes", time: "09:00" });
    expect(findEmptySlot(undefined)).toEqual({ day: "Lunes", time: "09:00" });
  });

  it("skips slots taken by scheduled sessions", () => {
    // Lunes 09:00 + 10:00 taken → next free is Lunes 11:00 (3rd time in grid).
    expect(findEmptySlot([sess("Lunes", "09:00"), sess("Lunes", "10:00")]))
      .toEqual({ day: "Lunes", time: "11:00" });
  });

  it("ignores non-scheduled sessions (cancelled/completed slots are free)", () => {
    expect(findEmptySlot([sess("Lunes", "09:00", "cancelled"), sess("Lunes", "09:00", "completed")]))
      .toEqual({ day: "Lunes", time: "09:00" });
  });

  it("honours extra slots already claimed elsewhere in the form", () => {
    expect(findEmptySlot([], ["Lunes|09:00"])).toEqual({ day: "Lunes", time: "10:00" });
  });

  it("falls back to DEFAULT_SLOT when the whole grid is taken", () => {
    const all = SLOT_SEARCH_DAYS.flatMap(day => SLOT_SEARCH_TIMES.map(time => sess(day, time)));
    expect(findEmptySlot(all)).toEqual(DEFAULT_SLOT);
  });
});
