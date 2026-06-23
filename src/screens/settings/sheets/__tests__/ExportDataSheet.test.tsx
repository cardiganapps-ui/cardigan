/**
 * @vitest-environment happy-dom
 *
 * The export-my-data (ARCO Acceso) sheet extracted from Settings.tsx.
 * Pins the reauth gate (button disabled until a password is entered) and
 * that submitting posts to /api/export-user-data with the password.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { I18nProvider } from "../../../../i18n/index";

const fetchMock = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ code: "wrong_password" }) }));
vi.mock("../../../../supabaseClient", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) } },
}));
vi.mock("../../../../components/TurnstileWidget", () => ({ TurnstileWidget: () => null, TURNSTILE_ENABLED: false }));

import { ExportDataSheet } from "../ExportDataSheet";

beforeEach(() => { fetchMock.mockClear(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function renderSheet(over: Record<string, unknown> = {}) {
  const props: Any = { open: true, onClose: vi.fn(), showToast: vi.fn(), setSheetPanel: vi.fn(), sheetPanelHandlers: {}, ...over };
  const utils = render(<I18nProvider><ExportDataSheet {...props} /></I18nProvider>);
  return { ...utils, props };
}

describe("ExportDataSheet", () => {
  it("renders nothing when closed", () => {
    const { container } = renderSheet({ open: false });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("gates the CTA on a reauth password", () => {
    const { container } = renderSheet();
    const cta = container.querySelector("button.btn-primary") as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
    fireEvent.change(container.querySelector("input") as HTMLInputElement, { target: { value: "hunter2" } });
    expect(cta.disabled).toBe(false);
  });

  it("posts the password to /api/export-user-data on submit", async () => {
    const { container } = renderSheet();
    fireEvent.change(container.querySelector("input") as HTMLInputElement, { target: { value: "hunter2" } });
    await act(async () => { fireEvent.click(container.querySelector("button.btn-primary") as HTMLButtonElement); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalled();
    const [url, opts] = fetchMock.mock.calls[0] as Any;
    expect(url).toBe("/api/export-user-data");
    expect(JSON.parse(opts.body).password).toBe("hunter2");
  });
});
