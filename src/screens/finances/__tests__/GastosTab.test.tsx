/**
 * @vitest-environment happy-dom
 *
 * Finances → Gastos (expense ledger) tab. Guards the two KPI sums that
 * therapists reconcile against their accountant:
 *   thisMonth = Σ BUSINESS expenses in the current calendar month
 *   YTD       = Σ BUSINESS expenses since Jan 1
 * Personal-treatment expenses are EXCLUDED from both (they stay in the
 * ledger but never hit the business P&L). Both KPIs are computed from the
 * full expense set, independent of the period/category filters.
 *
 * Fixtures: one expense dated today, one personal (same day), and one in a
 * different month of the SAME year (chosen relative to the clock so it's
 * always YTD-but-not-this-month). matchMedia → reduced-motion so the
 * AnimatedNumber KPIs snap.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderWithCardigan } from "../../../test/renderWithCardigan";
import { formatMXN } from "../../../utils/format";
import { isoToShortDate } from "../../../utils/dates";
import { TAX_TREATMENT } from "../../../data/constants";
import { GastosTab } from "../GastosTab";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.stubGlobal("requestAnimationFrame", (cb: any) => { cb(0); return 0; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const now = new Date();
const TODAY = isoToShortDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
// A different month of the SAME year — always YTD, never "this month".
const otherMonth = now.getMonth() === 0 ? 1 : 0;
const EARLIER_THIS_YEAR = isoToShortDate(`${now.getFullYear()}-${String(otherMonth + 1).padStart(2, "0")}-15`);

const noopProps = {
  recurringExpenses: [],
  onRecord: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  generatePending: vi.fn(),
  onManageRecurring: vi.fn(),
  mutating: false,
};
const ctx = { documents: [], getDocumentUrl: async () => null };

describe("GastosTab — expense ledger KPIs", () => {
  it("thisMonth + YTD sum BUSINESS expenses and EXCLUDE personal ones", () => {
    const expenses = [
      { id: "e1", date: TODAY, amount: 300, category: "consultorio", tax_treatment: TAX_TREATMENT.DEDUCTIBLE },
      // Personal — excluded from both KPIs even though it's this month.
      { id: "e2", date: TODAY, amount: 200, category: "transporte", tax_treatment: TAX_TREATMENT.PERSONAL },
      // Business, earlier this year — in YTD, not in this month.
      { id: "e3", date: EARLIER_THIS_YEAR, amount: 500, category: "renta", tax_treatment: TAX_TREATMENT.DEDUCTIBLE },
    ];
    const { container } = renderWithCardigan(<GastosTab expenses={expenses} {...noopProps} />, ctx);
    const kpis = container.querySelectorAll(".stat-tile-val");
    // thisMonth = 300 (today's business; personal 200 excluded; e3 is a prior month)
    expect(kpis[0].textContent).toContain(formatMXN(300));
    // YTD = 300 + 500 = 800 (personal still excluded)
    expect(kpis[1].textContent).toContain(formatMXN(800));
  });

  it("renders the empty state with zeroed KPIs when there are no expenses", () => {
    const { container, getByText } = renderWithCardigan(<GastosTab expenses={[]} {...noopProps} />, ctx);
    const kpis = container.querySelectorAll(".stat-tile-val");
    expect(kpis[0].textContent).toContain(formatMXN(0));
    expect(kpis[1].textContent).toContain(formatMXN(0));
    expect(getByText("Sin gastos registrados")).toBeTruthy();
  });
});
