import { describe, it, expect } from "vitest";
import {
  shouldSkipStaleEvent,
  invoiceIsRewardEligible,
} from "../stripe-webhook.js";

/* These two helpers are the heart of the webhook's correctness story:
   - shouldSkipStaleEvent prevents an older Stripe event from clobbering
     newer state when delivery is reordered (at-least-once, not in order).
   - invoiceIsRewardEligible blocks the $0 trial-start invoice from
     triggering a referral reward to the inviter before the invitee has
     actually paid anything. */

describe("shouldSkipStaleEvent", () => {
  it("never skips when the row has no prior event applied", () => {
    expect(shouldSkipStaleEvent("2026-05-02T10:00:00.000Z", null)).toBe(false);
    expect(shouldSkipStaleEvent("2026-05-02T10:00:00.000Z", undefined)).toBe(false);
  });

  it("never skips when the event has no created timestamp (replay/fixture)", () => {
    expect(shouldSkipStaleEvent(null, "2026-05-02T10:00:00.000Z")).toBe(false);
    expect(shouldSkipStaleEvent(undefined, "2026-05-02T10:00:00.000Z")).toBe(false);
  });

  it("skips an event older than the row's last applied", () => {
    expect(shouldSkipStaleEvent(
      "2026-05-02T09:59:00.000Z",
      "2026-05-02T10:00:00.000Z"
    )).toBe(true);
  });

  it("does NOT skip an event newer than the row's last applied", () => {
    expect(shouldSkipStaleEvent(
      "2026-05-02T10:01:00.000Z",
      "2026-05-02T10:00:00.000Z"
    )).toBe(false);
  });

  it("does NOT skip an event with the same timestamp as the row's last (idempotent)", () => {
    expect(shouldSkipStaleEvent(
      "2026-05-02T10:00:00.000Z",
      "2026-05-02T10:00:00.000Z"
    )).toBe(false);
  });

  it("handles the orphan-cancel race: old.deleted lands AFTER new.created", () => {
    // Scenario: user retried checkout. Old sub cancelled at T1, new
    // sub created at T2 > T1. Webhook for new.created applied first
    // (row.last = T2). Stale old.deleted (T1) arrives second — must be
    // skipped or it would clobber the row to canceled state.
    const T1 = "2026-05-02T10:00:00.000Z";
    const T2 = "2026-05-02T10:00:01.000Z";
    expect(shouldSkipStaleEvent(T1, T2)).toBe(true);
  });
});

describe("invoiceIsRewardEligible", () => {
  it("rejects null / non-object invoices", () => {
    expect(invoiceIsRewardEligible(null)).toBe(false);
    expect(invoiceIsRewardEligible(undefined)).toBe(false);
    expect(invoiceIsRewardEligible("not-an-object")).toBe(false);
  });

  it("rejects $0 trial-start invoices (the original bug)", () => {
    // Stripe fires invoice.paid with amount_paid=0 immediately on
    // subscription creation when trial_end is in the future — the
    // trial covers the first period so nothing's actually charged.
    expect(invoiceIsRewardEligible({ amount_paid: 0 })).toBe(false);
  });

  it("rejects invoices missing amount_paid", () => {
    // Defensive — a malformed payload shouldn't credit anyone.
    expect(invoiceIsRewardEligible({})).toBe(false);
    expect(invoiceIsRewardEligible({ amount_paid: null })).toBe(false);
    expect(invoiceIsRewardEligible({ amount_paid: "299" })).toBe(false);
  });

  it("rejects negative amounts (refund / credit-applied invoices)", () => {
    expect(invoiceIsRewardEligible({ amount_paid: -100 })).toBe(false);
  });

  it("accepts the inaugural $299 paid invoice", () => {
    expect(invoiceIsRewardEligible({ amount_paid: 29900 })).toBe(true);
  });

  it("accepts an annual $2,990 paid invoice", () => {
    expect(invoiceIsRewardEligible({ amount_paid: 299000 })).toBe(true);
  });
});
