/**
 * @vitest-environment happy-dom
 *
 * Finances screen — the practice's money dashboard. Guards the
 * "Balances" tab DISPLAY path end-to-end through CardiganContext (the
 * first SCREEN-level test wired through renderWithCardigan):
 *   - "Outstanding" KPI = Σ amountDue over ACTIVE patients (potentials
 *     are excluded so an un-converted interview can't inflate the total).
 *   - "Up to date" count = active patients with amountDue ≤ 0.
 *   - The Por-cobrar list shows the owing patients, names + amounts,
 *     sorted by amount descending.
 *
 * AnimatedNumber count-up only settles over multiple rAF frames, so we
 * stub matchMedia to report prefers-reduced-motion → useAnimatedNumber
 * snaps straight to the target and the KPI renders its final value.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderWithCardigan } from "../../test/renderWithCardigan";
import { formatMXN } from "../../utils/format";
import { PATIENT_STATUS } from "../../data/constants";
import { Finances } from "../Finances";

beforeEach(() => {
  // Reduced-motion → AnimatedNumber snaps to target (no rAF wait).
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  // SwipeableRow / list rows use rAF for the peek hint.
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
  { id: "p1", name: "Ana López",  initials: "AL", amountDue: 1200, paid: 600,  credit: 0, status: PATIENT_STATUS.ACTIVE },
  { id: "p2", name: "Beto Ruiz",  initials: "BR", amountDue: 800,  paid: 0,    credit: 0, status: PATIENT_STATUS.ACTIVE },
  { id: "p3", name: "Carla Díaz", initials: "CD", amountDue: 0,    paid: 1500, credit: 0, status: PATIENT_STATUS.ACTIVE },
  // Potential — must NOT count toward Outstanding or appear in the lists.
  { id: "p4", name: "Zoe Potencial", initials: "ZP", amountDue: 5000, paid: 0, credit: 0, status: PATIENT_STATUS.POTENTIAL },
];

describe("Finances — Balances tab", () => {
  it("sums Outstanding over active patients only (potentials excluded)", () => {
    const { container } = renderWithCardigan(<Finances />, { patients });

    // Outstanding = 1200 + 800 + 0 = 2000 (the 5000 potential is excluded).
    const kpis = container.querySelectorAll(".fin-stats-grid .stat-tile-val");
    expect(kpis[0].textContent).toContain(formatMXN(2000));
    // Up-to-date count among active patients = 1 (Carla).
    expect(kpis[1].textContent).toContain("1");
  });

  it("lists owing patients with amounts, sorted descending; up-to-date separately", () => {
    const { container, queryByText, getByText } = renderWithCardigan(<Finances />, { patients });

    const owingRows = container.querySelectorAll(".finances-balances-col .bal-row .bal-name");
    // Por-cobrar (Ana 1200, Beto 800) sorted desc, then Al-corriente (Carla).
    const names = Array.from(container.querySelectorAll(".bal-name")).map((n) => n.textContent);
    expect(names).toContain("Ana López");
    expect(names).toContain("Beto Ruiz");
    expect(names).toContain("Carla Díaz");
    // The owing list shows Ana before Beto (1200 > 800).
    expect(owingRows[0].textContent).toBe("Ana López");

    // Amounts render via plain formatMXN in the row.
    expect(getByText(formatMXN(1200))).toBeTruthy();
    expect(getByText(formatMXN(800))).toBeTruthy();

    // The potential patient never surfaces.
    expect(queryByText("Zoe Potencial")).toBeNull();
  });

  it("renders the empty state when there are no active patients", () => {
    const { container } = renderWithCardigan(<Finances />, {
      patients: [{ id: "z", name: "Zoe", status: PATIENT_STATUS.POTENTIAL, amountDue: 100 }],
    });
    // Outstanding is 0 and no balance rows render.
    const kpis = container.querySelectorAll(".fin-stats-grid .stat-tile-val");
    expect(kpis[0].textContent).toContain(formatMXN(0));
    expect(container.querySelectorAll(".bal-row").length).toBe(0);
  });
});
