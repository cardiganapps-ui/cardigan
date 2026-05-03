import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  parseCSV,
  parseInBodyCSV,
  parseInBodyDate,
  parseNumber,
  namesMatch,
  normalizeName,
  parseFromRows,
} from "../inbody";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(
  resolve(__dirname, "fixtures/inbody-sample.csv"),
  "utf8",
);

describe("parseCSV (RFC 4180)", () => {
  it("parses a simple comma-separated row", () => {
    expect(parseCSV("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with embedded commas", () => {
    expect(parseCSV('a,"b,c",d')).toEqual([["a", "b,c", "d"]]);
  });

  it('handles escaped double quotes ("")', () => {
    expect(parseCSV('a,"he said ""hi""",b')).toEqual([
      ["a", 'he said "hi"', "b"],
    ]);
  });

  it("strips a UTF-8 BOM at the start", () => {
    expect(parseCSV("﻿a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("tolerates CRLF and LF line endings", () => {
    expect(parseCSV("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCSV("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("parseNumber", () => {
  it("parses plain numbers", () => {
    expect(parseNumber("76.4")).toBe(76.4);
    expect(parseNumber("0")).toBe(0);
  });

  it("treats comma as decimal when no dot present", () => {
    expect(parseNumber("76,4")).toBe(76.4);
  });

  it("strips trailing units", () => {
    expect(parseNumber("76.4 kg")).toBe(76.4);
    expect(parseNumber("32 %")).toBe(32);
  });

  it("handles ES thousands separator (1.234,5)", () => {
    expect(parseNumber("1.234,5")).toBe(1234.5);
  });

  it("handles EN thousands separator (1,234.5)", () => {
    expect(parseNumber("1,234.5")).toBe(1234.5);
  });

  it("returns null for blank / placeholder values", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("   ")).toBeNull();
    expect(parseNumber("-")).toBeNull();
    expect(parseNumber("—")).toBeNull();
    expect(parseNumber("N/A")).toBeNull();
    expect(parseNumber("n/a")).toBeNull();
  });

  it("returns null for nonsense", () => {
    expect(parseNumber("abc")).toBeNull();
  });
});

describe("parseInBodyDate", () => {
  it("parses the ISO LookinBody English format", () => {
    expect(parseInBodyDate("2026-04-12 14:30:00")).toBe(
      "2026-04-12T14:30:00.000Z",
    );
  });

  it("parses a bare ISO date", () => {
    expect(parseInBodyDate("2026-04-12")).toBe("2026-04-12T12:00:00.000Z");
  });

  it("parses the LookinBody Spanish DD/MM/YYYY format", () => {
    expect(parseInBodyDate("12/04/2026 10:30")).toBe(
      "2026-04-12T10:30:00.000Z",
    );
  });

  it("parses a Spanish date without time", () => {
    expect(parseInBodyDate("12/04/2026")).toBe("2026-04-12T12:00:00.000Z");
  });

  it("returns null on garbage", () => {
    expect(parseInBodyDate("")).toBeNull();
    expect(parseInBodyDate(null)).toBeNull();
    expect(parseInBodyDate("not a date")).toBeNull();
  });
});

describe("normalizeName + namesMatch", () => {
  it("strips accents and lowercases", () => {
    expect(normalizeName("Ana García")).toBe("ana garcia");
    expect(normalizeName("  José   Pérez  ")).toBe("jose perez");
  });

  it("matches identical names", () => {
    expect(namesMatch("ana garcia", "ana garcia")).toBe(true);
  });

  it("matches when one side has extra middle names", () => {
    expect(namesMatch("ana garcia", "ana maria garcia lopez")).toBe(true);
  });

  it("rejects unrelated names that share one token", () => {
    expect(namesMatch("ana lopez", "ana garcia")).toBe(false);
  });

  it("rejects when either side is empty", () => {
    expect(namesMatch("", "ana garcia")).toBe(false);
    expect(namesMatch("ana garcia", "")).toBe(false);
  });
});

describe("parseInBodyCSV (Spanish fixture)", () => {
  it("parses every row in the fixture", () => {
    const result = parseInBodyCSV(fixture);
    expect(result.totalRows).toBe(3);
    expect(result.rows).toHaveLength(3);
  });

  it("maps Spanish column headers to canonical fields", () => {
    const { rows } = parseInBodyCSV(fixture);
    const r = rows[0];
    expect(r.weight_kg).toBe(76.4);
    expect(r.body_fat_pct).toBe(32.1);
    expect(r.skeletal_muscle_kg).toBe(24.6);
    expect(r.body_fat_kg).toBe(24.5);
    expect(r.visceral_fat_level).toBe(11);
    expect(r.total_body_water_kg).toBe(38.2);
    expect(r.protein_kg).toBe(11.4);
    expect(r.minerals_kg).toBe(3.4);
    expect(r.basal_metabolic_rate_kcal).toBe(1420);
    expect(r.phase_angle).toBe(5.2);
    expect(r.inbody_score).toBe(72);
    expect(r.waist_cm).toBe(82.5);
    expect(r.device_model).toBe("InBody 770");
  });

  it("parses scanned_at to ISO UTC", () => {
    const { rows } = parseInBodyCSV(fixture);
    expect(rows[0].scanned_at).toBe("2026-04-12T10:30:00.000Z");
  });

  it("flags rows that don't match the expected patient name", () => {
    const { rows } = parseInBodyCSV(fixture, { expectedName: "Ana García" });
    expect(rows[0]._matchesPatient).toBe(true);
    expect(rows[1]._matchesPatient).toBe(true);
    expect(rows[2]._matchesPatient).toBe(false); // Carlos Méndez
  });

  it("matches every row when no expectedName is given", () => {
    const { rows } = parseInBodyCSV(fixture);
    for (const r of rows) expect(r._matchesPatient).toBe(true);
  });
});

describe("parseInBodyCSV (English fixture)", () => {
  const en = [
    "Name,Test Date,Equipment,Weight,PBF (%),SMM,Body Fat Mass,Visceral Fat Level,Total Body Water,Protein,Minerals,BMR,Phase Angle,InBody Score,Waist",
    "Ana Garcia,2026-04-12 10:30:00,InBody 770,76.4,32.1,24.6,24.5,11,38.2,11.4,3.4,1420,5.2,72,82.5",
  ].join("\n");

  it("maps English column headers to the same canonical fields", () => {
    const { rows } = parseInBodyCSV(en);
    expect(rows).toHaveLength(1);
    expect(rows[0].weight_kg).toBe(76.4);
    expect(rows[0].body_fat_pct).toBe(32.1);
    expect(rows[0].skeletal_muscle_kg).toBe(24.6);
    expect(rows[0].visceral_fat_level).toBe(11);
    expect(rows[0].inbody_score).toBe(72);
    expect(rows[0].device_model).toBe("InBody 770");
  });
});

describe("parseInBodyCSV — forensic raw_extra", () => {
  it("preserves unmapped columns under raw_extra", () => {
    const csv = [
      "Nombre,Fecha de prueba,Peso,Algo Raro,Otra Cosa",
      "Ana García,12/04/2026,76.4,foo,bar",
    ].join("\n");
    const { rows } = parseInBodyCSV(csv);
    expect(rows[0].raw_extra).toEqual({ "Algo Raro": "foo", "Otra Cosa": "bar" });
  });

  it("omits raw_extra when no unknown columns are present", () => {
    const csv = "Nombre,Fecha de prueba,Peso\nAna,12/04/2026,76.4";
    const { rows } = parseInBodyCSV(csv);
    expect(rows[0].raw_extra).toBeUndefined();
  });
});

describe("parseInBodyCSV — null-safety on missing values", () => {
  it("treats blank numeric cells as null, never zero", () => {
    const csv = [
      "Nombre,Fecha de prueba,Peso,PGC (%),MME",
      "Ana,12/04/2026,76.4,,",
    ].join("\n");
    const { rows } = parseInBodyCSV(csv);
    expect(rows[0].weight_kg).toBe(76.4);
    expect(rows[0].body_fat_pct).toBeUndefined();
    expect(rows[0].skeletal_muscle_kg).toBeUndefined();
  });

  it("skips rows without a parsable date and logs a warning", () => {
    const csv = [
      "Nombre,Fecha de prueba,Peso",
      "Ana,not-a-date,76.4",
      "Ana,12/04/2026,77.0",
    ].join("\n");
    const { rows, warnings } = parseInBodyCSV(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].weight_kg).toBe(77);
    expect(warnings).toContain("row_without_date");
  });
});

describe("parseFromRows — XLSX-shaped input (native Date / number cells)", () => {
  // Mirrors the shape `read-excel-file` returns: header row of strings,
  // data rows where date cells are real JS Date objects and numeric
  // cells are real JS numbers. The shared parseFromRows path must
  // accept that without losing precision or coercing through "76.4".
  const header = [
    "Nombre", "Fecha de prueba", "Modelo", "Peso", "PGC (%)", "MME",
    "Nivel de Grasa Visceral", "TMB", "Puntuación",
  ];

  it("preserves native number cells (no false zero, no rounding drift)", () => {
    const cells = [
      header,
      ["Ana García", new Date("2026-04-12T10:30:00Z"), "InBody 770",
       76.4, 32.1, 24.6, 11, 1420, 72],
    ];
    const { rows } = parseFromRows(cells);
    expect(rows).toHaveLength(1);
    expect(rows[0].weight_kg).toBe(76.4);
    expect(rows[0].body_fat_pct).toBe(32.1);
    expect(rows[0].skeletal_muscle_kg).toBe(24.6);
    expect(rows[0].visceral_fat_level).toBe(11);
    expect(rows[0].basal_metabolic_rate_kcal).toBe(1420);
    expect(rows[0].inbody_score).toBe(72);
  });

  it("accepts a native Date for scanned_at", () => {
    const cells = [
      header,
      ["Ana", new Date("2026-04-12T10:30:00Z"), "770", 76.4, 32, 24, 11, 1400, 70],
    ];
    const { rows } = parseFromRows(cells);
    expect(rows[0].scanned_at).toBe("2026-04-12T10:30:00.000Z");
  });

  it("emits row_without_date when a Date cell is invalid", () => {
    const cells = [
      header,
      ["Ana", new Date("nope"), "770", 76.4, 32, 24, 11, 1400, 70],
    ];
    const { rows, warnings } = parseFromRows(cells);
    expect(rows).toHaveLength(0);
    expect(warnings).toContain("row_without_date");
  });

  it("treats null cells as missing (never coerces to 0)", () => {
    const cells = [
      header,
      ["Ana", new Date("2026-04-12T10:30:00Z"), "770", 76.4, null, null, null, null, null],
    ];
    const { rows } = parseFromRows(cells);
    expect(rows[0].weight_kg).toBe(76.4);
    expect(rows[0].body_fat_pct).toBeUndefined();
    expect(rows[0].skeletal_muscle_kg).toBeUndefined();
    expect(rows[0].visceral_fat_level).toBeUndefined();
  });

  it("preserves unmapped XLSX cells under raw_extra (stringified)", () => {
    const cells = [
      ["Nombre", "Fecha de prueba", "Peso", "Algo Raro"],
      ["Ana", new Date("2026-04-12T10:30:00Z"), 76.4, 99.5],
    ];
    const { rows } = parseFromRows(cells);
    // Numbers in raw_extra get stringified for jsonb stability.
    expect(rows[0].raw_extra).toEqual({ "Algo Raro": "99.5" });
  });

  it("rounds a fractional integer-field cell (defensive — Excel sometimes stores ints as floats)", () => {
    const cells = [
      ["Nombre", "Fecha de prueba", "Peso", "Nivel de Grasa Visceral"],
      ["Ana", new Date("2026-04-12T10:30:00Z"), 76.4, 11.0],
    ];
    const { rows } = parseFromRows(cells);
    expect(rows[0].visceral_fat_level).toBe(11);
  });
});

describe("parseInBodyDate — Date-object passthrough", () => {
  it("accepts a JS Date directly", () => {
    expect(parseInBodyDate(new Date("2026-04-12T10:30:00Z")))
      .toBe("2026-04-12T10:30:00.000Z");
  });
  it("returns null for an invalid Date", () => {
    expect(parseInBodyDate(new Date("nope"))).toBeNull();
  });
});

describe("parseNumber — native-number passthrough", () => {
  it("accepts a JS number directly", () => {
    expect(parseNumber(76.4)).toBe(76.4);
    expect(parseNumber(0)).toBe(0);
    expect(parseNumber(-3.5)).toBe(-3.5);
  });
  it("rejects non-finite numbers", () => {
    expect(parseNumber(NaN)).toBeNull();
    expect(parseNumber(Infinity)).toBeNull();
  });
});

describe("parseInBodyCSV — graceful degradation", () => {
  it("returns empty rows + warning on null input", () => {
    expect(parseInBodyCSV(null)).toEqual({ rows: [], warnings: ["empty"], totalRows: 0 });
  });

  it("returns empty rows + warning when there are no data rows", () => {
    const result = parseInBodyCSV("just,a,header");
    expect(result.rows).toEqual([]);
    expect(result.warnings).toContain("no_data_rows");
  });

  it("warns when no weight column is present", () => {
    const csv = "Nombre,Fecha de prueba\nAna,12/04/2026";
    const { warnings } = parseInBodyCSV(csv);
    expect(warnings).toContain("no_weight_column");
  });
});
