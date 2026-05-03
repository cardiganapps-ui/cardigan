import { describe, it, expect } from "vitest";
import {
  SCHEDULING_MODE,
  defaultSchedulingMode,
  isEpisodic,
  PROFESSION,
  VISIT_TYPE,
  VISIT_TYPES,
  usesVisitTypes,
} from "../../data/constants";

describe("defaultSchedulingMode", () => {
  it("returns episodic for nutritionists (their actual workflow)", () => {
    expect(defaultSchedulingMode(PROFESSION.NUTRITIONIST))
      .toBe(SCHEDULING_MODE.EPISODIC);
  });

  it("returns recurring for psychologists, tutors, music teachers, trainers", () => {
    expect(defaultSchedulingMode(PROFESSION.PSYCHOLOGIST)).toBe(SCHEDULING_MODE.RECURRING);
    expect(defaultSchedulingMode(PROFESSION.TUTOR)).toBe(SCHEDULING_MODE.RECURRING);
    expect(defaultSchedulingMode(PROFESSION.MUSIC_TEACHER)).toBe(SCHEDULING_MODE.RECURRING);
    expect(defaultSchedulingMode(PROFESSION.TRAINER)).toBe(SCHEDULING_MODE.RECURRING);
  });

  it("falls back to recurring for unknown / undefined professions", () => {
    expect(defaultSchedulingMode(undefined)).toBe(SCHEDULING_MODE.RECURRING);
    expect(defaultSchedulingMode("not-a-profession")).toBe(SCHEDULING_MODE.RECURRING);
  });
});

describe("isEpisodic", () => {
  it("returns true when scheduling_mode is 'episodic'", () => {
    expect(isEpisodic({ scheduling_mode: "episodic" })).toBe(true);
  });

  it("returns false for any other value", () => {
    expect(isEpisodic({ scheduling_mode: "recurring" })).toBe(false);
    expect(isEpisodic({ scheduling_mode: undefined })).toBe(false);
    expect(isEpisodic({})).toBe(false);
    expect(isEpisodic(null)).toBe(false);
    expect(isEpisodic(undefined)).toBe(false);
  });
});

describe("VISIT_TYPE enum", () => {
  it("matches the migration 041 CHECK constraint values", () => {
    // Lock the enum surface so accidental renames break a test before
    // they break a deployed CHECK constraint.
    expect(VISIT_TYPE.INTAKE).toBe("intake");
    expect(VISIT_TYPE.FOLLOWUP).toBe("followup");
    expect(VISIT_TYPE.MAINTENANCE).toBe("maintenance");
  });

  it("VISIT_TYPES lists the canonical order", () => {
    expect(VISIT_TYPES).toEqual(["intake", "followup", "maintenance"]);
  });
});

describe("usesVisitTypes", () => {
  it("returns true for nutritionists + trainers (intake/followup model fits)", () => {
    expect(usesVisitTypes(PROFESSION.NUTRITIONIST)).toBe(true);
    expect(usesVisitTypes(PROFESSION.TRAINER)).toBe(true);
  });

  it("returns false for psychologists, tutors, music teachers", () => {
    expect(usesVisitTypes(PROFESSION.PSYCHOLOGIST)).toBe(false);
    expect(usesVisitTypes(PROFESSION.TUTOR)).toBe(false);
    expect(usesVisitTypes(PROFESSION.MUSIC_TEACHER)).toBe(false);
  });

  it("returns false for unknown / undefined professions", () => {
    expect(usesVisitTypes(undefined)).toBe(false);
    expect(usesVisitTypes("not-a-profession")).toBe(false);
  });
});
