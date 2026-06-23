/**
 * @vitest-environment happy-dom
 *
 * useProGatedNav — the Pro upgrade gate + Cardi/Inbox sheet toggles +
 * drawer routing extracted from AppShell. Pins requirePro's sheet-open
 * behaviour and the isPro branch in handleDrawerNav (Cardi gated; other
 * ids fall through to setScreen).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useProGatedNav } from "../useProGatedNav";

afterEach(cleanup);

describe("useProGatedNav", () => {
  it("requirePro opens the upgrade sheet with the given feature", () => {
    const { result } = renderHook(() => useProGatedNav({ isPro: false, setScreen: vi.fn() }));
    act(() => result.current.requirePro("documents"));
    expect(result.current.proSheetOpen).toBe(true);
    expect(result.current.proSheetFeature).toBe("documents");
  });

  it("requirePro defaults the feature to 'default'", () => {
    const { result } = renderHook(() => useProGatedNav({ isPro: false, setScreen: vi.fn() }));
    act(() => result.current.requirePro());
    expect(result.current.proSheetFeature).toBe("default");
  });

  it("handleDrawerNav('cardi') opens Cardi for Pro users", () => {
    const setScreen = vi.fn();
    const { result } = renderHook(() => useProGatedNav({ isPro: true, setScreen }));
    act(() => result.current.handleDrawerNav("cardi"));
    expect(result.current.cardiOpen).toBe(true);
    expect(setScreen).not.toHaveBeenCalled();
  });

  it("handleDrawerNav('cardi') bumps non-Pro users to the upgrade sheet", () => {
    const setScreen = vi.fn();
    const { result } = renderHook(() => useProGatedNav({ isPro: false, setScreen }));
    act(() => result.current.handleDrawerNav("cardi"));
    expect(result.current.cardiOpen).toBe(false);
    expect(result.current.proSheetOpen).toBe(true);
    expect(result.current.proSheetFeature).toBe("cardi");
    expect(setScreen).not.toHaveBeenCalled();
  });

  it("handleDrawerNav routes any other id to setScreen", () => {
    const setScreen = vi.fn();
    const { result } = renderHook(() => useProGatedNav({ isPro: false, setScreen }));
    act(() => result.current.handleDrawerNav("finances"));
    expect(setScreen).toHaveBeenCalledWith("finances");
    expect(result.current.cardiOpen).toBe(false);
  });
});
