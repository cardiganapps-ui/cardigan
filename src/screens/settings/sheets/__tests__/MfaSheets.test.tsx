/**
 * @vitest-environment happy-dom
 *
 * The MFA enroll + manage sheets extracted from Settings.tsx. Pins the
 * behavior that used to live inline: kicks off enrollment on open, the
 * verify flow (6-digit gate → verifyEnroll → close + toast), and the
 * manage/unenroll flow off the shared mfa instance.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { I18nProvider } from "../../../../i18n/index";
import { MfaSheets } from "../MfaSheets";

afterEach(cleanup);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function renderSheet(over: Record<string, unknown> = {}) {
  const props: Any = {
    mode: null,
    mfa: { enrollment: null, factors: [], error: null, enroll: vi.fn(), cancelEnroll: vi.fn(), verifyEnroll: vi.fn(async () => true), unenroll: vi.fn(async () => true) },
    onClose: vi.fn(),
    showToast: vi.fn(),
    setSheetPanel: vi.fn(),
    sheetPanelHandlers: {},
    ...over,
  };
  const utils = render(<I18nProvider><MfaSheets {...props} /></I18nProvider>);
  return { ...utils, props };
}

describe("MfaSheets", () => {
  it("renders nothing when closed (mode null)", () => {
    const { container } = renderSheet({ mode: null });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("kicks off enrollment when the enroll sheet opens without a secret", () => {
    const enroll = vi.fn();
    renderSheet({ mode: "enroll", mfa: { enrollment: null, factors: [], error: null, enroll, cancelEnroll: vi.fn(), verifyEnroll: vi.fn(), unenroll: vi.fn() } });
    expect(enroll).toHaveBeenCalledTimes(1);
  });

  it("verify flow: 6-digit gate → verifyEnroll → close + success toast", async () => {
    const verifyEnroll = vi.fn(async () => true);
    const { container, props } = renderSheet({
      mode: "enroll",
      mfa: { enrollment: { secret: "JBSWY3DP", qr: "data:image/png;base64,xx" }, factors: [], error: null, enroll: vi.fn(), cancelEnroll: vi.fn(), verifyEnroll, unenroll: vi.fn() },
    });
    // The secret renders.
    expect(container.textContent).toContain("JBSWY3DP");
    const input = container.querySelector("input.input") as HTMLInputElement;
    const verifyBtn = container.querySelector("button.btn-primary") as HTMLButtonElement;
    // Gated until 6 digits.
    expect(verifyBtn.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "123456" } });
    expect(verifyBtn.disabled).toBe(false);
    await act(async () => { fireEvent.click(verifyBtn); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(verifyEnroll).toHaveBeenCalledWith("123456");
    expect(props.onClose).toHaveBeenCalled();
    expect(props.showToast).toHaveBeenCalledWith(expect.any(String), "success");
  });

  it("manage flow: unenroll uses the active factor id off the shared instance", async () => {
    const unenroll = vi.fn(async () => true);
    const { container, props } = renderSheet({
      mode: "manage",
      mfa: { enrollment: null, factors: [{ id: "factor-1" }], error: null, enroll: vi.fn(), cancelEnroll: vi.fn(), verifyEnroll: vi.fn(), unenroll },
    });
    const unenrollBtn = container.querySelector("button.btn-primary") as HTMLButtonElement;
    expect(unenrollBtn.disabled).toBe(false);
    await act(async () => { fireEvent.click(unenrollBtn); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(unenroll).toHaveBeenCalledWith("factor-1");
    expect(props.onClose).toHaveBeenCalled();
    expect(props.showToast).toHaveBeenCalledWith(expect.any(String), "info");
  });
});
