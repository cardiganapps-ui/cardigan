import { describe, it, expect } from "vitest";
import {
  cohortWindow,
  isInCohortWindow,
  firstPaidByUser,
  hasActiveSubscription,
} from "../_cohorts.js";

/* These helpers gate every lifecycle email — getting the date math
   wrong silently messages the wrong cohort, so the tests are
   intentionally exhaustive on boundary conditions. */

const DAY = 86_400_000;

describe("cohortWindow", () => {
  it("returns [now − (days+window), now − days) bounds", () => {
    // Anchor `now` so the math is verifiable.
    const now = Date.parse("2026-05-07T12:00:00Z");
    const { lower, upper } = cohortWindow(14, 2, now);
    expect(upper).toBe(new Date(now - 14 * DAY).toISOString());
    expect(lower).toBe(new Date(now - 16 * DAY).toISOString());
  });

  it("upper is more recent than lower (newer ISO sorts later)", () => {
    const { lower, upper } = cohortWindow(14, 2, Date.parse("2026-05-07T12:00:00Z"));
    expect(upper > lower).toBe(true);
  });

  it("default `now` argument uses Date.now()", () => {
    const before = Date.now();
    const { upper } = cohortWindow(0, 1);
    const after = Date.now();
    const upperMs = Date.parse(upper);
    expect(upperMs).toBeGreaterThanOrEqual(before);
    expect(upperMs).toBeLessThanOrEqual(after);
  });
});

describe("isInCohortWindow", () => {
  const now = Date.parse("2026-05-07T12:00:00Z");
  const { lower, upper } = cohortWindow(14, 2, now); // [now-16d, now-14d)

  it("returns true for a timestamp inside the window", () => {
    const inside = new Date(now - 15 * DAY).toISOString();
    expect(isInCohortWindow(inside, lower, upper)).toBe(true);
  });

  it("includes the lower bound (>= lower)", () => {
    expect(isInCohortWindow(lower, lower, upper)).toBe(true);
  });

  it("excludes the upper bound (< upper)", () => {
    expect(isInCohortWindow(upper, lower, upper)).toBe(false);
  });

  it("rejects a timestamp newer than the window (= one tick before today)", () => {
    const tooNew = new Date(now - 13 * DAY).toISOString();
    expect(isInCohortWindow(tooNew, lower, upper)).toBe(false);
  });

  it("rejects a timestamp older than the window", () => {
    const tooOld = new Date(now - 100 * DAY).toISOString();
    expect(isInCohortWindow(tooOld, lower, upper)).toBe(false);
  });

  it("rejects null / undefined / empty timestamps", () => {
    expect(isInCohortWindow(null, lower, upper)).toBe(false);
    expect(isInCohortWindow(undefined, lower, upper)).toBe(false);
    expect(isInCohortWindow("", lower, upper)).toBe(false);
  });

  it("matches the regression case the agent flagged: 100-day-old invoice with day-12 cohort is rejected", () => {
    // The audit raised a concern that a user's older invoice could be
    // misclassified as recent. cohortWindow is symmetric — older
    // timestamps fail the `>= lower` check.
    const day12 = cohortWindow(12, 2, now); // [now-14d, now-12d)
    const oldInvoice = new Date(now - 100 * DAY).toISOString();
    expect(isInCohortWindow(oldInvoice, day12.lower, day12.upper)).toBe(false);
  });
});

describe("firstPaidByUser", () => {
  it("returns the EARLIEST paid_at per user when input is sorted ASC", () => {
    const invoices = [
      { user_id: "a", paid_at: "2026-01-01T00:00:00Z" },
      { user_id: "a", paid_at: "2026-02-01T00:00:00Z" },
      { user_id: "b", paid_at: "2026-03-01T00:00:00Z" },
      { user_id: "a", paid_at: "2026-04-01T00:00:00Z" },
    ];
    const map = firstPaidByUser(invoices);
    expect(map.get("a")).toBe("2026-01-01T00:00:00Z");
    expect(map.get("b")).toBe("2026-03-01T00:00:00Z");
  });

  it("returns an empty Map for null/empty input", () => {
    expect(firstPaidByUser(null).size).toBe(0);
    expect(firstPaidByUser([]).size).toBe(0);
    expect(firstPaidByUser(undefined).size).toBe(0);
  });

  it("skips rows with missing user_id or paid_at", () => {
    const invoices = [
      { user_id: null, paid_at: "2026-01-01T00:00:00Z" },
      { user_id: "a", paid_at: null },
      { user_id: "a", paid_at: "2026-02-01T00:00:00Z" },
    ];
    const map = firstPaidByUser(invoices);
    expect(map.size).toBe(1);
    expect(map.get("a")).toBe("2026-02-01T00:00:00Z");
  });
});

describe("hasActiveSubscription", () => {
  it("returns false for null/undefined/empty", () => {
    expect(hasActiveSubscription(null)).toBe(false);
    expect(hasActiveSubscription(undefined)).toBe(false);
    expect(hasActiveSubscription({})).toBe(false);
  });

  it("returns true for comp_granted regardless of status", () => {
    expect(hasActiveSubscription({ comp_granted: true, status: null })).toBe(true);
    expect(hasActiveSubscription({ comp_granted: true, status: "canceled" })).toBe(true);
  });

  it("returns true for status=active and status=past_due", () => {
    expect(hasActiveSubscription({ status: "active" })).toBe(true);
    expect(hasActiveSubscription({ status: "past_due" })).toBe(true);
  });

  it("returns true for trialing WITH a default_payment_method", () => {
    expect(hasActiveSubscription({ status: "trialing", default_payment_method: "pm_123" })).toBe(true);
  });

  it("returns false for trialing WITHOUT a default_payment_method (Pro-without-card orphan)", () => {
    expect(hasActiveSubscription({ status: "trialing" })).toBe(false);
    expect(hasActiveSubscription({ status: "trialing", default_payment_method: null })).toBe(false);
  });

  it("returns false for canceled / unpaid / incomplete / paused", () => {
    expect(hasActiveSubscription({ status: "canceled" })).toBe(false);
    expect(hasActiveSubscription({ status: "unpaid" })).toBe(false);
    expect(hasActiveSubscription({ status: "incomplete" })).toBe(false);
    expect(hasActiveSubscription({ status: "incomplete_expired" })).toBe(false);
    expect(hasActiveSubscription({ status: "paused" })).toBe(false);
  });
});
