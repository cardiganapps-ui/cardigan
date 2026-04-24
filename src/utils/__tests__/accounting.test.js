import { describe, it, expect } from "vitest";
import {
  sessionCountsTowardBalance,
  computeConsumedByPatient,
  enrichPatientsWithBalance,
} from "../accounting";

// Fixed reference time so tests are deterministic across years.
// Today (in these tests) = 2026-04-24 10:00.
const NOW = new Date(2026, 3, 24, 10, 0);

// Builders
const sess = (patient_id, status, rate = 700, overrides = {}) => ({
  patient_id, status, rate,
  date: overrides.date ?? "1-Ene",
  time: overrides.time ?? "10:00",
  ...overrides,
});
const pat = (id, rate = 700, paid = 0, extra = {}) => ({
  id, rate, paid, ...extra,
});

describe("sessionCountsTowardBalance", () => {
  it("counts explicit completed", () => {
    expect(sessionCountsTowardBalance(
      sess("p", "completed", 700, { date: "1-Ene" }), NOW
    )).toBe(true);
  });

  it("counts charged even on a future date (cancel-with-charge owes immediately)", () => {
    expect(sessionCountsTowardBalance(
      sess("p", "charged", 700, { date: "31-Dic", time: "10:00" }), NOW
    )).toBe(true);
  });

  it("counts scheduled whose date+time has passed (auto-complete equivalent)", () => {
    // 23-Abr is yesterday — past.
    expect(sessionCountsTowardBalance(
      sess("p", "scheduled", 700, { date: "23-Abr", time: "10:00" }), NOW
    )).toBe(true);
  });

  it("does NOT count scheduled whose date is in the future", () => {
    // 28-Abr is a few days away — future.
    expect(sessionCountsTowardBalance(
      sess("p", "scheduled", 700, { date: "28-Abr", time: "10:00" }), NOW
    )).toBe(false);
  });

  it("does NOT count a scheduled session that started less than an hour ago", () => {
    // Session was today 09:30; now is 10:00, so it's only 30m in. +1h grace
    // means it doesn't flip to consumed yet — matches the display auto-
    // complete rule so the UI and the balance agree.
    expect(sessionCountsTowardBalance(
      sess("p", "scheduled", 700, { date: "24-Abr", time: "09:30" }), NOW
    )).toBe(false);
  });

  it("counts a scheduled session whose 1-hour grace has elapsed", () => {
    // Session at 09:00 today; now is 10:00 — past end-of-grace.
    expect(sessionCountsTowardBalance(
      sess("p", "scheduled", 700, { date: "24-Abr", time: "09:00" }), NOW
    )).toBe(true);
  });

  it("does NOT count cancelled", () => {
    expect(sessionCountsTowardBalance(
      sess("p", "cancelled", 700, { date: "1-Ene" }), NOW
    )).toBe(false);
  });

  it("handles null/undefined session input", () => {
    expect(sessionCountsTowardBalance(null, NOW)).toBe(false);
    expect(sessionCountsTowardBalance(undefined, NOW)).toBe(false);
  });
});

describe("computeConsumedByPatient", () => {
  it("sums completed + charged + past-scheduled", () => {
    const rateById = new Map([["p1", 700]]);
    const m = computeConsumedByPatient([
      sess("p1", "completed", 700, { date: "1-Ene" }),
      sess("p1", "charged",   500, { date: "1-Ene" }),
      sess("p1", "scheduled", 700, { date: "23-Abr", time: "10:00" }),  // past → counts
      sess("p1", "scheduled", 700, { date: "28-Abr", time: "10:00" }),  // future → skipped
      sess("p1", "cancelled", 700, { date: "1-Ene" }),                  // never counts
    ], rateById, NOW);
    expect(m.get("p1")).toBe(700 + 500 + 700);  // 1900
  });

  it("falls back to patient.rate when session.rate is null", () => {
    // Imported historical rows often have rate=null. We apply the current
    // patient rate as fallback so consumed reflects reality.
    const rateById = new Map([["p1", 800]]);
    const m = computeConsumedByPatient([
      sess("p1", "scheduled", null, { date: "1-Ene" }),
    ], rateById, NOW);
    expect(m.get("p1")).toBe(800);
  });

  it("skips sessions with no patient_id", () => {
    const m = computeConsumedByPatient([
      { patient_id: null, status: "completed", rate: 700, date: "1-Ene", time: "10:00" },
    ], new Map(), NOW);
    expect(m.size).toBe(0);
  });

  it("handles empty / nullish input without throwing", () => {
    expect(computeConsumedByPatient(null, new Map(), NOW).size).toBe(0);
    expect(computeConsumedByPatient([], new Map(), NOW).size).toBe(0);
  });

  it("keeps different patients isolated", () => {
    const rateById = new Map([["p1", 700], ["p2", 500]]);
    const m = computeConsumedByPatient([
      sess("p1", "completed", 700, { date: "1-Ene" }),
      sess("p2", "charged",   500, { date: "1-Ene" }),
    ], rateById, NOW);
    expect(m.get("p1")).toBe(700);
    expect(m.get("p2")).toBe(500);
  });
});

