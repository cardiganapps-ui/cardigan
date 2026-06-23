/**
 * @vitest-environment happy-dom
 *
 * The Apariencia (tema) + Color de acento sheets extracted from
 * Settings.tsx. PRESENTATIONAL: the theme + accent preference bags stay
 * in Settings. Pins the mode gate, that the theme list selects + closes,
 * the accent list selects + closes, and the active checkmark.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { I18nProvider } from "../../../../i18n/index";
import { AppearanceSheets } from "../AppearanceSheets";

afterEach(cleanup);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function renderSheet(over: Record<string, unknown> = {}) {
  const props: Any = {
    mode: "theme",
    theme: { preference: "system", setPreference: vi.fn() },
    accentTheme: { accent: "default", setAccent: vi.fn() },
    onClose: vi.fn(),
    setSheetPanel: vi.fn(),
    sheetPanelHandlers: {},
    ...over,
  };
  const utils = render(<I18nProvider><AppearanceSheets {...props} /></I18nProvider>);
  return { ...utils, props };
}

describe("AppearanceSheets", () => {
  it("renders nothing when mode is null", () => {
    const { container } = renderSheet({ mode: null });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("theme mode: lists 3 options; tapping one sets the preference and closes", () => {
    const { container, props } = renderSheet({ mode: "theme" });
    const rows = container.querySelectorAll(".settings-row");
    expect(rows.length).toBe(3);
    fireEvent.click(rows[0]); // light
    expect(props.theme.setPreference).toHaveBeenCalledWith("light");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("accent mode: lists 5 swatches; tapping one sets the accent and closes", () => {
    const { container, props } = renderSheet({ mode: "accent" });
    const rows = container.querySelectorAll(".settings-row");
    expect(rows.length).toBe(5);
    fireEvent.click(rows[1]); // sage
    expect(props.accentTheme.setAccent).toHaveBeenCalledWith("sage");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("close button calls onClose", () => {
    const { container, props } = renderSheet();
    fireEvent.click(container.querySelector("button.sheet-close") as HTMLButtonElement);
    expect(props.onClose).toHaveBeenCalled();
  });
});
