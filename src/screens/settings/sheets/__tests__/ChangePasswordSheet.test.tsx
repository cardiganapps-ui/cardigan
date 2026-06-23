/**
 * @vitest-environment happy-dom
 *
 * The captcha-gated change-password sheet extracted from Settings.tsx.
 * Pins the reset-email flow (success → banner + close; error → inline
 * message, stays open). Turnstile is stubbed to the disabled/no-op state
 * (its default in test, since VITE_TURNSTILE_SITE_KEY is unset).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { I18nProvider } from "../../../../i18n/index";

const resetPasswordForEmail = vi.fn(async () => ({ error: null as null | { message: string } }));
vi.mock("../../../../supabaseClient", () => ({
  supabase: { auth: { resetPasswordForEmail: (...a: unknown[]) => resetPasswordForEmail(...(a as [])) } },
}));
vi.mock("../../../../components/TurnstileWidget", () => ({
  TurnstileWidget: () => null,
  TURNSTILE_ENABLED: false,
}));

import { ChangePasswordSheet } from "../ChangePasswordSheet";

afterEach(cleanup);
beforeEach(() => { resetPasswordForEmail.mockReset(); resetPasswordForEmail.mockResolvedValue({ error: null }); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function renderSheet(over: Record<string, unknown> = {}) {
  const props: Any = {
    open: true, onClose: vi.fn(), userEmail: "u@test.com", setMessage: vi.fn(),
    setSheetPanel: vi.fn(), sheetPanelHandlers: {}, ...over,
  };
  const utils = render(<I18nProvider><ChangePasswordSheet {...props} /></I18nProvider>);
  return { ...utils, props };
}

describe("ChangePasswordSheet", () => {
  it("renders nothing when closed", () => {
    const { container } = renderSheet({ open: false });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("on success: sends the reset email, raises the banner, and closes", async () => {
    const { container, props } = renderSheet();
    const cta = container.querySelector("button.btn-primary") as HTMLButtonElement;
    await act(async () => { fireEvent.click(cta); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(resetPasswordForEmail).toHaveBeenCalledWith("u@test.com", expect.any(Object));
    expect(props.setMessage).toHaveBeenCalledWith(expect.any(String));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("on error: shows the inline error and stays open", async () => {
    resetPasswordForEmail.mockResolvedValue({ error: { message: "rate limited" } });
    const { container, props } = renderSheet();
    const cta = container.querySelector("button.btn-primary") as HTMLButtonElement;
    await act(async () => { fireEvent.click(cta); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(container.textContent).toContain("rate limited");
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
