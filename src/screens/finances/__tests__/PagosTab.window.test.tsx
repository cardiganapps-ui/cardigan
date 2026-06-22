/**
 * @vitest-environment happy-dom
 *
 * PagosTab IntersectionObserver windowing — perf guard.
 *
 * The payments ledger lazy-loads its rows: first paint renders only
 * FINANCES_INITIAL_WINDOW (60) rows, and an IntersectionObserver
 * sentinel pulls FINANCES_WINDOW_INCREMENT more as the user scrolls.
 * Rendering every row up-front was the worst scroll-jank source on iOS
 * Safari (a therapist with 1000+ payments paid ~500ms layout cost on
 * tab open), so this test locks the window in: given ~1000 payments,
 * the DOM must render at most FINANCES_INITIAL_WINDOW `.bal-row`
 * elements, NOT all 1000.
 *
 * happy-dom has no IntersectionObserver, and PagosTab guards on that
 * (`typeof IntersectionObserver === "undefined"`), so the window can
 * never grow here — the initial-window count is exactly what's asserted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import { I18nProvider } from "../../../i18n/index";
import { isoToShortDate } from "../../../utils/dates";
import { PagosTab } from "../PagosTab";
import { FINANCES_INITIAL_WINDOW } from "../financesShared";

beforeEach(() => {
  // SwipeableRow rows use rAF + the discoverability peek.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.stubGlobal("requestAnimationFrame", (cb: any) => { cb(0); return 0; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  try { localStorage.setItem("cardigan.swipe.hint.shown", "1"); } catch { /* ignore */ }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Short-date ("D-MMM") string offset N days back from today, so every
// fixture payment lands inside the default "all" window deterministically.
function shortDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return isoToShortDate(iso);
}

// ~1000 payments spread over the last ~1000 days, distinct patients so
// the default (ungrouped) list renders one row each.
function makePayments(n = 1000) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `pay-${i}`,
      patient: `Paciente ${i}`,
      patient_id: `p-${i}`,
      colorIdx: i % 8,
      date: shortDaysAgo(i),
      method: "Efectivo",
      amount: 600,
    });
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

function renderTab(props: Row = {}) {
  let res!: ReturnType<typeof render>;
  act(() => {
    res = render(
      <I18nProvider>
        <PagosTab
          payments={makePayments()}
          patients={[]}
          onRecordPayment={() => {}}
          onEditPayment={() => {}}
          onDeletePayment={() => {}}
          mutating={false}
          onAddFirstPatient={() => {}}
          {...props}
        />
      </I18nProvider>,
    );
  });
  return res;
}

describe("PagosTab windowing", () => {
  it("renders at most FINANCES_INITIAL_WINDOW rows for ~1000 payments", () => {
    const { container } = renderTab();
    const rows = container.querySelectorAll(".bal-row");
    // The windowing must cap the initial paint — NOT render all 1000.
    expect(rows.length).toBe(FINANCES_INITIAL_WINDOW);
    expect(rows.length).toBeLessThan(1000);
  });
});
