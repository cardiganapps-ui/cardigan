import { describe, it, expect } from "vitest";
import { computeProValue } from "../proValue.js";

const APR_30 = new Date("2026-04-30T12:00:00.000-06:00");

function pad(n, value, base = {}) {
  return Array.from({ length: n }, (_, i) => ({ ...base, ...value(i) }));
}

describe("computeProValue", () => {
  it("returns null when the user hasn't logged 10 sessions yet", () => {
    const sessions = pad(5, () => ({ date: "1-Abr", status: "completed", rate: 800 }));
    const result = computeProValue(sessions, [], APR_30);
    expect(result).toBeNull();
  });

  it("counts completed + charged + past-scheduled sessions in the current month", () => {
    const sessions = [
      ...pad(5, () => ({ date: "5-Abr", status: "completed" })),
      ...pad(3, () => ({ date: "10-Abr", status: "charged" })),
      ...pad(2, () => ({ date: "15-Abr", status: "scheduled" })),
      // Future scheduled — must NOT count.
      { date: "29-May", status: "scheduled" },
      // Cancelled — must NOT count.
      { date: "12-Abr", status: "cancelled" },
      // Last month's completion — must NOT count toward current-month
      // narrative even though it's a real session.
      { date: "20-Mar", status: "completed" },
    ];
    const result = computeProValue(sessions, [], APR_30);
    expect(result).not.toBeNull();
    expect(result.sessionsCount).toBe(10); // 5 + 3 + 2
  });

  it("sums payments in the current month and computes the Pro share %", () => {
    const sessions = pad(12, () => ({ date: "5-Abr", status: "completed" }));
    const payments = [
      { date: "1-Abr", amount: 5000 },
      { date: "15-Abr", amount: 8000 },
      { date: "20-Abr", amount: 2000 },
      // Last-month payment — excluded.
      { date: "30-Mar", amount: 1000 },
    ];
    const result = computeProValue(sessions, payments, APR_30);
    expect(result.earnedMxn).toBe(15000);
    // 299 / 15000 ≈ 1.99%, rounded to one decimal.
    expect(result.proSharePct).toBeCloseTo(2.0, 1);
    expect(result.monthlyPriceMxn).toBe(299);
  });

  it("returns proSharePct=null when the user earned nothing this month", () => {
    const sessions = pad(12, () => ({ date: "5-Abr", status: "completed" }));
    const result = computeProValue(sessions, [], APR_30);
    expect(result.earnedMxn).toBe(0);
    expect(result.proSharePct).toBeNull();
  });

  it("caps proSharePct at 100 when earnings are below the price", () => {
    const sessions = pad(12, () => ({ date: "5-Abr", status: "completed" }));
    const payments = [{ date: "5-Abr", amount: 100 }]; // earned $100, price $299
    const result = computeProValue(sessions, payments, APR_30);
    expect(result.proSharePct).toBe(100);
  });

  it("respects a custom session threshold for testing", () => {
    const sessions = pad(2, () => ({ date: "5-Abr", status: "completed" }));
    const result = computeProValue(sessions, [], APR_30, { totalSessionThreshold: 1 });
    expect(result).not.toBeNull();
    expect(result.sessionsCount).toBe(2);
  });
});
