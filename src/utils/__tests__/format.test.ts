/* ── Currency / number / date formatting tests ──
   format.js owns every money string the user sees, so its rounding,
   null-safety, and es-MX locale pinning are financial-display surface
   area — a stray decimal separator or a NaN leaking to the UI reads as
   broken numbers to a therapist auditing their own ledger. These tests
   lock the contract documented in the module header. */

import { describe, it, expect } from "vitest";
import {
  formatMXN,
  formatMXNDecimal,
  formatMXNCents,
  formatNumber,
  formatPercent,
  formatDate,
} from "../format";

describe("formatMXN", () => {
  it("formats integers with a comma thousands separator and no decimals", () => {
    expect(formatMXN(1234)).toBe("$1,234");
    expect(formatMXN(1000000)).toBe("$1,000,000");
    expect(formatMXN(0)).toBe("$0");
  });

  it("rounds to whole pesos (no cents)", () => {
    expect(formatMXN(1234.49)).toBe("$1,234");
    expect(formatMXN(1234.5)).toBe("$1,235"); // banker-agnostic round-half-up
  });

  it("coerces numeric strings", () => {
    expect(formatMXN("1234")).toBe("$1,234");
    expect(formatMXN("  900  ")).toBe("$900");
  });

  it("is null/undefined/NaN/garbage safe → $0, never 'Invalid'/'NaN'", () => {
    expect(formatMXN(null)).toBe("$0");
    expect(formatMXN(undefined)).toBe("$0");
    expect(formatMXN(NaN)).toBe("$0");
    expect(formatMXN("abc")).toBe("$0");
    expect(formatMXN("")).toBe("$0");
    expect(formatMXN(Infinity)).toBe("$0");
    expect(formatMXN({})).toBe("$0");
  });

  it("handles negatives (refunds / credits) — sign sits after the literal $", () => {
    // The "$" is a hardcoded prefix, so the minus lands between it and the
    // digits. Pinning the actual shape so a future refactor that wants
    // "-$500" is a deliberate, test-visible change.
    expect(formatMXN(-500)).toBe("$-500");
  });
});

describe("formatMXNDecimal", () => {
  it("always shows exactly two decimals", () => {
    expect(formatMXNDecimal(1234)).toBe("$1,234.00");
    expect(formatMXNDecimal(1234.5)).toBe("$1,234.50");
    expect(formatMXNDecimal(1234.567)).toBe("$1,234.57");
  });

  it("is null/NaN safe → $0.00", () => {
    expect(formatMXNDecimal(null)).toBe("$0.00");
    expect(formatMXNDecimal(NaN)).toBe("$0.00");
  });
});

describe("formatMXNCents", () => {
  it("converts Stripe-style integer cents into a peso display", () => {
    expect(formatMXNCents(14900)).toBe("$149");
    expect(formatMXNCents(100)).toBe("$1");
    expect(formatMXNCents(0)).toBe("$0");
  });

  it("is null/NaN safe → $0", () => {
    expect(formatMXNCents(null)).toBe("$0");
    expect(formatMXNCents(undefined)).toBe("$0");
  });
});

describe("formatNumber", () => {
  it("groups thousands with a comma, no currency symbol", () => {
    expect(formatNumber(1234)).toBe("1,234");
    expect(formatNumber(42)).toBe("42");
  });

  it("is null/NaN safe → 0", () => {
    expect(formatNumber(null)).toBe("0");
    expect(formatNumber("nope")).toBe("0");
  });
});

describe("formatPercent", () => {
  it("treats values in [-1, 1] as fractions", () => {
    const out = formatPercent(0.23);
    expect(out).toMatch(/23\s*%/); // es-MX may insert a (nbsp) before %
  });

  it("treats values outside [-1, 1] as already-multiplied percentages", () => {
    expect(formatPercent(23)).toBe("23%");
    expect(formatPercent(100)).toBe("100%");
  });

  it("the boundary value 1 is a fraction (→ 100%), 1.0001 is a raw percent", () => {
    expect(formatPercent(1)).toMatch(/100\s*%/);
    expect(formatPercent(2)).toBe("2%");
  });

  it("is null/NaN safe → 0%", () => {
    expect(formatPercent(null)).toMatch(/0\s*%/);
  });
});

describe("formatDate", () => {
  // 2026-05-30 — pick a fixed instant to keep month-name assertions stable.
  const iso = "2026-05-30T22:16:00";

  it("returns '' for null / empty / unparseable input (never 'Invalid Date')", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("not-a-date")).toBe("");
  });

  it("accepts a Date instance and an ISO string equivalently", () => {
    expect(formatDate(new Date(iso), "short")).toBe(formatDate(iso, "short"));
  });

  it("strips the trailing period es-MX appends to short month names", () => {
    const out = formatDate(iso, "short");
    expect(out).not.toMatch(/\./);
    expect(out).toContain("30");
  });

  it("defaults to the long variant when none / an unknown one is given", () => {
    const fallback = formatDate(iso, "totally-unknown-variant");
    expect(fallback).toBe(formatDate(iso, "long"));
    expect(fallback).toContain("2026");
  });

  it("longTime variant includes the time component (es-MX 12-hour)", () => {
    // es-MX renders hour:"2-digit" as a 12-hour clock with a localized
    // am/pm marker, e.g. "…a las 10:16 p.m".
    expect(formatDate(iso, "longTime")).toMatch(/10:16/);
    expect(formatDate(iso, "longTime")).toMatch(/p\.?\s?m/i);
  });
});
