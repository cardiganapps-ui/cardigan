import { describe, it, expect } from "vitest";
import {
  classifyBillingState,
  endDateIso,
  planPriceCents,
  rowSubLine,
  chargeLine,
} from "../subscriptionStatus";

/* The classifier is the heart of the "no ambiguity" guarantee — every
   user state must map to exactly one case, and the case must drive
   correct downstream messaging. */

// Stub `t` that just echoes `key + params` so we can assert which
// template was selected without depending on the i18n bundle.
const t = (key, vars) => {
  if (!vars) return key;
  const parts = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(",");
  return `${key}(${parts})`;
};

describe("classifyBillingState", () => {
  it("loading when nothing is loaded yet", () => {
    expect(classifyBillingState(null)).toBe("loading");
    expect(classifyBillingState({ loading: true })).toBe("loading");
  });

  it("comp wins over every Stripe state", () => {
    expect(classifyBillingState({
      compGranted: true,
      subscribedActive: true,
      subscription: { status: "active", cancel_at: "2026-05-30T00:00:00Z" },
    })).toBe("comp");
  });

  it("past_due wins over subscribedActive label", () => {
    expect(classifyBillingState({
      subscribedActive: true,
      subscription: { status: "past_due" },
    })).toBe("past_due");
  });

  it("cancelling — cancel_at_period_end variant", () => {
    expect(classifyBillingState({
      subscribedActive: true,
      subscription: { status: "active", cancel_at_period_end: true },
    })).toBe("cancelling");
  });

  it("cancelling — cancel_at timestamp variant (the bug we just fixed)", () => {
    expect(classifyBillingState({
      subscribedActive: true,
      subscription: {
        status: "trialing",
        cancel_at_period_end: false,
        cancel_at: "2026-05-30T22:16:04Z",
      },
    })).toBe("cancelling");
  });

  it("renewing — clean active sub", () => {
    expect(classifyBillingState({
      subscribedActive: true,
      subscription: { status: "active", current_period_end: "2026-06-15T00:00:00Z" },
    })).toBe("renewing");
  });

  it("trial_with_sub — trialing + dpm + no cancel", () => {
    expect(classifyBillingState({
      subscribedActive: true,
      subscription: { status: "trialing", default_payment_method: "pm_x" },
    })).toBe("trial_with_sub");
  });

  it("trial_no_sub — pure trial", () => {
    expect(classifyBillingState({
      subscribedActive: false,
      accessState: "trial",
      daysLeftInTrial: 14,
    })).toBe("trial_no_sub");
  });

  it("trial_expiring_today — last day", () => {
    expect(classifyBillingState({
      subscribedActive: false,
      accessState: "trial",
      daysLeftInTrial: 1,
    })).toBe("trial_expiring_today");
    expect(classifyBillingState({
      subscribedActive: false,
      accessState: "trial",
      daysLeftInTrial: 0,
    })).toBe("trial_expiring_today");
  });

  it("expired — no access", () => {
    expect(classifyBillingState({
      subscribedActive: false,
      accessState: "expired",
    })).toBe("expired");
  });
});

describe("endDateIso", () => {
  it("prefers cancel_at when set", () => {
    expect(endDateIso({
      subscription: {
        cancel_at: "2026-05-30T22:16:04Z",
        current_period_end: "2026-06-15T00:00:00Z",
        trial_end: "2026-05-30T22:16:04Z",
      },
    })).toBe("2026-05-30T22:16:04Z");
  });

  it("falls back to current_period_end when no cancel_at", () => {
    expect(endDateIso({
      subscription: {
        status: "active",
        current_period_end: "2026-06-15T00:00:00Z",
      },
    })).toBe("2026-06-15T00:00:00Z");
  });

  it("uses trial_end when status=trialing and current_period_end is null (API 2025-04-30 case)", () => {
    expect(endDateIso({
      subscription: {
        status: "trialing",
        current_period_end: null,
        trial_end: "2026-05-30T22:16:04Z",
      },
    })).toBe("2026-05-30T22:16:04Z");
  });

  it("returns null when nothing is available", () => {
    expect(endDateIso({ subscription: {} })).toBeNull();
    expect(endDateIso(null)).toBeNull();
  });
});

