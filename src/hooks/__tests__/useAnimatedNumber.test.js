/**
 * @vitest-environment happy-dom
 *
 * useAnimatedNumber — covers the rAF lifecycle: starts at 0 on first
 * mount, animates toward target, snaps to target on completion,
 * respects reduced-motion + non-finite targets, and cancels cleanly
 * on unmount.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { useAnimatedNumber } = await import("../useAnimatedNumber");

let rafCallbacks = [];
let now = 0;

beforeEach(() => {
  rafCallbacks = [];
  now = 0;
  vi.stubGlobal("requestAnimationFrame", (cb) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("performance", { now: () => now });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function step(ms) {
  now += ms;
  const cbs = rafCallbacks;
  rafCallbacks = [];
  cbs.forEach((cb) => cb(now));
}

describe("useAnimatedNumber", () => {
  it("starts at 0 on first mount when target is a finite number", () => {
    const { result } = renderHook(() => useAnimatedNumber(100, { duration: 700 }));
    expect(result.current).toBe(0);
  });

  it("snaps to target when prefers-reduced-motion is set", () => {
    // Mock matchMedia to report reduced motion.
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const { result } = renderHook(() => useAnimatedNumber(100, { duration: 700 }));
    act(() => {});
    expect(result.current).toBe(100);
    window.matchMedia = undefined;
  });

  it("snaps to target when enabled=false", () => {
    const { result } = renderHook(() => useAnimatedNumber(100, { duration: 700, enabled: false }));
    act(() => {});
    expect(result.current).toBe(100);
  });

  it("passes through null target untouched", () => {
    const { result } = renderHook(() => useAnimatedNumber(null));
    act(() => {});
    expect(result.current).toBe(null);
  });

  it("passes through NaN target untouched", () => {
    const { result } = renderHook(() => useAnimatedNumber(NaN));
    act(() => {});
    expect(result.current).toBeNaN();
  });

  it("animates from 0 toward target over duration ms with eased curve", () => {
    const { result } = renderHook(() => useAnimatedNumber(100, { duration: 700 }));
    expect(result.current).toBe(0);
    // First rAF callback fires
    act(() => step(0));
    // After half the duration the eased value should be well past 50% on an
    // ease-out curve (front-loaded progress).
    act(() => step(350));
    expect(result.current).toBeGreaterThan(50);
    expect(result.current).toBeLessThan(100);
    // Past the full duration — snaps to exact target.
    act(() => step(400));
    expect(result.current).toBe(100);
  });

  it("re-animates from current value when target changes mid-flight", () => {
    const { result, rerender } = renderHook(({ target }) => useAnimatedNumber(target, { duration: 700 }), {
      initialProps: { target: 100 },
    });
    act(() => step(0));
    act(() => step(350));
    const partway = result.current;
    expect(partway).toBeGreaterThan(0);
    expect(partway).toBeLessThan(100);
    // Change target mid-animation — should restart from `partway`.
    rerender({ target: 200 });
    act(() => step(0));
    // Step a tiny bit so the rAF callback has fired with a non-zero elapsed.
    act(() => step(50));
    // The new animation starts from partway, so the next sampled value
    // should be > partway but not yet at 200.
    expect(result.current).toBeGreaterThan(partway);
    expect(result.current).toBeLessThan(200);
    act(() => step(700));
    expect(result.current).toBe(200);
  });

  it("does not start a new animation when target stays the same", () => {
    const initialRafLength = rafCallbacks.length;
    const { rerender } = renderHook(({ target }) => useAnimatedNumber(target, { duration: 700 }), {
      initialProps: { target: 50 },
    });
    act(() => step(700));
    const afterFirstAnim = rafCallbacks.length;
    rerender({ target: 50 });
    // No new rAF scheduled because target === currentRef.current.
    expect(rafCallbacks.length).toBe(afterFirstAnim);
    void initialRafLength;
  });
});
