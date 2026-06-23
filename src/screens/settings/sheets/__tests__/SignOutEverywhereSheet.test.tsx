/**
 * @vitest-environment happy-dom
 *
 * The (stateless) sign-out-everywhere sheet extracted from Settings.tsx.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { I18nProvider } from "../../../../i18n/index";
import { SignOutEverywhereSheet } from "../SignOutEverywhereSheet";

afterEach(cleanup);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function renderSheet(over: Record<string, unknown> = {}) {
  const props: Any = { open: true, onClose: vi.fn(), signOut: vi.fn(), setSheetPanel: vi.fn(), sheetPanelHandlers: {}, ...over };
  const utils = render(<I18nProvider><SignOutEverywhereSheet {...props} /></I18nProvider>);
  return { ...utils, props };
}

describe("SignOutEverywhereSheet", () => {
  it("renders nothing when closed", () => {
    const { container } = renderSheet({ open: false });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("the CTA signs out globally; cancel closes", () => {
    const { container, props } = renderSheet();
    fireEvent.click(container.querySelector("button.btn-primary") as HTMLButtonElement);
    expect(props.signOut).toHaveBeenCalledWith("global");
    fireEvent.click(container.querySelector("button.btn-ghost") as HTMLButtonElement);
    expect(props.onClose).toHaveBeenCalled();
  });
});