describe("enrichPatientsWithBalance", () => {
  it("amountDue = consumed − paid when consumed > paid", () => {
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 700, 300)],
      [sess("p1", "completed", 700, { date: "1-Ene" })],
      NOW,
    );
    expect(out.amountDue).toBe(400);
    expect(out.credit).toBe(0);
  });

  it("credit = paid − consumed when paid > consumed (prepaid)", () => {
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 700, 2000)],
      [sess("p1", "completed", 700, { date: "1-Ene" })],
      NOW,
    );
    expect(out.amountDue).toBe(0);
    expect(out.credit).toBe(1300);
  });

  it("amountDue and credit are mutually exclusive", () => {
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 700, 700)],
      [sess("p1", "completed", 700, { date: "1-Ene" })],
      NOW,
    );
    expect(out.amountDue).toBe(0);
    expect(out.credit).toBe(0);
  });

  it("includes past-scheduled sessions (the critical product requirement)", () => {
    // Therapists almost never mark sessions completed — they rely on the
    // past-scheduled-counts rule. If that branch regresses, every active
    // patient goes to credit and therapists appear to owe the user money.
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 700, 0)],
      [
        sess("p1", "scheduled", 700, { date: "10-Abr", time: "10:00" }),
        sess("p1", "scheduled", 700, { date: "17-Abr", time: "10:00" }),
        sess("p1", "scheduled", 700, { date: "23-Abr", time: "10:00" }),  // yesterday
      ],
      NOW,
    );
    expect(out.amountDue).toBe(2100);
  });

  it("future-scheduled sessions are excluded", () => {
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 700, 0)],
      [
        sess("p1", "scheduled", 700, { date: "28-Abr", time: "10:00" }),
        sess("p1", "scheduled", 700, { date: "5-May", time: "10:00" }),
      ],
      NOW,
    );
    expect(out.amountDue).toBe(0);
  });

  it("cancel-with-charge (CHARGED) contributes immediately, no date filter", () => {
    // A CHARGED session owes the therapist from the moment the cancel
    // fee is booked — even if the original session date is in the future.
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 700, 0)],
      [sess("p1", "charged", 700, { date: "31-Dic", time: "10:00" })],
      NOW,
    );
    expect(out.amountDue).toBe(700);
  });

  it("cancelled (without charge) never inflates", () => {
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 700, 0)],
      [
        sess("p1", "cancelled", 700, { date: "10-Abr" }),
        sess("p1", "cancelled", 700, { date: "17-Abr" }),
      ],
      NOW,
    );
    expect(out.amountDue).toBe(0);
    expect(out.credit).toBe(0);
  });

  it("preserves historical rate accuracy when patient.rate changes", () => {
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 900, 0)],  // rate was raised to 900
      [
        sess("p1", "completed", 700, { date: "1-Ene" }),  // old session at old rate
        sess("p1", "completed", 900, { date: "1-Feb" }),  // new session at new rate
      ],
      NOW,
    );
    expect(out.amountDue).toBe(1600);
  });

  it("returns empty array for null/undefined patients input", () => {
    expect(enrichPatientsWithBalance(null, [], NOW)).toEqual([]);
    expect(enrichPatientsWithBalance(undefined, [], NOW)).toEqual([]);
  });

  it("preserves all other patient fields", () => {
    const [out] = enrichPatientsWithBalance(
      [{ id: "p1", rate: 700, paid: 0, name: "Ana", status: "active" }],
      [],
      NOW,
    );
    expect(out.name).toBe("Ana");
    expect(out.status).toBe("active");
  });
});
