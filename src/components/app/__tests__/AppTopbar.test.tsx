/**
 * @vitest-environment happy-dom
 *
 * AppTopbar — the fixed top bar extracted from AppShell. Children that
 * read context / i18n tips (TopbarActions, HelpTip, Tooltip, AvatarContent)
 * are stubbed; this pins the topbar's own wiring: hamburger → drawer
 * toggle, mobile search + TopbarActions gated on !readOnly, brand/avatar →
 * navigate, inbox bell → open inbox (+ unread dot), refresh, admin chip
 * gating.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

vi.mock("../../TopbarActions", () => ({ default: () => <div data-testid="topbar-actions" /> }));
vi.mock("../../HelpTip", () => ({ HelpTip: () => <div data-testid="help-tip" /> }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
vi.mock("../../Tooltip", () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock("../../Avatar", () => ({ AvatarContent: () => <span data-testid="avatar" /> }));

import { AppTopbar } from "../AppTopbar";

afterEach(cleanup);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function renderTopbar(over: Record<string, unknown> = {}) {
  const props: Any = {
    drawerOpen: false,
    setDrawerOpen: vi.fn(),
    prefetchDrawer: vi.fn(),
    readOnly: false,
    setPaletteOpen: vi.fn(),
    navigate: vi.fn(),
    screen: "home",
    setInboxOpen: vi.fn(),
    inboxUnread: 0,
    refresh: vi.fn(),
    admin: false,
    userInitial: "D",
    avatarImageUrl: null,
    t: (k: string) => k,
    ...over,
  };
  const utils = render(<AppTopbar {...props} />);
  return { ...utils, props };
}

describe("AppTopbar", () => {
  it("hamburger toggles the drawer", () => {
    const { container, props } = renderTopbar();
    fireEvent.click(container.querySelector(".hamburger") as HTMLButtonElement);
    expect(props.setDrawerOpen).toHaveBeenCalled();
    // the updater inverts the current value
    const updater = props.setDrawerOpen.mock.calls[0][0];
    expect(updater(false)).toBe(true);
  });

  it("brand navigates home; avatar navigates to settings", () => {
    const { container, props } = renderTopbar();
    fireEvent.click(container.querySelector(".topbar-brand") as HTMLButtonElement);
    expect(props.navigate).toHaveBeenCalledWith("home");
    fireEvent.click(container.querySelector(".avatar-sm") as HTMLButtonElement);
    expect(props.navigate).toHaveBeenCalledWith("settings");
  });

  it("mobile search + TopbarActions show when not read-only and open the palette", () => {
    const { container, queryByTestId, props } = renderTopbar();
    expect(queryByTestId("topbar-actions")).not.toBeNull();
    fireEvent.click(container.querySelector(".topbar-search-mobile") as HTMLButtonElement);
    expect(props.setPaletteOpen).toHaveBeenCalledWith(true);
  });

  it("read-only hides the mobile search + TopbarActions", () => {
    const { container, queryByTestId } = renderTopbar({ readOnly: true });
    expect(container.querySelector(".topbar-search-mobile")).toBeNull();
    expect(queryByTestId("topbar-actions")).toBeNull();
  });

  it("inbox bell opens the inbox; unread dot renders only when unread > 0", () => {
    const { container, props } = renderTopbar({ inboxUnread: 3 });
    const bell = container.querySelectorAll(".topbar-refresh-btn")[0] as HTMLButtonElement;
    fireEvent.click(bell);
    expect(props.setInboxOpen).toHaveBeenCalledWith(true);
    expect(bell.querySelector("span[aria-hidden]")).not.toBeNull();

    cleanup();
    const { container: c2 } = renderTopbar({ inboxUnread: 0 });
    const bell2 = c2.querySelectorAll(".topbar-refresh-btn")[0] as HTMLButtonElement;
    expect(bell2.querySelector("span[aria-hidden]")).toBeNull();
  });

  it("admin chip renders only for admins (and not read-only)", () => {
    const { container } = renderTopbar({ admin: true });
    expect(container.querySelector(".admin-btn")).not.toBeNull();
    cleanup();
    const { container: c2 } = renderTopbar({ admin: true, readOnly: true });
    expect(c2.querySelector(".admin-btn")).toBeNull();
    cleanup();
    const { container: c3 } = renderTopbar({ admin: false });
    expect(c3.querySelector(".admin-btn")).toBeNull();
  });
});
