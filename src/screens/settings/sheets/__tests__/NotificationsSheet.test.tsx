/**
 * @vitest-environment happy-dom
 *
 * The Notifications sheet extracted from Settings.tsx. PRESENTATIONAL:
 * the notifications hook + toggle/reactivate handlers stay in Settings.
 * Pins the open/closed gate, the three top-level branches (install card /
 * blocked alert / normal toggle), the reminder toggle wiring to
 * handleToggleNotifications, and the reconciled-off reactivate route.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { I18nProvider } from "../../../../i18n/index";

// NextRemindersPreview reads CardiganContext (session-derived preview) —
// out of scope for this sheet's contract, so stub it provider-free.
vi.mock("../../NextRemindersPreview", () => ({ NextRemindersPreview: () => null }));

import { NotificationsSheet } from "../NotificationsSheet";

afterEach(cleanup);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function renderSheet(over: Record<string, unknown> = {}) {
  const props: Any = {
    open: true,
    notifications: { enabled: true, permission: "granted", needsInstall: false, reminderMinutes: 30, setReminderMinutes: vi.fn() },
    togglePending: false,
    bellFx: false,
    handleToggleNotifications: vi.fn(),
    handleReconcileReactivate: vi.fn(),
    showToast: vi.fn(),
    setActiveSheet: vi.fn(),
    setSheetPanel: vi.fn(),
    sheetPanelHandlers: {},
    ...over,
  };
  const utils = render(<I18nProvider><NotificationsSheet {...props} /></I18nProvider>);
  return { ...utils, props };
}

describe("NotificationsSheet", () => {
  it("renders nothing when closed", () => {
    const { container } = renderSheet({ open: false });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("permission denied → shows the blocked alert, no toggle", () => {
    const { container } = renderSheet({
      notifications: { enabled: false, permission: "denied", needsInstall: false },
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('button[aria-pressed]')).toBeNull();
  });

  it("granted → the reminder toggle is wired to handleToggleNotifications", () => {
    const { container, props } = renderSheet();
    const toggle = container.querySelector('button[aria-pressed]') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(props.handleToggleNotifications).toHaveBeenCalled();
  });

  it("reconciledOff → the reactivate action calls handleReconcileReactivate", () => {
    const { container, props } = renderSheet({
      notifications: { enabled: false, permission: "granted", needsInstall: false, reconciledOff: true, reminderMinutes: 30, clearReconciliationMessage: vi.fn() },
    });
    // the amber banner's primary action (first button inside push-inline-banner)
    const banner = container.querySelector(".push-inline-banner") as HTMLElement;
    expect(banner).not.toBeNull();
    fireEvent.click(banner.querySelector("button") as HTMLButtonElement);
    expect(props.handleReconcileReactivate).toHaveBeenCalled();
  });

  it("close button calls setActiveSheet(null)", () => {
    const { container, props } = renderSheet();
    fireEvent.click(container.querySelector("button.sheet-close") as HTMLButtonElement);
    expect(props.setActiveSheet).toHaveBeenCalledWith(null);
  });
});
