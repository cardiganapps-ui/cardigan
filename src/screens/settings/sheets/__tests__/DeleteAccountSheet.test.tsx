/**
 * @vitest-environment happy-dom
 *
 * The delete-account (ARCO Cancelación) sheet extracted from Settings.tsx.
 * Pins the type-to-confirm + reauth gate and that submitting posts the
 * normalized confirmation + password to /api/delete-my-account.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { I18nProvider } from "../../../../i18n/index";

const fetchMock = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ code: "wrong_password" }) }));
vi.mock("../../../../supabaseClient", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) } },
}));
vi.mock("../../../../components/TurnstileWidget", () => ({ TurnstileWidget: () => null, TURNSTILE_ENABLED: false }));

import { DeleteAccountSheet } from "../DeleteAccountSheet";

beforeEach(() => { fetchMock.mockClear(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function renderSheet(over: Record<string, unknown> = {}) {
  const props: Any = { open: true, onClose: vi.fn(), signOut: vi.fn(), setSheetPanel: vi.fn(), sheetPanelHandlers: {}, ...over };
  const utils = render(<I18nProvider><DeleteAccountSheet {...props} /></I18nProvider>);
  return { ...utils, props };
}

// inputs: [absorb-username(hidden), confirm text, password]
function fields(container: HTMLElement) {
  const inputs = Array.from(container.querySelectorAll("input")) as HTMLInputElement[];
  return { confirm: inputs[1], password: inputs[2] };
}

describe("DeleteAccountSheet", () => {
  it("renders nothing when closed", () => {
    const { container } = renderSheet({ open: false });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("gates the CTA on the ELIMINAR phrase AND a reauth password", () => {
    const { container } = renderSheet();
    const cta = container.querySelector("button.btn-primary") as HTMLButtonElement;
    const { confirm, password } = fields(container);
    expect(cta.disabled).toBe(true);
    fireEvent.change(confirm, { target: { value: "ELIMINAR" } });
    expect(cta.disabled).toBe(true); // still needs password
    fireEvent.change(password, { target: { value: "hunter2" } });
    expect(cta.disabled).toBe(false);
  });

  it("posts the normalized confirmation + password to /api/delete-my-account", async () => {
    const { container } = renderSheet();
    const { confirm, password } = fields(container);
    // lowercase + trailing space → normalized to ELIMINAR by the handler.
    fireEvent.change(confirm, { target: { value: " eliminar " } });
    fireEvent.change(password, { target: { value: "hunter2" } });
    await act(async () => { fireEvent.click(container.querySelector("button.btn-primary") as HTMLButtonElement); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalled();
    const [url, opts] = fetchMock.mock.calls[0] as Any;
    expect(url).toBe("/api/delete-my-account");
    const body = JSON.parse(opts.body);
    expect(body.confirmation).toBe("ELIMINAR");
    expect(body.password).toBe("hunter2");
  });
});
