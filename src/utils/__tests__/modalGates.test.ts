import { describe, it, expect } from "vitest";
import {
  shouldShowTrialReminder,
  shouldPromptPasskey,
  todayDateKey,
  PASSKEY_PROMPT_MAX_ASKS,
  PASSKEY_PROMPT_COOLDOWN_MS,
  PLAN_SHEET_GRACE_MS,
} from "../modalGates";

const NOW = Date.UTC(2026, 5, 22, 12, 0, 0); // fixed reference

function trialBase(over = {}) {
  return {
    demo: false,
    viewingAsUser: false,
    hasUser: true,
    accessState: "trial",
    daysLeft: 7,
    planSheetSeenAt: null,
    lastShownDateKey: null,
    todayKey: "2026-06-22",
    now: NOW,
    ...over,
  };
}

describe("shouldShowTrialReminder", () => {
  it("shows at a threshold day for a trial user not shown today", () => {
    expect(shouldShowTrialReminder(trialBase())).toBe(true);
    expect(shouldShowTrialReminder(trialBase({ daysLeft: 15 }))).toBe(true);
    expect(shouldShowTrialReminder(trialBase({ daysLeft: 1 }))).toBe(true);
  });

  it("does not show on a non-threshold day", () => {
    expect(shouldShowTrialReminder(trialBase({ daysLeft: 8 }))).toBe(false);
    expect(shouldShowTrialReminder(trialBase({ daysLeft: 0 }))).toBe(false);
  });

  it("does not show outside the trial state", () => {
    expect(shouldShowTrialReminder(trialBase({ accessState: "active" }))).toBe(false);
    expect(shouldShowTrialReminder(trialBase({ accessState: "expired" }))).toBe(false);
  });

  it("suppresses in demo / view-as / no-user", () => {
    expect(shouldShowTrialReminder(trialBase({ demo: true }))).toBe(false);
    expect(shouldShowTrialReminder(trialBase({ viewingAsUser: true }))).toBe(false);
    expect(shouldShowTrialReminder(trialBase({ hasUser: false }))).toBe(false);
  });

  it("respects the plan-sheet grace window", () => {
    // Opened the plan sheet 1 hour ago → within the 3-day grace → suppress.
    expect(shouldShowTrialReminder(trialBase({ planSheetSeenAt: NOW - 60 * 60 * 1000 }))).toBe(false);
    // Opened it just outside the grace window → show again.
    expect(shouldShowTrialReminder(trialBase({ planSheetSeenAt: NOW - PLAN_SHEET_GRACE_MS - 1 }))).toBe(true);
  });

  it("does not re-show on the same calendar day", () => {
    expect(shouldShowTrialReminder(trialBase({ lastShownDateKey: "2026-06-22" }))).toBe(false);
    // A different day's stamp does not suppress today.
    expect(shouldShowTrialReminder(trialBase({ lastShownDateKey: "2026-06-21" }))).toBe(true);
  });

  it("ignores a non-numeric daysLeft", () => {
    expect(shouldShowTrialReminder(trialBase({ daysLeft: null }))).toBe(false);
    expect(shouldShowTrialReminder(trialBase({ daysLeft: undefined }))).toBe(false);
  });
});

describe("shouldPromptPasskey", () => {
  it("prompts a fresh user (no prior state)", () => {
    expect(shouldPromptPasskey(null, { now: NOW })).toBe(true);
    expect(shouldPromptPasskey({ n: 0, t: 0 }, { now: NOW })).toBe(true);
  });

  it("never prompts an already-enrolled user", () => {
    expect(shouldPromptPasskey({ enrolled: true, n: 0, t: 0 }, { now: NOW })).toBe(false);
  });

  it("stops after the max number of asks", () => {
    expect(shouldPromptPasskey({ n: PASSKEY_PROMPT_MAX_ASKS, t: 0 }, { now: NOW })).toBe(false);
  });

  it("respects the cooldown between asks", () => {
    // Shown once, 1 day ago → still within the 1-week cooldown → no.
    expect(shouldPromptPasskey({ n: 1, t: NOW - 24 * 60 * 60 * 1000 }, { now: NOW })).toBe(false);
    // Shown once, 8 days ago → past cooldown → yes.
    expect(shouldPromptPasskey({ n: 1, t: NOW - PASSKEY_PROMPT_COOLDOWN_MS - 1 }, { now: NOW })).toBe(true);
  });
});

describe("todayDateKey", () => {
  it("formats a local YYYY-MM-DD key", () => {
    expect(todayDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(todayDateKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});
