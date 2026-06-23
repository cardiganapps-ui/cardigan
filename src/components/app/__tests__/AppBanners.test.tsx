/**
 * @vitest-environment happy-dom
 *
 * AppBanners — the top-of-content status banner stack extracted from
 * AppShell. Pins the mutually-exclusive gating (demo vs view-as vs
 * trial states) and the action wiring (demo → signOut, view-as exit →
 * setViewAsUserId(null) + origin restore, trial CTAs → navigate).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { AppBanners } from "../AppBanners";

afterEach(cleanup);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function renderBanners(over: Record<string, unknown> = {}) {
  const props: Any = {
    demo: false,
    viewAsUserId: null,
    subscription: { accessExpired: false, accessState: "active", daysLeftInTrial: null, subscription: null },
    demoProfession: "psychologist",
    setDemoProfession: vi.fn(),
    signOut: vi.fn(),
    setViewAsUserId: vi.fn(),
    viewAsOriginHashRef: { current: null },
    setScreen: vi.fn(),
    navigate: vi.fn(),
    t: (k: string) => k,
    ...over,
  };
  const utils = render(<AppBanners {...props} />);
  return { ...utils, props };
}

describe("AppBanners", () => {
  it("active sub, no special state: renders no banners", () => {
    const { container } = renderBanners();
    expect(container.querySelector(".app-banner")).toBeNull();
  });

  it("demo: shows the demo banner + profession picker; signOut on CTA", () => {
    const { container, props } = renderBanners({ demo: true, demoProfession: "tutor" });
    expect(container.querySelector(".app-banner--demo")).not.toBeNull();
    const select = container.querySelector("select.app-banner-picker-select") as HTMLSelectElement;
    expect(select.value).toBe("tutor");
    fireEvent.change(select, { target: { value: "trainer" } });
    expect(props.setDemoProfession).toHaveBeenCalledWith("trainer");
    fireEvent.click(container.querySelector(".app-banner-action") as HTMLButtonElement);
    expect(props.signOut).toHaveBeenCalled();
  });

  it("view-as: exit clears the impersonation and restores the admin origin hash", () => {
    const ref = { current: "#admin/users/abc" };
    const { container, props } = renderBanners({ viewAsUserId: "abc", viewAsOriginHashRef: ref });
    expect(container.querySelector(".app-banner--readonly")).not.toBeNull();
    fireEvent.click(container.querySelector(".app-banner-action--readonly") as HTMLButtonElement);
    expect(props.setViewAsUserId).toHaveBeenCalledWith(null);
    expect(props.setScreen).toHaveBeenCalledWith("admin");
    expect(ref.current).toBeNull();
  });

  it("expired (non-iOS web): shows the expired banner with a subscribe CTA → settings", () => {
    const { container, props } = renderBanners({ subscription: { accessExpired: true, accessState: "expired", subscription: null } });
    expect(container.querySelector(".app-banner--expired")).not.toBeNull();
    fireEvent.click(container.querySelector(".app-banner-action") as HTMLButtonElement);
    expect(props.navigate).toHaveBeenCalledWith("settings");
  });

  it("past-due: shows the grace-window banner with a fix-payment CTA", () => {
    const { container } = renderBanners({ subscription: { accessExpired: false, accessState: "active", subscription: { status: "past_due" } } });
    expect(container.querySelector(".app-banner--trial")).not.toBeNull();
  });

  it("trial within 7 days: shows the day-badge nudge", () => {
    const { container, getByText } = renderBanners({ subscription: { accessExpired: false, accessState: "trial", daysLeftInTrial: 5, subscription: null } });
    expect(container.querySelector(".app-banner--trial")).not.toBeNull();
    expect(getByText("subscription.trialDayBadge")).not.toBeNull();
  });

  it("demo wins over view-as (mutually exclusive)", () => {
    const { container } = renderBanners({ demo: true, viewAsUserId: "abc" });
    expect(container.querySelector(".app-banner--demo")).not.toBeNull();
    expect(container.querySelector(".app-banner--readonly")).toBeNull();
  });
});
