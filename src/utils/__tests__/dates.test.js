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
  it("converts 'D Mon' to ISO string for current year", () => {
    const y = new Date().getFullYear();
    expect(shortDateToISO("10 Abr")).toBe(`${y}-04-10`);
    expect(shortDateToISO("1 Ene")).toBe(`${y}-01-01`);
    expect(shortDateToISO("25 Dic")).toBe(`${y}-12-25`);
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