describe("planPriceCents", () => {
  it("infers monthly when price id is generic / unknown", () => {
    expect(planPriceCents({ subscription: { stripe_price_id: "price_1abc" } })).toBe(29900);
    expect(planPriceCents({ subscription: {} })).toBe(29900);
    expect(planPriceCents(null)).toBe(29900);
  });

  it("infers annual when price id contains the keyword", () => {
    expect(planPriceCents({ subscription: { stripe_price_id: "price_annual_2990" } })).toBe(299000);
    expect(planPriceCents({ subscription: { stripe_price_id: "price_yearly_xx" } })).toBe(299000);
  });
});

describe("rowSubLine", () => {
  it("comp users see the no-charges affirmation", () => {
    expect(rowSubLine({ compGranted: true }, t)).toBe("subscription.rowSubComp");
  });

  it("past_due surfaces the payment problem", () => {
    expect(rowSubLine({
      subscription: { status: "past_due" },
    }, t)).toBe("subscription.rowSubPastDue");
  });

  it("cancelling user sees the end date (our test-user case)", () => {
    const out = rowSubLine({
      subscribedActive: true,
      subscription: {
        status: "trialing",
        cancel_at: "2026-05-30T22:16:04Z",
        trial_end: "2026-05-30T22:16:04Z",
      },
    }, t);
    expect(out).toMatch(/^subscription\.rowSubProCancelling\(date=/);
    expect(out).toContain("30 may");
  });

  it("renewing user sees next-charge date", () => {
    const out = rowSubLine({
      subscribedActive: true,
      subscription: { status: "active", current_period_end: "2026-06-15T00:00:00Z" },
    }, t);
    expect(out).toMatch(/^subscription\.rowSubProActive\(date=/);
  });

  it("trial-no-sub shows trial end date", () => {
    const out = rowSubLine({
      accessState: "trial",
      daysLeftInTrial: 12,
      subscription: { trial_end: "2026-05-30T00:00:00Z", status: "trialing" },
    }, t);
    expect(out).toMatch(/^subscription\.rowSubTrial\(date=/);
  });

  it("expired user gets clear call-to-action", () => {
    expect(rowSubLine({ accessState: "expired" }, t))
      .toBe("subscription.rowSubExpired");
  });
});

describe("chargeLine", () => {
  it("renewing user sees explicit amount + date", () => {
    const out = chargeLine({
      subscribedActive: true,
      subscription: { status: "active", current_period_end: "2026-06-15T00:00:00Z", stripe_price_id: "price_x" },
    }, t);
    expect(out).toMatch(/subscription\.chargeLineRenewing/);
    expect(out).toContain("amount=$299");
    expect(out).toContain("15 de junio de 2026");
  });

  it("cancelling user is told no more charges + when access ends", () => {
    const out = chargeLine({
      subscribedActive: true,
      subscription: {
        status: "trialing",
        cancel_at: "2026-05-30T22:16:04Z",
        trial_end: "2026-05-30T22:16:04Z",
      },
    }, t);
    expect(out).toMatch(/subscription\.chargeLineCancelling/);
    expect(out).toContain("30 de mayo de 2026");
  });

  it("trial-with-sub user is told their first charge date + amount", () => {
    const out = chargeLine({
      subscribedActive: true,
      subscription: {
        status: "trialing",
        default_payment_method: "pm_x",
        trial_end: "2026-05-30T00:00:00Z",
      },
    }, t);
    expect(out).toMatch(/subscription\.chargeLineTrialWithSub/);
    expect(out).toContain("amount=$299");
  });

  it("comp user is told no charges, ever", () => {
    expect(chargeLine({ compGranted: true }, t)).toBe("subscription.chargeLineComp");
  });

  it("past_due user is told to fix their card", () => {
    expect(chargeLine({
      subscription: { status: "past_due" },
    }, t)).toBe("subscription.chargeLinePastDue");
  });
});
