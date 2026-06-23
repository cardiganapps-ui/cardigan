/**
 * @vitest-environment happy-dom
 *
 * Home screen KPI band. Home reads 25 keys off CardiganContext and
 * derives the four headline numbers a therapist sees first:
 *   - sessions today        = upcomingSessions on TODAY's date
 *   - active patients       = patients with status "active"
 *   - collected this month  = Σ payments whose created_at is this month
 *   - outstanding           = Σ amountDue over ACTIVE patients (potentials
 *                             excluded so an un-converted interview can't
 *                             inflate the global total)
 *
 * Rendered through renderWithCardigan. matchMedia is stubbed to
 * reduced-motion so the AnimatedNumber KPIs snap to their final value.
 * The agenda is left empty so the test targets the money math, not the
 * (separately-tested) session-row rendering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderWithCardigan } from "../../test/renderWithCardigan";
import { formatMXN } from "../../utils/format";
import { PATIENT_STATUS } from "../../data/constants";
import { Home } from "../Home";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.stubGlobal("requestAnimationFrame", (cb: any) => { cb(0); return 0; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  try { localStorage.setItem("cardigan.swipe.hint.shown", "1"); } catch { /* ignore */ }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const patients = [
  { id: "p1", name: "Ana López", initials: "AL", amountDue: 1200, paid: 0, credit: 0, status: PATIENT_STATUS.ACTIVE, colorIdx: 0 },
  { id: "p2", name: "Beto Ruiz", initials: "BR", amountDue: 0, paid: 1000, credit: 0, status: PATIENT_STATUS.ACTIVE, colorIdx: 1 },
  // Potential — excluded from BOTH the active count and the outstanding total.
  { id: "p3", name: "Zoe Potencial", initials: "ZP", amountDue: 5000, paid: 0, credit: 0, status: PATIENT_STATUS.POTENTIAL, colorIdx: 2 },
];

// Payment this month (counts) + one from last year (excluded).
const now = new Date();
const lastYear = new Date(now.getFullYear() - 1, now.getMonth(), 15);
const payments = [
  { id: "pay1", amount: 800, date: "1-Ene", created_at: now.toISOString() },
  { id: "pay-old", amount: 9999, date: "1-Ene", created_at: lastYear.toISOString() },
];

function renderHome(ctx = {}) {
  return renderWithCardigan(<Home setScreen={() => {}} userName="Dra. Díaz" />, {
    patients, payments, upcomingSessions: [], ...ctx,
  });
}

describe("Home — KPI band", () => {
  it("renders the four headline KPIs from context data", () => {
    const { container } = renderHome();
    const values = Array.from(container.querySelectorAll(".kpi-card .kpi-value")).map((n) => n.textContent);

    // Order: sessions today, active patients, collected this month, outstanding.
    expect(values[0]).toContain("0");                 // no sessions today
    expect(values[1]).toContain("2");                 // p1 + p2 active (potential excluded)
    expect(values[2]).toContain(formatMXN(800));      // current-month payment only
    expect(values[3]).toContain(formatMXN(1200));     // outstanding over active patients
  });

  it("excludes potentials from the outstanding total", () => {
    const { container } = renderHome();
    const values = Array.from(container.querySelectorAll(".kpi-card .kpi-value")).map((n) => n.textContent);
    // The 5000 potential balance must NOT appear in outstanding.
    expect(values[3]).not.toContain(formatMXN(5000));
    expect(values[3]).toContain(formatMXN(1200));
  });

  it("shows zero outstanding when every active patient is settled", () => {
    const { container } = renderHome({
      patients: [{ id: "p1", name: "Ana", initials: "AL", amountDue: 0, paid: 500, credit: 0, status: PATIENT_STATUS.ACTIVE, colorIdx: 0 }],
    });
    const values = Array.from(container.querySelectorAll(".kpi-card .kpi-value")).map((n) => n.textContent);
    expect(values[3]).toContain(formatMXN(0));
  });
});
