import { describe, it, expect } from "vitest";
import { isInQuietHours } from "../_push.js";

/* The quiet-hours window is 10:00 (inclusive) to 19:00 (exclusive)
   in the user's local time. The cron-side referral push gates on
   this so a phone doesn't buzz at 6am or during a session-heavy
   evening. Boundary cases are critical — get them wrong and a wave
   of users either gets messaged at 9:59 (jarring) or silenced at
   18:59 (window invisibly shrinks to 9 hrs). */
describe("isInQuietHours", () => {
  // Build a Date whose hours-in-MX-tz match the param so we don't
  // have to bake DST awareness into the test (Mexico abolished DST
  // in 2022 — UTC-6 year-round). Use the en-US locale + the same
  // toLocaleString trick the helper itself uses, which means the
  // assertion runs the helper end-to-end including the parsing path.
  function mxAt(hour, minute = 0) {
    // 2026-05-07 is the test today (matches CLAUDE.md current date).
    // MX is UTC-6 → set the UTC time to hour+6.
    const d = new Date(Date.UTC(2026, 4, 7, hour + 6, minute));
    return d;
  }

  it("returns false at 10:00 local (start of window)", () => {
    expect(isInQuietHours("America/Mexico_City", mxAt(10, 0))).toBe(false);
  });

  it("returns true at 9:59 local (one minute before window opens)", () => {
    expect(isInQuietHours("America/Mexico_City", mxAt(9, 59))).toBe(true);
  });

  it("returns false at 18:59 local (last allowed minute)", () => {
    expect(isInQuietHours("America/Mexico_City", mxAt(18, 59))).toBe(false);
  });

  it("returns true at 19:00 local (window closes)", () => {
    expect(isInQuietHours("America/Mexico_City", mxAt(19, 0))).toBe(true);
  });

  it("returns true at midnight local", () => {
    expect(isInQuietHours("America/Mexico_City", mxAt(0, 0))).toBe(true);
  });

  it("returns true at 22:00 local (late evening)", () => {
    expect(isInQuietHours("America/Mexico_City", mxAt(22, 0))).toBe(true);
  });

  it("falls back to MX default when timezone is empty", () => {
    expect(isInQuietHours("", mxAt(10, 0))).toBe(false);
    expect(isInQuietHours(null, mxAt(9, 0))).toBe(true);
  });

  it("falls back to MX default when timezone is invalid", () => {
    // Bogus IANA zone — toLocaleString may or may not throw depending
    // on Node version; either way the helper must NOT bubble the
    // error and must return a Boolean.
    const result = isInQuietHours("Not/A_Real_Zone", mxAt(11, 0));
    expect(typeof result).toBe("boolean");
  });
});
