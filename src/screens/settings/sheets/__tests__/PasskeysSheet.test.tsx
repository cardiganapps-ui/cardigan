/**
 * @vitest-environment happy-dom
 *
 * The passkeys sheet extracted from Settings.tsx. Pins the list render,
 * the add flow (register → success toast), the empty state, and the
 * remove-confirm flow (row remove → ConfirmDialog → passkeys.remove).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { I18nProvider } from "../../../../i18n/index";
import { PasskeysSheet } from "../PasskeysSheet";

afterEach(cleanup);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function renderSheet(over: Record<string, unknown> = {}) {
  const props: Any = {
    open: true,
    onClose: vi.fn(),
    passkeys: { busy: false, error: null, loading: false, passkeys: [], register: vi.fn(async () => true), remove: vi.fn(async () => {}) },
    showToast: vi.fn(),
    setSheetPanel: vi.fn(),
    sheetPanelHandlers: {},
    ...over,
  };
  const utils = render(<I18nProvider><PasskeysSheet {...props} /></I18nProvider>);
  return { ...utils, props };
}

describe("PasskeysSheet", () => {
  it("renders nothing when closed and nothing is pending removal", () => {
    const { container } = renderSheet({ open: false });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("lists the user's passkeys", () => {
    const { container } = renderSheet({
      passkeys: { busy: false, error: null, loading: false, passkeys: [{ id: "pk1", friendly_name: "iPhone de Ana", created_at: null }], register: vi.fn(), remove: vi.fn() },
    });
    expect(container.textContent).toContain("iPhone de Ana");
  });

  it("add flow: register() → success toast", async () => {
    const register = vi.fn(async () => true);
    const { container, props } = renderSheet({
      passkeys: { busy: false, error: null, loading: false, passkeys: [], register, remove: vi.fn() },
    });
    const addBtn = container.querySelector("button.btn-primary-teal") as HTMLButtonElement;
    await act(async () => { fireEvent.click(addBtn); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(register).toHaveBeenCalled();
    expect(props.showToast).toHaveBeenCalledWith(expect.any(String), "success");
  });

  it("remove flow: row remove → confirm dialog → passkeys.remove(id)", async () => {
    const remove = vi.fn(async () => {});
    const { container } = renderSheet({
      passkeys: { busy: false, error: null, loading: false, passkeys: [{ id: "pk1", friendly_name: "iPhone", created_at: null }], register: vi.fn(), remove },
    });
    // No confirm dialog yet. (ConfirmDialog portals to document.body.)
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    // The row's remove button (the only .btn-tap in the list).
    const rowRemove = container.querySelector("button.btn-tap") as HTMLButtonElement;
    // ConfirmDialog mounts via an effect, so flush after the click.
    await act(async () => { fireEvent.click(rowRemove); await Promise.resolve(); });
    // Confirm dialog appears (in the portal).
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    const confirmBtn = document.querySelector("button.confirm-dialog-confirm") as HTMLButtonElement;
    await act(async () => { fireEvent.click(confirmBtn); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(remove).toHaveBeenCalledWith("pk1");
  });
});
