/**
 * @vitest-environment happy-dom
 *
 * Finances → Resumen (P&L) tab. Guards the backward-looking
 * profit-and-loss math for the "this month" period:
 *   income  = Σ payments in range
 *   egresos = Σ BUSINESS expenses in range  (personal excluded — a
 *             personal Uber must never land on the business P&L)
 *   profit  = income − egresos
 *
 * Fixtures are dated relative to the runtime clock (today = in range;
 * ~40 days ago = a prior month = out of range) so the assertions hold
 * regardless of the wall-clock date. matchMedia is stubbed to
 * reduced-motion so the AnimatedNumber KPIs snap to their final value.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderWithCardigan } from "../../../test/renderWithCardigan";
import { formatMXN } from "../../../utils/format";
import { isoToShortDate } from "../../../utils/dates";
import { TAX_TREATMENT } from "../../../data/constants";
import { ResumenTab } from "../ResumenTab";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.stubGlobal("requestAnimationFrame", (cb: any) => { cb(0); return 0; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function shortDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return isoToShortDate(iso);
}

const TODAY = shortDaysAgo(0);
const PRIOR_MONTH = shortDaysAgo(40); // always lands in a previous month

function fixtures() {
  return {
    payments: [
      { id: "pay1", date: TODAY, amount: 1000, patient_id: "p1" },
      { id: "pay2", date: TODAY, amount: 500, patient_id: "p2" },
      // Out of range (prior month) — excluded from "this month".
      { id: "pay-old", date: PRIOR_MONTH, amount: 9999, patient_id: "p1" },
    ],
    expenses: [
      { id: "e1", date: TODAY, amount: 300, category: "consultorio", tax_treatment: TAX_TREATMENT.DEDUCTIBLE },
      // Personal — excluded from the business P&L even though in range.
      { id: "e2", date: TODAY, amount: 200, category: "transporte", tax_treatment: TAX_TREATMENT.PERSONAL },
    ],
    patients: [
      { id: "p1", name: "Ana", colorIdx: 0 },
      { id: "p2", name: "Beto", colorIdx: 1 },
    ],
    upcomingSessions: [],
  };
}

describe("ResumenTab — P&L (this month)", () => {
  it("income sums in-range payments; egresos excludes personal; profit = income − egresos", () => {
    const f = fixtures();
    const { container } = renderWithCardigan(
      <ResumenTab payments={f.payments} expenses={f.expenses} patients={f.patients} upcomingSessions={f.upcomingSessions} />,
    );

    const kpis = container.querySelectorAll(".stat-tile-val");
    // income = 1000 + 500 = 1500 (the 9999 prior-month payment is excluded)
    expect(kpis[0].textContent).toContain(formatMXN(1500));
    // egresos = 300 (the 200 personal expense is excluded)
    expect(kpis[1].textContent).toContain(formatMXN(300));
    // profit = 1500 − 300 = 1200
    expect(kpis[2].textContent).toContain(formatMXN(1200));
  });

  it("shows a negative profit when expenses exceed income", () => {
    const { container, getByText } = renderWithCardigan(
      <ResumenTab
        payments={[{ id: "pay1", date: TODAY, amount: 100, patient_id: "p1" }]}
        expenses={[{ id: "e1", date: TODAY, amount: 500, category: "renta", tax_treatment: TAX_TREATMENT.DEDUCTIBLE }]}
        patients={[{ id: "p1", name: "Ana", colorIdx: 0 }]}
        upcomingSessions={[]}
      />,
    );
    // profit = 100 − 500 = −400 → label flips to "Pérdida"/negative copy and the abs value renders.
    const kpis = container.querySelectorAll(".stat-tile-val");
    expect(kpis[2].textContent).toContain(formatMXN(400));
    // The negative-profit label is used (gastos.profitNegative).
    expect(getByText(/pérdida/i)).toBeTruthy();
  });
});
