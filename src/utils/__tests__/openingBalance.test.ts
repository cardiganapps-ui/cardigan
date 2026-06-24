import { describe, it, expect } from "vitest";
import { signedOpeningBalance } from "../openingBalance";

describe("signedOpeningBalance", () => {
  it("'owes' → positive integer", () => {
    expect(signedOpeningBalance("500", "owes")).toBe(500);
  });

  it("'credit' → negative integer (saldo a favor)", () => {
    expect(signedOpeningBalance("500", "credit")).toBe(-500);
  });

  it("rounds to the nearest peso", () => {
    expect(signedOpeningBalance("100.4", "owes")).toBe(100);
    expect(signedOpeningBalance("100.6", "owes")).toBe(101);
    expect(signedOpeningBalance("100.6", "credit")).toBe(-101);
  });

  it("empty / zero / negative / non-numeric amount → 0 (clears the balance)", () => {
    expect(signedOpeningBalance("", "owes")).toBe(0);
    expect(signedOpeningBalance("", "credit")).toBe(0);
    expect(signedOpeningBalance("0", "owes")).toBe(0);
    expect(signedOpeningBalance("-50", "owes")).toBe(0); // direction, not sign, decides debt/credit
    expect(signedOpeningBalance("abc", "owes")).toBe(0);
  });

  it("an unknown direction is treated as 'owes' (positive) — only 'credit' flips the sign", () => {
    expect(signedOpeningBalance("200", "")).toBe(200);
    expect(signedOpeningBalance("200", "whatever")).toBe(200);
  });
});
