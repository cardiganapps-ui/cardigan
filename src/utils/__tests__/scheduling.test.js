import { describe, it, expect } from "vitest";
import {
  SCHEDULING_MODE,
  defaultSchedulingMode,
  isEpisodic,
  PROFESSION,
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
