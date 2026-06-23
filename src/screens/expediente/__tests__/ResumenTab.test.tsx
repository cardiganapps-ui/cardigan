/**
 * @vitest-environment happy-dom
 *
 * Patient expediente → Resumen tab. Guards the two money tiles a
 * therapist reads at a glance on a patient's profile:
 *   collected = patient.paid
 *   balance   = patient.amountDue   (when nothing is overpaid)
 *   credit    = patient.credit      (tile flips when the patient overpaid)
 * Only ever TWO stat tiles render — collected, then balance OR credit.
 * matchMedia → reduced-motion so the AnimatedNumber tiles snap.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderWithCardigan } from "../../../test/renderWithCardigan";
import { formatMXN } from "../../../utils/format";
import { ResumenTab } from "../ResumenTab";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.stubGlobal("requestAnimationFrame", (cb: any) => { cb(0); return 0; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// profession with no anthropometrics so the health block (which would
// want measurements) stays out of the way.
const ctx = { profession: "psychologist" };

const baseProps = {
  upcomingSessions: [],
  dateFrom: null,
  setDateFrom: vi.fn(),
  dateTo: null,
  setDateTo: vi.fn(),
  earliestISO: null,
  filteredSessions: [],
  onRecordPayment: vi.fn(),
  onGoToSesiones: vi.fn(),
  onGoToArchivo: vi.fn(),
  mutating: false,
};

function patient(over: Record<string, unknown> = {}) {
  return { id: "p1", name: "Ana", initials: "AN", colorIdx: 0, scheduling_mode: "recurring", rate: 1000, paid: 0, amountDue: 0, credit: 0, ...over };
}

describe("expediente ResumenTab — patient money tiles", () => {
  it("shows collected (paid) and the outstanding balance for a patient who owes", () => {
    const { container } = renderWithCardigan(
      <ResumenTab patient={patient({ paid: 800, amountDue: 200, credit: 0 })} {...baseProps} />, ctx,
    );
    const kpis = container.querySelectorAll(".stat-tile-val");
    expect(kpis[0].textContent).toContain(formatMXN(800)); // collected
    expect(kpis[1].textContent).toContain(formatMXN(200)); // balance
    // Balance tile, not the credit tile → no leading "+".
    expect(kpis[1].textContent?.trim().startsWith("+")).toBe(false);
  });

  it("flips the second tile to a credit (+amount) when the patient overpaid", () => {
    const { container } = renderWithCardigan(
      <ResumenTab patient={patient({ paid: 1000, amountDue: 0, credit: 300 })} {...baseProps} />, ctx,
    );
    const kpis = container.querySelectorAll(".stat-tile-val");
    expect(kpis[0].textContent).toContain(formatMXN(1000)); // collected
    expect(kpis[1].textContent).toContain(formatMXN(300));  // credit
    expect(kpis[1].textContent?.trim().startsWith("+")).toBe(true);
  });
});
