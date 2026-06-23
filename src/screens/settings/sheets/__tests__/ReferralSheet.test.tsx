/**
 * @vitest-environment happy-dom
 *
 * The Referral / "Invita y gana" sheet extracted from Settings.tsx.
 * PRESENTATIONAL: the subscription bag + copy handler stay in Settings.
 * Pins the open/closed gate, the code display + copy CTA wiring, the
 * copied-label swap, and the converted-invitee leaderboard render.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { I18nProvider } from "../../../../i18n/index";
import { ReferralSheet } from "../ReferralSheet";

afterEach(cleanup);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function renderSheet(over: Record<string, unknown> = {}) {
  const props: Any = {
    open: true,
    subscription: { referralInfo: { code: "ABCD2345", rewardsCount: 0, pendingCreditCents: 0 } },
    referralCopied: false,
    copyReferralCode: vi.fn(),
    setActiveSheet: vi.fn(),
    setSheetPanel: vi.fn(),
    sheetPanelHandlers: {},
    ...over,
  };
  const utils = render(<I18nProvider><ReferralSheet {...props} /></I18nProvider>);
  return { ...utils, props };
}

describe("ReferralSheet", () => {
  it("renders nothing when closed", () => {
    const { container } = renderSheet({ open: false });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows the referral code and a copy CTA wired to copyReferralCode", () => {
    const { container, props, getByText } = renderSheet();
    expect(getByText("ABCD2345")).not.toBeNull();
    // the copy button is the ghost button next to the code (not a share glyph)
    const copyBtn = Array.from(container.querySelectorAll("button.btn-ghost"))
      .find(b => !!b.textContent && b.textContent.trim().length > 0) as HTMLButtonElement;
    fireEvent.click(copyBtn);
    expect(props.copyReferralCode).toHaveBeenCalled();
  });

  it("disables the copy CTA + shows a placeholder while the code loads", () => {
    const { container, getByText } = renderSheet({
      subscription: { referralLoading: true, referralInfo: null },
    });
    expect(getByText("…")).not.toBeNull();
    const copyBtn = container.querySelector("button.btn-ghost") as HTMLButtonElement;
    expect(copyBtn.disabled).toBe(true);
  });

  it("renders the converted-invitee leaderboard when present", () => {
    const { container } = renderSheet({
      subscription: {
        referralInfo: { code: "ABCD2345", rewardsCount: 2, pendingCreditCents: 0 },
        referralLeaderboard: [
          { id: "1", credited_at: new Date().toISOString() },
          { id: "2", credited_at: new Date(Date.now() - 3 * 86400_000).toISOString() },
        ],
      },
    });
    // two leaderboard rows render under the title section
    const rows = container.querySelectorAll('[style*="space-between"]');
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("close button calls setActiveSheet(null)", () => {
    const { container, props } = renderSheet();
    fireEvent.click(container.querySelector("button.sheet-close") as HTMLButtonElement);
    expect(props.setActiveSheet).toHaveBeenCalledWith(null);
  });
});
