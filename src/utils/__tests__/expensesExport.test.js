import { describe, it, expect } from "vitest";
import { buildExpensesCsv } from "../expensesExport";

const cat = (k) => ({
  consultorio: "Consultorio",
  software: "Software",
  insumos: "Insumos",
}[k] || k);

describe("buildExpensesCsv", () => {
  it("emits the documented Spanish header row", () => {
    const csv = buildExpensesCsv([], cat);
    expect(csv.split("\n")[0])
      .toBe("Fecha,Categoría,Descripción,Método,Monto,Deducible,CFDI,Nota");
  });

  it("renders a typical deductible row", () => {
    const csv = buildExpensesCsv([{
      date: "1-Abr",
      category: "consultorio",
      description: "Renta WeWork",
      payment_method: "Transferencia",
      amount: 18000,
      tax_treatment: "deductible",
      cfdi_uuid: "ABCD-1234",
      note: "",
      period_year: 2026, period_month: 4,
    }], cat);
    expect(csv).toContain("1-Abr,Consultorio,Renta WeWork,Transferencia,18000,Sí,ABCD-1234,\n");
  });

  it("escapes commas, quotes, and newlines per RFC 4180", () => {
    const csv = buildExpensesCsv([{
      date: "5-Abr",
      category: "software",
      description: 'Suscripción "Pro", anual',
      payment_method: "Tarjeta",
      amount: 1200,
      tax_treatment: "deductible",
      cfdi_uuid: "",
      note: "Línea 1\nLínea 2",
      period_year: 2026, period_month: 4,
    }], cat);
    expect(csv).toContain('"Suscripción ""Pro"", anual"');
    expect(csv).toContain('"Línea 1\nLínea 2"');
  });

  it("sorts by period (year, month) ascending", () => {
    const csv = buildExpensesCsv([
      { date: "5-May", category: "insumos", amount: 200, tax_treatment: "deductible", period_year: 2026, period_month: 5 },
      { date: "1-Mar", category: "insumos", amount: 100, tax_treatment: "deductible", period_year: 2026, period_month: 3 },
      { date: "1-Abr", category: "insumos", amount: 150, tax_treatment: "deductible", period_year: 2026, period_month: 4 },
    ], cat);
    const lines = csv.trim().split("\n");
    expect(lines[1]).toContain("1-Mar,Insumos,,,100");
    expect(lines[2]).toContain("1-Abr,Insumos,,,150");
    expect(lines[3]).toContain("5-May,Insumos,,,200");
  });

  it("translates tax_treatment to Spanish labels", () => {
    const csv = buildExpensesCsv([
      { date: "1-Abr", category: "otro", amount: 100, tax_treatment: "deductible", period_year: 2026, period_month: 4 },
      { date: "2-Abr", category: "otro", amount: 200, tax_treatment: "non_deductible", period_year: 2026, period_month: 4 },
      { date: "3-Abr", category: "otro", amount: 300, tax_treatment: "personal", period_year: 2026, period_month: 4 },
    ], cat);
    const lines = csv.trim().split("\n");
    expect(lines[1].split(",")[5]).toBe("Sí");
    expect(lines[2].split(",")[5]).toBe("No");
    expect(lines[3].split(",")[5]).toBe("Personal");
  });

  it("emits an empty-list CSV with just the header and a trailing newline", () => {
    const csv = buildExpensesCsv([], cat);
    expect(csv).toMatch(/Nota\n$/);
    expect(csv.split("\n").length).toBe(2);
  });

  it("renders nullish optional fields as empty cells (not 'null'/'undefined')", () => {
    const csv = buildExpensesCsv([{
      date: "1-Abr", category: "insumos", amount: 50,
      tax_treatment: "deductible", period_year: 2026, period_month: 4,
    }], cat);
    const row = csv.trim().split("\n")[1];
    expect(row).toBe("1-Abr,Insumos,,,50,Sí,,");
    expect(row).not.toContain("undefined");
    expect(row).not.toContain("null");
  });
});
