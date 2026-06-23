/**
 * @vitest-environment happy-dom
 *
 * The Plan / Suscripción sheet extracted from Settings.tsx — the largest,
 * most coupled, revenue-critical sheet. This is a PRESENTATIONAL extraction
 * (state + checkout/portal/sync handlers stay in Settings), so the test pins
 * the open/closed gate, the trial checkout surface (pricing toggle + subscribe
 * CTA wired to handleStartCheckout / setSelectedPlan), and the active-sub
 * "Administrar" surface routing to handleOpenPortal.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { I18nProvider } from "../../../../i18n/index";

// ProValueWidget reads CardiganContext (active-sub branch) — out of scope
// for this sheet's contract, so stub it to keep the test provider-free.
vi.mock("../../../../components/ProValueWidget", () => ({ ProValueWidget: () => null }));

import { PlanSheet } from "../PlanSheet";

afterEach(cleanup);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function renderSheet(over: Record<string, unknown> = {}) {
  const props: Any = {
    open: true,
    subscription: { accessState: "trial", compGranted: false, subscribedActive: false },
    subBusy: false,
    subError: "",
    selectedPlan: "monthly",
    setSelectedPlan: vi.fn(),
    inviteCodeInput: "",
    setInviteCodeInput: vi.fn(),
    inviteCodeFromUrl: false,
    syncBusy: false,
    syncDone: false,
    handleStartCheckout: vi.fn(),
    handleOpenPortal: vi.fn(),
    handleSyncWithStripe: vi.fn(),
    setActiveSheet: vi.fn(),
    setSheetPanel: vi.fn(),
    sheetPanelHandlers: {},
    ...over,
  };
  const utils = render(<I18nProvider><PlanSheet {...props} /></I18nProvider>);
  return { ...utils, props };
}

describe("PlanSheet", () => {
  it("renders nothing when closed", () => {
    const { container } = renderSheet({ open: false });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("trial state: shows the pricing toggle + a subscribe CTA wired to checkout", () => {
    const { container, props } = renderSheet();
    // Pricing toggle (monthly/annual SegmentedControl) is on the checkout path.
    expect(container.querySelector('[role="radiogroup"], [role="tablist"]')).not.toBeNull();
    const cta = container.querySelector("button.btn-primary") as HTMLButtonElement;
    expect(cta).not.toBeNull();
    fireEvent.click(cta);
    expect(props.handleStartCheckout).toHaveBeenCalled();
  });

  it("invite-code field updates state uppercased (word-of-mouth path)", () => {
    const { container, props } = renderSheet();
    const input = container.querySelector("input.input") as HTMLInputElement;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: "abcd23" } });
    expect(props.setInviteCodeInput).toHaveBeenCalledWith("ABCD23");
  });

  it("active sub: primary action routes to the Stripe portal, not checkout", () => {
    const { container, props } = renderSheet({
      subscription: {
        accessState: "active", compGranted: false, subscribedActive: true,
        subscription: { status: "active" },
      },
    });
    const cta = container.querySelector("button.btn-primary") as HTMLButtonElement;
    fireEvent.click(cta);
    expect(props.handleOpenPortal).toHaveBeenCalled();
    expect(props.handleStartCheckout).not.toHaveBeenCalled();
  });

  it("close button calls setActiveSheet(null)", () => {
    const { container, props } = renderSheet();
    fireEvent.click(container.querySelector("button.sheet-close") as HTMLButtonElement);
    expect(props.setActiveSheet).toHaveBeenCalledWith(null);
  });
});
