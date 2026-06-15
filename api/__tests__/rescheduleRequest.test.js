/* ── Reschedule date-helper tests ──
   isoSlotToMs is the year-safe replacement for the old
   shortToTimestampMs(isoToShort(iso)) round-trip in the proposed-slot
   validation of patient-reschedule-session. The round-trip dropped the
   year and re-inferred it within ±180 days of now, so a date >180 days
   out that crossed the calendar-year boundary folded back into the
   current year (→ "past") and the endpoint returned 403 past_target
   instead of 400 too_far. These tests pin the year-safe behavior and
   prove the two helpers still agree inside the 180-day window (no
   behavior change for the common case). */

import { describe, it, expect } from "vitest";
import { isoSlotToMs, shortToTimestampMs, isoToShort } from "../_rescheduleRequest.js";

const DAY = 86_400_000;

function isoForOffset(days) {
  const d = new Date(Date.now() + days * DAY);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

describe("isoSlotToMs", () => {
  it("keeps the caller's year — a 200-day-out date is always > 180 days future", () => {
    // 200 days out is unconditionally past the 180-day horizon, no matter
    // the run date or whether it crosses into next year. The old
    // round-trip could report this as a PAST timestamp (the bug); the
    // year-bearing helper must report the true far-future ms so the
    // handler answers 400 too_far, never 403 past_target.
    const ms = isoSlotToMs(isoForOffset(200), "10:00");
    expect(ms).toBeGreaterThan(Date.now() + 180 * DAY);
  });

  it("reports a past ms for a past date (→ 403 past_target upstream)", () => {
    expect(isoSlotToMs(isoForOffset(-2), "10:00")).toBeLessThan(Date.now());
  });

  it("agrees with shortToTimestampMs inside the 180-day window (no common-case drift)", () => {
    const iso = isoForOffset(30);
    const short = isoToShort(iso);
    expect(isoSlotToMs(iso, "09:30")).toBe(shortToTimestampMs(short, "09:30"));
  });

  it("anchors hour/minute from the time arg; defaults to midnight when absent", () => {
    const iso = isoForOffset(10);
    const withTime = isoSlotToMs(iso, "14:45");
    const midnight = isoSlotToMs(iso, undefined);
    expect(withTime - midnight).toBe((14 * 60 + 45) * 60 * 1000);
  });

  it("rejects malformed, impossible, or non-string input", () => {
    expect(isoSlotToMs("2026-02-30", "10:00")).toBe(null); // Feb 30
    expect(isoSlotToMs("2026-13-01", "10:00")).toBe(null); // month 13
    expect(isoSlotToMs("2026/05/08", "10:00")).toBe(null); // wrong separator
    expect(isoSlotToMs("nope", "10:00")).toBe(null);
    expect(isoSlotToMs(null, "10:00")).toBe(null);
    expect(isoSlotToMs(undefined, "10:00")).toBe(null);
    expect(isoSlotToMs(20260508, "10:00")).toBe(null);
  });

  it("parses the date portion of a full ISO datetime string", () => {
    const dateOnly = isoSlotToMs("2026-07-01", "08:00");
    const fullIso = isoSlotToMs("2026-07-01T23:59:59.000Z", "08:00");
    expect(fullIso).toBe(dateOnly); // time arg wins; trailing ISO time ignored
  });
});
