import { describe, it, expect } from "vitest";
import { phoneDigits, formatPhoneMX, phoneHref, emailHref } from "../contact";

describe("phoneDigits", () => {
  it("strips all non-digit characters", () => {
    expect(phoneDigits("55 5432 0571")).toBe("5554320571");
    expect(phoneDigits("(55) 5432-0571")).toBe("5554320571");
    expect(phoneDigits("+52 55 5432 0571")).toBe("525554320571");
  });
  it("handles empty / null input", () => {
    expect(phoneDigits("")).toBe("");
    expect(phoneDigits(null)).toBe("");
    expect(phoneDigits(undefined)).toBe("");
  });
});

describe("formatPhoneMX", () => {
  it("formats a full 10-digit number as 2-4-4", () => {
    expect(formatPhoneMX("5554320571")).toBe("55 5432 0571");
  });
  it("is idempotent — reformatting a formatted value doesn't double-space", () => {
    expect(formatPhoneMX("55 5432 0571")).toBe("55 5432 0571");
  });
  it("formats progressively as the user types", () => {
    expect(formatPhoneMX("5")).toBe("5");
    expect(formatPhoneMX("55")).toBe("55");
    expect(formatPhoneMX("555")).toBe("55 5");
    expect(formatPhoneMX("555432")).toBe("55 5432");
    expect(formatPhoneMX("5554320")).toBe("55 5432 0");
  });
  it("preserves extra digits past 10 instead of dropping them", () => {
    expect(formatPhoneMX("55543205712")).toBe("55 5432 0571 2");
  });
  it("strips formatting characters before reformatting", () => {
    expect(formatPhoneMX("(55) 5432-0571")).toBe("55 5432 0571");
  });
  it("returns empty string for empty / null input", () => {
    expect(formatPhoneMX("")).toBe("");
    expect(formatPhoneMX(null)).toBe("");
  });
});

describe("phoneHref", () => {
  it("prepends +52 for a bare 10-digit MX number", () => {
    expect(phoneHref("5554320571")).toBe("tel:+525554320571");
    expect(phoneHref("55 5432 0571")).toBe("tel:+525554320571");
  });
  it("preserves numbers that already include a country code", () => {
    expect(phoneHref("525554320571")).toBe("tel:+525554320571");
  });
  it("passes short / non-standard numbers through without +", () => {
    expect(phoneHref("911")).toBe("tel:911");
  });
  it("returns null for empty input", () => {
    expect(phoneHref("")).toBeNull();
    expect(phoneHref(null)).toBeNull();
  });
});

describe("emailHref", () => {
  it("wraps an email in mailto:", () => {
    expect(emailHref("foo@bar.com")).toBe("mailto:foo@bar.com");
  });
  it("trims whitespace before building the href", () => {
    expect(emailHref("  foo@bar.com  ")).toBe("mailto:foo@bar.com");
  });
  it("returns null for anything without an @", () => {
    expect(emailHref("not-an-email")).toBeNull();
    expect(emailHref("")).toBeNull();
    expect(emailHref(null)).toBeNull();
  });
});
