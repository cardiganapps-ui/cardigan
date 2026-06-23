/**
 * @vitest-environment happy-dom
 *
 * Finances → Proyección (forward revenue forecast) tab. Guards the
 * forward-looking projection math for the default "1m" window:
 *   gross   = Σ rate over FUTURE scheduled, non-interview sessions of
 *             projectable (non-potential/discarded) patients, in window
 *   net     = round(gross × (1 − cancelRate))
 *   cancelRate = historical (cancelled / resolved over PAST sessions),
 *                overridable via the slider
 *   avgRate = round(gross / futureSessionCount)
 *
 * Fixtures are dated relative to the runtime clock (ahead = in window,
 * ago = past/historical) so the assertions hold regardless of the
 * wall-clock date. matchMedia is stubbed to reduced-motion so the
 * AnimatedNumber KPIs snap to their final value.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderWithCardigan } from "../../../test/renderWithCardigan";
import { formatMXN } from "../../../utils/format";
import { isoToShortDate } from "../../../utils/dates";
import { SESSION_TYPE, PATIENT_STATUS } from "../../../data/constants";
import { ProyeccionTab } from "../ProyeccionTab";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.stubGlobal("requestAnimationFrame", (cb: any) => { cb(0); return 0; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function shortDaysFromNow(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return isoToShortDate(iso);
}
const AHEAD_5 = shortDaysFromNow(5);
const AHEAD_10 = shortDaysFromNow(10);
const AGO_10 = shortDaysFromNow(-10);

const ANA = { id: "p1", name: "Ana", initials: "AN", colorIdx: 0, status: PATIENT_STATUS.ACTIVE, rate: 1000 };
const LEAD = { id: "p2", name: "Beto", initials: "BE", colorIdx: 1, status: PATIENT_STATUS.POTENTIAL, rate: 800 };

function futureRegular(id: string, date: string, over: Record<string, unknown> = {}) {
  return { id, patient_id: "p1", patient: "Ana", initials: "AN", colorIdx: 0, status: "scheduled", session_type: SESSION_TYPE.REGULAR, date, rate: 1000, ...over };
}

describe("ProyeccionTab — revenue forecast (1m)", () => {
  it("gross sums future scheduled sessions; net = gross when there's no cancellation history; avg per session", () => {
    const sessions = [
      futureRegular("s1", AHEAD_5),
      futureRegular("s2", AHEAD_10),
      // Interview session — one-off, excluded from the recurring forecast.
      futureRegular("s3", AHEAD_5, { session_type: SESSION_TYPE.INTERVIEW }),
      // Potential lead's session — excluded (don't forecast unconverted leads).
      futureRegular("s4", AHEAD_10, { patient_id: "p2", patient: "Beto", rate: 800 }),
    ];
    const { container } = renderWithCardigan(<ProyeccionTab sessions={sessions} patients={[ANA, LEAD]} />);
    const kpis = container.querySelectorAll(".stat-tile-val");
    // gross = 1000 + 1000 = 2000 (interview + potential excluded)
    expect(kpis[0].textContent).toContain(formatMXN(2000));
    // no past sessions → historical cancel rate 0 → net = gross
    expect(kpis[1].textContent).toContain(formatMXN(2000));
    // avg = 2000 / 2 sessions = 1000
    expect(kpis[3].textContent).toContain(formatMXN(1000));
  });

  it("applies the historical cancellation rate to net", () => {
    const sessions = [
      futureRegular("s1", AHEAD_5),
      futureRegular("s2", AHEAD_10),
      // Past resolved history: 3 completed + 1 cancelled → 25% cancel rate.
      { id: "h1", patient_id: "p1", status: "completed", date: AGO_10 },
      { id: "h2", patient_id: "p1", status: "completed", date: AGO_10 },
      { id: "h3", patient_id: "p1", status: "completed", date: AGO_10 },
      { id: "h4", patient_id: "p1", status: "cancelled", date: AGO_10 },
    ];
    const { container, getAllByText, getByText } = renderWithCardigan(<ProyeccionTab sessions={sessions} patients={[ANA]} />);
    const kpis = container.querySelectorAll(".stat-tile-val");
    // gross = 2000, cancelRate = 1/4 → net = round(2000 × 0.75) = 1500
    expect(kpis[0].textContent).toContain(formatMXN(2000));
    expect(kpis[1].textContent).toContain(formatMXN(1500));
    // Historical rate surfaced as "25%" (slider header + historical line)
    // with the (cancelled/resolved) tally.
    expect(getAllByText(/25%/).length).toBeGreaterThan(0);
    expect(getByText(/1\/4/)).toBeTruthy();
  });

  it("renders the empty forecast (zero gross, no breakdown rows) when nothing is scheduled", () => {
    const { container } = renderWithCardigan(<ProyeccionTab sessions={[]} patients={[ANA]} />);
    const kpis = container.querySelectorAll(".stat-tile-val");
    expect(kpis[0].textContent).toContain(formatMXN(0));
    expect(container.querySelectorAll(".bal-row").length).toBe(0);
  });
});
