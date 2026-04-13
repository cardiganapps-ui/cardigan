import { describe, it, expect } from "vitest";
import {
  SHORT_MONTHS, formatShortDate, shortDateToISO, isoToShortDate,
  toISODate, parseShortDate, parseLocalDate, getInitials, formatCurrency,
} from "../dates";

describe("formatShortDate", () => {
  it("formats a Date to 'D Mon'", () => {
    expect(formatShortDate(new Date(2026, 3, 10))).toBe("10 Abr");
    expect(formatShortDate(new Date(2026, 0, 1))).toBe("1 Ene");
    expect(formatShortDate(new Date(2026, 11, 25))).toBe("25 Dic");
  });
});

describe("shortDateToISO", () => {
  it("converts 'D Mon' to ISO using closest year to reference", () => {
    // With a reference date of April 10 2026:
    const ref = new Date(2026, 3, 10);
    expect(shortDateToISO("10 Abr", ref)).toBe("2026-04-10");
    expect(shortDateToISO("1 Ene", ref)).toBe("2026-01-01");
    // Dec 25 is closer to the reference when in 2025 (< 4 months ago)
    // vs 2026 (> 8 months away), so it resolves to previous year
    expect(shortDateToISO("25 Dic", ref)).toBe("2025-12-25");
  });

  it("handles year boundary: Dec date in January resolves to previous year", () => {
    const jan = new Date(2027, 0, 5); // Jan 5, 2027
    expect(shortDateToISO("31 Dic", jan)).toBe("2026-12-31");
  });

  it("handles year boundary: Jan date in December resolves to next year", () => {
    const dec = new Date(2026, 11, 28); // Dec 28, 2026
    expect(shortDateToISO("2 Ene", dec)).toBe("2027-01-02");
  });

  it("returns today for null/invalid input", () => {
    expect(shortDateToISO(null)).toBeTruthy();
    expect(shortDateToISO("invalid")).toBeTruthy();
  });
});

describe("isoToShortDate", () => {
  it("converts ISO to 'D Mon'", () => {
    expect(isoToShortDate("2026-04-10")).toBe("10 Abr");
    expect(isoToShortDate("2026-01-01")).toBe("1 Ene");
    expect(isoToShortDate("2026-12-25")).toBe("25 Dic");
  });

  it("returns today for null input", () => {
    expect(isoToShortDate(null)).toBeTruthy();
  });
});

describe("toISODate", () => {
  it("formats a Date to YYYY-MM-DD", () => {
    expect(toISODate(new Date(2026, 3, 10))).toBe("2026-04-10");
    expect(toISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("parseShortDate", () => {
  it("parses 'D Mon' to a Date", () => {
    const d = parseShortDate("10 Abr");
    expect(d.getDate()).toBe(10);
    expect(d.getMonth()).toBe(3); // April
  });

  it("handles single-digit days", () => {
    const d = parseShortDate("5 Ene");
    expect(d.getDate()).toBe(5);
    expect(d.getMonth()).toBe(0);
  });

  it("infers previous year for Dec date when reference is January", () => {
    const ref = new Date(2027, 0, 10); // Jan 10, 2027
    const d = parseShortDate("28 Dic", ref);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(28);
  });

  it("infers next year for Jan date when reference is December", () => {
    const ref = new Date(2026, 11, 30); // Dec 30, 2026
    const d = parseShortDate("3 Ene", ref);
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(3);
  });
});

describe("parseLocalDate", () => {
  it("parses ISO string to local Date", () => {
    const d = parseLocalDate("2026-04-10");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3);
    expect(d.getDate()).toBe(10);
  });
});

describe("getInitials", () => {
  it("returns first and last initials for multi-word names", () => {
    expect(getInitials("Diego Gaxiola")).toBe("DG");
    expect(getInitials("Ana María López")).toBe("AL");
  });

  it("returns first two chars for single-word names", () => {
    expect(getInitials("Diego")).toBe("DI");
  });

  it("handles extra whitespace", () => {
    expect(getInitials("  Juan  Pérez  ")).toBe("JP");
  });
});

describe("formatCurrency", () => {
  it("formats numbers with $ prefix", () => {
    expect(formatCurrency(1000)).toBe("$1,000");
    expect(formatCurrency(0)).toBe("$0");
  });

  it("handles null/undefined", () => {
    expect(formatCurrency(null)).toBe("$0");
    expect(formatCurrency(undefined)).toBe("$0");
  });
});
