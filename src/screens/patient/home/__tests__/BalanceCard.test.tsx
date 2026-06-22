/**
 * @vitest-environment happy-dom
 *
 * The money three-state on the patient home screen. BalanceCard renders
 * exactly one of: "owes" (amountDue > 0), "credit" (credit > 0), or
 * "even" (both zero). Each state pairs a formatted figure with a Spanish
 * label, and the integrity of those numbers is what therapists & patients
 * trust — so we pin the exact formatMXN output + label for all three.
 *
 * The value figure is rendered through <AnimatedNumber>, which count-up
 * animates 0 → target via requestAnimationFrame. We stub rAF to run the
 * tick synchronously so the final (settled) value lands within act() and
 * we assert on the real number, not a mid-flight frame.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import { I18nProvider } from "../../../../i18n/index";
import { formatMXN } from "../../../../utils/format";
import { BalanceCard } from "../BalanceCard";

beforeEach(() => {
  // Drive AnimatedNumber's rAF count-up straight to completion: invoking
  // the callback with a timestamp far past the start makes t >= 1 on the
  // first tick, so the span renders the settled target value.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.stubGlobal("requestAnimationFrame", (cb: any) => { cb(1e9); return 0; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

function renderCard(props: Row = {}) {
  let res!: ReturnType<typeof render>;
  act(() => {
    res = render(
      <I18nProvider>
        <BalanceCard amountDue={0} credit={0} {...props} />
      </I18nProvider>,
    );
  });
  return res;
}

describe("BalanceCard money three-state", () => {
  it("owes: shows the owed amount via formatMXN + the 'por pagar' label", () => {
    const { container } = renderCard({ amountDue: 1500, credit: 0 });
    expect(container.textContent).toContain(formatMXN(1500)); // "$1,500"
    expect(container.textContent).toContain("Saldo por pagar");
    // The even/credit labels must NOT also appear.
    expect(container.textContent).not.toContain("Estás al corriente");
    expect(container.textContent).not.toContain("Saldo a favor");
  });

  it("even (0/0): shows the 'al día' value + 'al corriente' label", () => {
    const { container } = renderCard({ amountDue: 0, credit: 0 });
    expect(container.textContent).toContain("Al día");
    expect(container.textContent).toContain("Estás al corriente");
    expect(container.textContent).not.toContain("Saldo por pagar");
    expect(container.textContent).not.toContain("Saldo a favor");
  });

  it("credit: shows the credit amount via formatMXN + the 'a favor' label", () => {
    const { container } = renderCard({ amountDue: 0, credit: 800 });
    expect(container.textContent).toContain(formatMXN(800)); // "$800"
    expect(container.textContent).toContain("Saldo a favor");
    expect(container.textContent).not.toContain("Saldo por pagar");
    expect(container.textContent).not.toContain("Estás al corriente");
  });

  it("always renders the 'Saldo' eyebrow label regardless of state", () => {
    const { container } = renderCard({ amountDue: 1500, credit: 0 });
    expect(container.textContent).toContain("Saldo");
  });

  it("renders a pay CTA with the owed amount when onPay is provided", () => {
    const onPay = vi.fn();
    const { getByRole } = renderCard({ amountDue: 1500, credit: 0, onPay });
    const btn = getByRole("button", { name: /Pagar/ });
    expect(btn.textContent).toContain(formatMXN(1500));
    act(() => { btn.click(); });
    expect(onPay).toHaveBeenCalledTimes(1);
  });

  it("shows the per-session rate row when a positive rate is passed", () => {
    const withRate = renderCard({ amountDue: 0, credit: 0, rate: 600 });
    // The "{rate} por sesión" template resolves {rate} against the active
    // profession vocab (→ "Honorarios"), so the row reads as the
    // profession noun + " por sesión". Assert the row renders.
    expect(withRate.container.textContent).toContain("por sesión");
    cleanup();
    // With rate 0 the rate row is suppressed entirely.
    const noRate = renderCard({ amountDue: 0, credit: 0, rate: 0 });
    expect(noRate.container.textContent).not.toContain("por sesión");
  });
});
