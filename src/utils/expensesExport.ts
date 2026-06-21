/* ── Expenses CSV export ──

   Pure helper: takes a list of expense rows + a category-label resolver
   and returns a CSV string ready for a Blob download. Used by the
   "Exportar para mi contador" button on the Resumen tab. Spanish column
   headers because the audience is the Mexican contador, not the
   therapist's UI. RFC 4180 escape rules: any field containing a comma,
   double quote, or newline is wrapped in double quotes; embedded
   double quotes are doubled.

   No I/O, no React. Tests in __tests__/expensesExport.test.js cover
   escape edge cases — change either the column order or the escape
   rules and you'll need to update those tests in lock-step (CSVs that
   silently shift columns wreck the contador's spreadsheet).
*/

/** Expense-row fields the CSV reads (a subset of an expenses row). */
export interface ExpenseRow {
  date?: string | null;
  category?: string | null;
  description?: string | null;
  payment_method?: string | null;
  amount?: number | null;
  tax_treatment?: string | null;
  cfdi_uuid?: string | null;
  note?: string | null;
  period_year?: number | null;
  period_month?: number | null;
  created_at?: string | null;
}

const HEADERS = ["Fecha", "Categoría", "Descripción", "Método", "Monto", "Deducible", "CFDI", "Nota"];

const TREATMENT_LABEL: Record<string, string> = {
  deductible: "Sí",
  non_deductible: "No",
  personal: "Personal",
};

function escapeCell(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Given a list of expenses and a label resolver for categories, build
// the CSV. `expenses` is sorted ascending by date so the contador sees
// chronological flow; if the caller wants a different order they sort
// before passing in.
export function buildExpensesCsv(
  expenses: ExpenseRow[] | null | undefined,
  getCategoryLabel: (k: string) => string = (k) => k,
): string {
  const rows = [HEADERS.join(",")];
  const sorted = [...(expenses || [])].sort((a, b) => {
    // We can't compare "8-Abr" lexically; use period_year/period_month
    // when present, fall back to created_at.
    const ay = a.period_year || 0, am = a.period_month || 0;
    const by = b.period_year || 0, bm = b.period_month || 0;
    if (ay !== by) return ay - by;
    if (am !== bm) return am - bm;
    return (a.created_at || "").localeCompare(b.created_at || "");
  });
  for (const e of sorted) {
    const tt = e.tax_treatment || "";
    const treatment = TREATMENT_LABEL[tt] || tt;
    rows.push([
      escapeCell(e.date),
      escapeCell(getCategoryLabel(e.category || "")),
      escapeCell(e.description),
      escapeCell(e.payment_method),
      escapeCell(e.amount),
      escapeCell(treatment),
      escapeCell(e.cfdi_uuid),
      escapeCell(e.note),
    ].join(","));
  }
  // Trailing newline so editors with "ensure final newline" don't show
  // a bogus diff when a contador resaves the file.
  return rows.join("\n") + "\n";
}

// Trigger a browser download of the CSV. Side-effecting — kept here so
// the call site is a one-liner (`downloadExpensesCsv(...)`).
export function downloadExpensesCsv(csv: string, filename: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  // Prepend a UTF-8 BOM so Excel (Windows) opens the file with the
  // right encoding for tildes and accents. Numbers/Sheets handle
  // either way.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Tab GC takes its time releasing blob URLs — explicit revoke after
  // a tick avoids a slow leak on heavy-export users.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
