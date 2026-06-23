/**
 * @vitest-environment happy-dom
 *
 * Patients screen — the roster list. Guards the list DISPLAY + filter
 * behavior through CardiganContext (29 keys):
 *   - the default "all" lane shows active/ended patients with their
 *     per-session rate, and EXCLUDES potentials/discarded (those live in
 *     their own lane),
 *   - the "Con deuda" (owes) filter narrows to amountDue > 0 and surfaces
 *     the owed amount.
 *
 * Rendered through renderWithCardigan. rAF + matchMedia are stubbed for
 * the swipe/long-press row plumbing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent } from "@testing-library/react";
import { renderWithCardigan } from "../../test/renderWithCardigan";
import { formatMXN } from "../../utils/format";
import { PATIENT_STATUS } from "../../data/constants";
import { Patients } from "../Patients";

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
  { id: "p1", name: "Ana López",  initials: "AL", rate: 1000, amountDue: 1200, paid: 0,    credit: 0, status: PATIENT_STATUS.ACTIVE, colorIdx: 0 },
  { id: "p2", name: "Beto Ruiz",  initials: "BR", rate: 800,  amountDue: 0,    paid: 1600, credit: 0, status: PATIENT_STATUS.ACTIVE, colorIdx: 1 },
  { id: "p3", name: "Zoe Potencial", initials: "ZP", rate: 0, amountDue: 5000, paid: 0,    credit: 0, status: PATIENT_STATUS.POTENTIAL, colorIdx: 2 },
];

function renderPatients(ctx = {}) {
  return renderWithCardigan(<Patients />, { patients, ...ctx });
}

describe("Patients — roster list", () => {
  it("lists active patients with their rate and excludes potentials by default", () => {
    const { container, getByText, queryByText } = renderPatients();
    const titles = Array.from(container.querySelectorAll(".row-title")).map((n) => n.textContent);

    expect(titles).toContain("Ana López");
    expect(titles).toContain("Beto Ruiz");
    // Potential lives in its own lane — not in the default list.
    expect(titles).not.toContain("Zoe Potencial");

    // Per-session rate renders in the row subtitle.
    expect(getByText(new RegExp(formatMXN(1000).replace("$", "\\$")))).toBeTruthy();
    expect(queryByText("Zoe Potencial")).toBeNull();
  });

  it("narrows to debtors and shows the owed amount under the 'Con deuda' filter", () => {
    const { container, getByText } = renderPatients();

    fireEvent.click(getByText("Con deuda"));

    const titles = Array.from(container.querySelectorAll(".row-title")).map((n) => n.textContent);
    expect(titles).toEqual(["Ana López"]); // only the debtor (amountDue > 0)
    // The owed amount is surfaced (red balance span).
    expect(getByText(formatMXN(1200))).toBeTruthy();
  });

  it("renders the empty state (no list, no filters) when there are no patients", () => {
    const { container, queryByText } = renderPatients({ patients: [] });
    // Early-return empty branch: no roster rows and no filter chips.
    expect(container.querySelectorAll(".row-title").length).toBe(0);
    expect(queryByText("Con deuda")).toBeNull();
    // The empty-state illustration renders.
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
