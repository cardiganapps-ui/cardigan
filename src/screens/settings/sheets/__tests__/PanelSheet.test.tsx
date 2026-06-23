/**
 * @vitest-environment happy-dom
 *
 * The generic titled sheet shell used by the Calendario / Pagos en línea
 * Settings wrappers. Pins the open/closed gate (children don't mount
 * when closed), the title render, and that close + overlay click invoke
 * onClose.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { I18nProvider } from "../../../../i18n/index";
import { PanelSheet } from "../PanelSheet";

afterEach(cleanup);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function renderSheet(over: Record<string, unknown> = {}) {
  const props: Any = {
    open: true,
    title: "Calendario",
    onClose: vi.fn(),
    setSheetPanel: vi.fn(),
    sheetPanelHandlers: {},
    children: <div data-testid="panel-body">panel</div>,
    ...over,
  };
  const utils = render(<I18nProvider><PanelSheet {...props}>{props.children}</PanelSheet></I18nProvider>);
  return { ...utils, props };
}

describe("PanelSheet", () => {
  it("renders nothing (and does not mount children) when closed", () => {
    const { container, queryByTestId } = renderSheet({ open: false });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(queryByTestId("panel-body")).toBeNull();
  });

  it("renders the title and wrapped children when open", () => {
    const { getByText, getByTestId } = renderSheet();
    expect(getByText("Calendario")).not.toBeNull();
    expect(getByTestId("panel-body")).not.toBeNull();
  });

  it("close button invokes onClose", () => {
    const { container, props } = renderSheet();
    fireEvent.click(container.querySelector("button.sheet-close") as HTMLButtonElement);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("overlay click invokes onClose; panel click does not", () => {
    const { container, props } = renderSheet();
    fireEvent.click(container.querySelector(".sheet-panel") as HTMLElement);
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector(".sheet-overlay") as HTMLElement);
    expect(props.onClose).toHaveBeenCalled();
  });
});
