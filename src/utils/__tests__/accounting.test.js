import { describe, it, expect } from "vitest";
import {
  sessionCountsTowardBalance,
  computeConsumedByPatient,
  enrichPatientsWithBalance,
} from "../accounting";

// Tiny builder to keep test fixtures legible.
const sess = (patient_id, status, rate = 700, extra = {}) => ({
  patient_id, status, rate, ...extra,
});
const pat = (id, rate = 700, paid = 0, extra = {}) => ({
  id, rate, paid, ...extra,
});

describe("sessionCountsTowardBalance", () => {
  it("counts completed", () => {
    expect(sessionCountsTowardBalance({ status: "completed" })).toBe(true);
  });
  it("counts charged", () => {
    expect(sessionCountsTowardBalance({ status: "charged" })).toBe(true);
  });
  it("does NOT count scheduled", () => {
    // Even past-dated scheduled — auto-complete is UI only.
    expect(sessionCountsTowardBalance({ status: "scheduled" })).toBe(false);
  });
  it("does NOT count cancelled", () => {
    expect(sessionCountsTowardBalance({ status: "cancelled" })).toBe(false);
  });
});

describe("computeConsumedByPatient", () => {
  it("sums rates for completed + charged only", () => {
    const rateById = new Map([["p1", 700]]);
    const m = computeConsumedByPatient([
      sess("p1", "completed", 700),
      sess("p1", "charged",   500),
      sess("p1", "scheduled", 700),  // ← ignored
      sess("p1", "cancelled", 700),  // ← ignored
    ], rateById);
    expect(m.get("p1")).toBe(1200);
  });

  it("falls back to patient rate when session.rate is null", () => {
    // Cancelled-then-rescheduled rows sometimes have rate=null in the
    // DB. We must apply the patient's current rate as fallback so the
    // session still contributes the expected amount.
    const rateById = new Map([["p1", 800]]);
    const m = computeConsumedByPatient([
      sess("p1", "completed", null),
    ], rateById);
    expect(m.get("p1")).toBe(800);
  });

  it("skips sessions with no patient_id", () => {
    // Orphaned payment-like rows shouldn't crash or inflate anything.
    const m = computeConsumedByPatient([
      { patient_id: null, status: "completed", rate: 700 },
    ], new Map());
    expect(m.size).toBe(0);
  });

  it("handles empty / nullish input without throwing", () => {
    expect(computeConsumedByPatient(null, new Map()).size).toBe(0);
    expect(computeConsumedByPatient([], new Map()).size).toBe(0);
  });

  it("keeps different patients isolated", () => {
    const rateById = new Map([["p1", 700], ["p2", 500]]);
    const m = computeConsumedByPatient([
      sess("p1", "completed", 700),
      sess("p2", "charged",   500),
    ], rateById);
    expect(m.get("p1")).toBe(700);
    expect(m.get("p2")).toBe(500);
  });
});

describe("enrichPatientsWithBalance", () => {
  it("amountDue = consumed − paid when consumed > paid", () => {
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 700, 300)],
      [sess("p1", "completed", 700)],
    );
    expect(out.amountDue).toBe(400);
    expect(out.credit).toBe(0);
  });

  it("credit = paid − consumed when paid > consumed (prepaid)", () => {
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 700, 2000)],
      [sess("p1", "completed", 700)],
    );
    expect(out.amountDue).toBe(0);
    expect(out.credit).toBe(1300);
  });

  it("amountDue and credit are mutually exclusive", () => {
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 700, 700)],
      [sess("p1", "completed", 700)],
    );
    expect(out.amountDue).toBe(0);
    expect(out.credit).toBe(0);
  });

  it("ignores auto-complete-looking scheduled sessions (Prime Directive)", () => {
    // If the UI accidentally fed enriched sessions with status flipped
    // to "completed", but the REAL DB row is "scheduled", the canonical
    // helper must still count nothing. This is the regression the whole
    // Prime Directive section in CLAUDE.md exists to prevent.
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 700, 0)],
      [
        sess("p1", "scheduled", 700),
        sess("p1", "scheduled", 700),
        sess("p1", "scheduled", 700),
      ],
    );
    expect(out.amountDue).toBe(0);
    expect(out.credit).toBe(0);
  });

  it("cancel-with-charge (CHARGED) contributes immediately, no date filter", () => {
    // A CHARGED session owes the therapist from the moment the cancel
    // fee is booked — even if the original session date is in the future.
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 700, 0)],
      [sess("p1", "charged", 700, { date: "31-Dic", time: "10:00" })],
    );
    expect(out.amountDue).toBe(700);
  });

  it("preserves historical rate accuracy when patient.rate changes", () => {
    // Old sessions keep their recorded rate; fallback only kicks in when
    // session.rate is null. New rate on patient doesn't retroactively
    // reprice old sessions.
    const [out] = enrichPatientsWithBalance(
      [pat("p1", 900, 0)],  // rate was raised to 900
      [
        sess("p1", "completed", 700),  // old session at old rate
        sess("p1", "completed", 900),  // new session at new rate
      ],
    );
    expect(out.amountDue).toBe(1600);
  });

  it("returns empty array for null/undefined patients input", () => {
    expect(enrichPatientsWithBalance(null, [])).toEqual([]);
    expect(enrichPatientsWithBalance(undefined, [])).toEqual([]);
  });

  it("preserves all other patient fields", () => {
    const [out] = enrichPatientsWithBalance(
      [{ id: "p1", rate: 700, paid: 0, name: "Ana", status: "active" }],
      [],
    );
    expect(out.name).toBe("Ana");
    expect(out.status).toBe("active");
  });
});
