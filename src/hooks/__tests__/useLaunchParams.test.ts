/**
 * @vitest-environment happy-dom
 *
 * Characterization tests for the three URL-param launch-intent receivers
 * extracted from App.tsx's AppShell (Stripe billing return, PWA Web Share
 * Target, PWA/native shortcuts). Pins that each one reads its param, fires
 * the right side effect under the right guards, and strips the param from
 * the URL so a refresh can't replay the intent.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

const track = vi.fn();
vi.mock("../../lib/analytics", () => ({ track: (...a: unknown[]) => track(...a) }));

import { useLaunchParams } from "../useLaunchParams";

const t = (k: string) => k;

function setUrl(search: string) {
  window.history.replaceState({}, "", search ? `/${search}` : "/");
}

function baseDeps(over: Record<string, unknown> = {}) {
  return {
    demo: false,
    readOnly: false,
    user: { id: "u1" },
    setScreen: vi.fn(),
    setPendingFabAction: vi.fn(),
    pendingAgendaViewRef: { current: null as unknown },
    showSuccess: vi.fn(),
    showToast: vi.fn(),
    t,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  setUrl("");
  track.mockClear();
});

describe("useLaunchParams", () => {
  it("on ?billing=success: toasts, fires analytics, strips the param", () => {
    setUrl("?billing=success&session_id=cs_123");
    const deps = baseDeps();
    renderHook(() => useLaunchParams(deps));
    expect(deps.showSuccess).toHaveBeenCalledWith("subscription.toastSubscribed");
    expect(track).toHaveBeenCalledWith("subscribe_success", { source: "stripe_return" });
    expect(window.location.search).toBe("");
  });

  it("on ?billing=cancel: fires the cancelled analytics event, no toast", () => {
    setUrl("?billing=cancel");
    const deps = baseDeps();
    renderHook(() => useLaunchParams(deps));
    expect(deps.showSuccess).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("checkout_cancelled");
    expect(window.location.search).toBe("");
  });

  it("ignores billing params in demo mode", () => {
    setUrl("?billing=success");
    const deps = baseDeps({ demo: true });
    renderHook(() => useLaunchParams(deps));
    expect(deps.showSuccess).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it("on ?share_folder=1&url=…: captures the URL and strips the params", () => {
    setUrl("?share_folder=1&url=https%3A%2F%2Fdrive.example%2Ffolder");
    const deps = baseDeps();
    const { result } = renderHook(() => useLaunchParams(deps));
    expect(result.current.shareFolderUrl).toBe("https://drive.example/folder");
    expect(window.location.search).toBe("");
  });

  it("share target in demo mode: friendly toast, no capture, params stripped", () => {
    setUrl("?share_folder=1&url=https%3A%2F%2Fx.example");
    const deps = baseDeps({ demo: true });
    const { result } = renderHook(() => useLaunchParams(deps));
    expect(result.current.shareFolderUrl).toBeNull();
    expect(deps.showToast).toHaveBeenCalledWith("expediente.folder.shareUnavailable", "info");
    expect(window.location.search).toBe("");
  });

  it("share target with an empty candidate: warning toast, no capture", () => {
    setUrl("?share_folder=1");
    const deps = baseDeps();
    const { result } = renderHook(() => useLaunchParams(deps));
    expect(result.current.shareFolderUrl).toBeNull();
    expect(deps.showToast).toHaveBeenCalledWith("expediente.folder.shareEmpty", "warning");
  });

  it("on ?fab=patient: requests the FAB action and strips the param", () => {
    setUrl("?fab=patient");
    const deps = baseDeps();
    renderHook(() => useLaunchParams(deps));
    expect(deps.setPendingFabAction).toHaveBeenCalledWith("patient");
    expect(window.location.search).toBe("");
  });

  it("on ?screen=agenda: navigates and primes the agenda day view", () => {
    setUrl("?screen=agenda");
    const deps = baseDeps();
    renderHook(() => useLaunchParams(deps));
    expect(deps.setScreen).toHaveBeenCalledWith("agenda");
    expect(deps.pendingAgendaViewRef.current).toBe("day");
    expect(window.location.search).toBe("");
  });
});
