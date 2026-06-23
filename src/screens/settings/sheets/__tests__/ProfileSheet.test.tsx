/**
 * @vitest-environment happy-dom
 *
 * The Editar perfil sheet extracted from Settings.tsx. PRESENTATIONAL:
 * the name field state + saveProfile stay in Settings. Pins the
 * open/closed gate, the disabled-email field, the save gate (empty name),
 * and that save calls saveProfile.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { I18nProvider } from "../../../../i18n/index";
import { ProfileSheet } from "../ProfileSheet";

afterEach(cleanup);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function renderSheet(over: Record<string, unknown> = {}) {
  const props: Any = {
    open: true,
    editName: "Dra. Ramírez",
    setEditName: vi.fn(),
    userEmail: "dra@example.com",
    message: "",
    saving: false,
    saveProfile: vi.fn(),
    setActiveSheet: vi.fn(),
    setSheetPanel: vi.fn(),
    sheetPanelHandlers: {},
    ...over,
  };
  const utils = render(<I18nProvider><ProfileSheet {...props} /></I18nProvider>);
  return { ...utils, props };
}

describe("ProfileSheet", () => {
  it("renders nothing when closed", () => {
    const { container } = renderSheet({ open: false });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows the email read-only and the name editable", () => {
    const { container, props } = renderSheet();
    const inputs = Array.from(container.querySelectorAll("input")) as HTMLInputElement[];
    const email = inputs.find(i => i.value === "dra@example.com")!;
    expect(email.disabled).toBe(true);
    const name = inputs.find(i => i.value === "Dra. Ramírez")!;
    fireEvent.change(name, { target: { value: "Dra. R" } });
    expect(props.setEditName).toHaveBeenCalledWith("Dra. R");
  });

  it("save calls saveProfile and is disabled on an empty name", () => {
    const { container, props } = renderSheet();
    const save = container.querySelector("button.btn-primary-teal") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(props.saveProfile).toHaveBeenCalled();

    cleanup();
    const { container: c2 } = renderSheet({ editName: "   " });
    expect((c2.querySelector("button.btn-primary-teal") as HTMLButtonElement).disabled).toBe(true);
  });

  it("close button calls setActiveSheet(null)", () => {
    const { container, props } = renderSheet();
    fireEvent.click(container.querySelector("button.sheet-close") as HTMLButtonElement);
    expect(props.setActiveSheet).toHaveBeenCalledWith(null);
  });
});
