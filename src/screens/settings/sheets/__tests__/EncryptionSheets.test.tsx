/**
 * @vitest-environment happy-dom
 *
 * The note-encryption setup/change/disable sheets extracted from
 * Settings.tsx. Pins the status-aware main sheet, the setup submit
 * (passphrase gate → noteCrypto.setup), the unlocked-sheet navigation,
 * and the disable DESCIFRAR gate.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { I18nProvider } from "../../../../i18n/index";
import { EncryptionSheets } from "../EncryptionSheets";

afterEach(cleanup);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function renderSheet(over: Record<string, unknown> = {}) {
  const props: Any = {
    mode: "main",
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    noteCrypto: { status: "disabled", error: null, setup: vi.fn(async () => true), changePassphrase: vi.fn(async () => true), disable: vi.fn(async () => true) },
    showToast: vi.fn(),
    setSheetPanel: vi.fn(),
    sheetPanelHandlers: {},
    ...over,
  };
  const utils = render(<I18nProvider><EncryptionSheets {...props} /></I18nProvider>);
  return { ...utils, props };
}

describe("EncryptionSheets", () => {
  it("renders nothing when mode is null", () => {
    const { container } = renderSheet({ mode: null });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("setup flow (disabled status): matching 8+ char passphrases → noteCrypto.setup", async () => {
    const setup = vi.fn(async () => true);
    const { container, props } = renderSheet({ noteCrypto: { status: "disabled", error: null, setup, changePassphrase: vi.fn(), disable: vi.fn() } });
    const inputs = container.querySelectorAll("input");
    fireEvent.change(inputs[0], { target: { value: "passphrase1" } });
    fireEvent.change(inputs[1], { target: { value: "passphrase1" } });
    await act(async () => { fireEvent.click(container.querySelector("button.btn-primary") as HTMLButtonElement); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(setup).toHaveBeenCalledWith("passphrase1");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("setup flow rejects a mismatch with an inline error (no setup call)", async () => {
    const setup = vi.fn(async () => true);
    const { container } = renderSheet({ noteCrypto: { status: "disabled", error: null, setup, changePassphrase: vi.fn(), disable: vi.fn() } });
    const inputs = container.querySelectorAll("input");
    fireEvent.change(inputs[0], { target: { value: "passphrase1" } });
    fireEvent.change(inputs[1], { target: { value: "passphrase2" } });
    await act(async () => { fireEvent.click(container.querySelector("button.btn-primary") as HTMLButtonElement); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(setup).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("unlocked status: the manage buttons route to change / disable", () => {
    const { container, props } = renderSheet({ noteCrypto: { status: "unlocked", error: null, setup: vi.fn(), changePassphrase: vi.fn(), disable: vi.fn() } });
    const ghosts = Array.from(container.querySelectorAll("button.btn-ghost")) as HTMLButtonElement[];
    fireEvent.click(ghosts[0]); // change
    expect(props.onNavigate).toHaveBeenCalledWith("change");
    fireEvent.click(ghosts[1]); // disable
    expect(props.onNavigate).toHaveBeenCalledWith("disable");
  });

  it("disable mode: gated on the DESCIFRAR phrase → noteCrypto.disable", async () => {
    const disable = vi.fn(async () => true);
    const { container } = renderSheet({ mode: "disable", noteCrypto: { status: "unlocked", error: null, setup: vi.fn(), changePassphrase: vi.fn(), disable } });
    const cta = container.querySelector("button.btn-primary") as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
    fireEvent.change(container.querySelector("input.input") as HTMLInputElement, { target: { value: "DESCIFRAR" } });
    expect(cta.disabled).toBe(false);
    await act(async () => { fireEvent.click(cta); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(disable).toHaveBeenCalled();
  });
});
