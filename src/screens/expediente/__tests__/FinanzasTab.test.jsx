/**
 * @vitest-environment happy-dom
 *
 * Finanzas tab of the patient expediente — the payments ledger view.
 * Guards the money DISPLAY path: the rendered payment count + summed
 * total must match the fixtures exactly, and the period segmented filter
 * must narrow the list to in-window rows (older payments drop out, and
 * the count + total recompute accordingly).
 *
 * Fixtures are built relative to the real runtime `new Date()` (the
 * component reads system time via todayISO() + new Date() for the period
 * cutoff), so a "recent" and an "old" payment land deterministically on
 * the right side of every cutoff regardless of the wall-clock date.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, cleanup, fireEvent } from "@testing-library/react";
import { I18nProvider } from "../../../i18n/index";
import { formatMXN } from "../../../utils/format";
import { isoToShortDate } from "../../../utils/dates";
import { FinanzasTab } from "../FinanzasTab";

beforeEach(() => {
  // SwipeableRow rows inside the list use rAF + the discoverability peek.
  vi.stubGlobal("requestAnimationFrame", (cb) => { cb(0); return 0; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  try { localStorage.setItem("cardigan.swipe.hint.shown", "1"); } catch { /* ignore */ }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Short-date ("D-MMM") strings offset N days back from today.
function shortDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return isoToShortDate(iso);
}

const PATIENT = { id: "p1", name: "Ana", rate: 600 };

function makePayments() {
  return [
    { id: "pay-recent-1", date: shortDaysAgo(2), method: "Efectivo", amount: 600 },
    { id: "pay-recent-2", date: shortDaysAgo(10), method: "Transferencia", amount: 900 },
    // ~150 days back → outside the 1m/3m windows, inside "all".
    { id: "pay-old-1", date: shortDaysAgo(150), method: "Efectivo", amount: 1200 },
  ];
}

function renderTab(props = {}) {
  let res;
  act(() => {
    res = render(
      <I18nProvider>
        <FinanzasTab
          patient={PATIENT}
          pPayments={makePayments()}
          onRecordPayment={() => {}}
          deletePayment={() => {}}
          mutating={false}
          {...props}
        />
      </I18nProvider>,
    );
  });
  return res;
}

describe("FinanzasTab payments ledger", () => {
  it("shows the full count + summed total across all payments (default period)", () => {
    const { container } = renderTab();
    // 3 payments → "3 pagos"
    expect(container.textContent).toContain("3 pago");
    // Total = 600 + 900 + 1200 = 2700, rendered as "+$2,700"
    expect(container.textContent).toContain(`+${formatMXN(2700)}`);
  });

  it("renders one row per payment with its amount", () => {
    const { container } = renderTab();
    const rows = container.querySelectorAll(".bal-row");
    expect(rows.length).toBe(3);
    expect(container.textContent).toContain(formatMXN(600));
    expect(container.textContent).toContain(formatMXN(900));
    expect(container.textContent).toContain(formatMXN(1200));
  });

  it("narrows to in-window payments when a shorter period is selected", () => {
    const { container, getByText } = renderTab();
    // Switch to the 3-month window — the ~150-day-old payment drops out.
    act(() => { fireEvent.click(getByText("3 meses")); });

    const rows = container.querySelectorAll(".bal-row");
    expect(rows.length).toBe(2);
    // "2 pagos" and total recomputed to 600 + 900 = 1500.
    expect(container.textContent).toContain("2 pago");
    expect(container.textContent).toContain(`+${formatMXN(1500)}`);
    // The old payment's amount no longer shows.
    expect(container.textContent).not.toContain(formatMXN(1200));
  });

  it("shows the empty state when no payment falls inside the chosen period", () => {
    // Only an old payment exists; the 1-month window excludes it.
    let res;
    act(() => {
      res = render(
        <I18nProvider>
          <FinanzasTab
            patient={PATIENT}
            pPayments={[{ id: "old", date: shortDaysAgo(150), method: "Efectivo", amount: 1200 }]}
            onRecordPayment={() => {}}
            deletePayment={() => {}}
            mutating={false}
          />
        </I18nProvider>,
      );
    });
    act(() => { fireEvent.click(res.getByText("1 mes")); });
    expect(res.container.textContent).toContain("Sin pagos en este período");
    expect(res.container.querySelectorAll(".bal-row").length).toBe(0);
    res.unmount();
  });
});
