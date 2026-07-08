import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Force the web path so haptic.* routes through navigator.vibrate and we
// can observe the enabled-flag guard without the Capacitor plugin.
vi.mock("../../lib/platform", () => ({ isNative: () => false }));

import { haptic, setHapticsEnabled, isHapticsEnabled } from "../haptics";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

describe("haptics enabled flag", () => {
  const vibrate = vi.fn();

  beforeEach(() => {
    vibrate.mockClear();
    // Node 22's global `navigator` is getter-only — stub via vitest.
    vi.stubGlobal("navigator", { vibrate });
    setHapticsEnabled(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setHapticsEnabled(true);
  });

  it("defaults to enabled (node env: localStorage read throws → ON) and fires navigator.vibrate", () => {
    expect(isHapticsEnabled()).toBe(true);
    haptic.tap();
    expect(vibrate).toHaveBeenCalledWith(8);
  });

  it("suppresses every pattern when disabled", () => {
    setHapticsEnabled(false);
    haptic.tap();
    haptic.success();
    haptic.warn();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("re-enabling restores vibration", () => {
    setHapticsEnabled(false);
    haptic.warn();
    setHapticsEnabled(true);
    haptic.warn();
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith([20, 30, 20]);
  });

  it("persists the preference to localStorage when available", () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    } as Row);
    setHapticsEnabled(false);
    expect(store["cardigan.hapticsEnabled"]).toBe("false");
    setHapticsEnabled(true);
    expect(store["cardigan.hapticsEnabled"]).toBe("true");
  });
});
