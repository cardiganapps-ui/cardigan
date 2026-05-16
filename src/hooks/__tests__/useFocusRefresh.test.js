/**
 * @vitest-environment happy-dom
 *
 * The hook attaches a `visibilitychange` listener to `document`, so it
 * needs a DOM. environmentMatchGlobs in vitest.config.js *should* pick
 * this up via the path, but the docblock override is the canonical
 * per-file way and survives config refactors.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFocusRefresh } from "../useFocusRefresh";

/* Tier 2 — multi-device sync via visibility-driven refresh. These
   tests pin down the four guards the hook owes its callers:
     1. Doesn't refresh on first paint (no prior hidden state)
     2. Suppresses tab-flip thrash (min-hidden-ms threshold)
     3. Suppresses while mutating (don't clobber optimistic state)
     4. Cleans up its listener on unmount */

function setVisibility(state) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useFocusRefresh", () => {
  beforeEach(() => {
    setVisibility("visible");
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT refresh on first paint (no prior hide)", () => {
    const refresh = vi.fn(async () => {});
    renderHook(() => useFocusRefresh(refresh, { mutating: false, minHiddenMs: 100 }));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes after a hide → visible cycle longer than minHiddenMs", () => {
    const refresh = vi.fn(async () => {});
    renderHook(() => useFocusRefresh(refresh, { mutating: false, minHiddenMs: 100 }));

    setVisibility("hidden");
    vi.advanceTimersByTime(500);
    setVisibility("visible");

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does NOT refresh on a tab flip shorter than minHiddenMs", () => {
    const refresh = vi.fn(async () => {});
    renderHook(() => useFocusRefresh(refresh, { mutating: false, minHiddenMs: 10_000 }));

    setVisibility("hidden");
    vi.advanceTimersByTime(500); // way under 10s
    setVisibility("visible");

    expect(refresh).not.toHaveBeenCalled();
  });

  it("suppresses refresh while mutating (don't clobber optimistic state)", () => {
    const refresh = vi.fn(async () => {});
    const { rerender } = renderHook(
      ({ mutating }) => useFocusRefresh(refresh, { mutating, minHiddenMs: 100 }),
      { initialProps: { mutating: true } }
    );

    setVisibility("hidden");
    vi.advanceTimersByTime(500);
    setVisibility("visible");
    expect(refresh).not.toHaveBeenCalled();

    // Mutating clears; next focus cycle should still skip (no new hide),
    // but a fresh cycle should now fire.
    rerender({ mutating: false });
    setVisibility("hidden");
    vi.advanceTimersByTime(500);
    setVisibility("visible");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does NOT crash if refresh is not a function", () => {
    // Defensive — App.jsx wires refresh from useCardiganData; if for some
    // reason it's undefined during loading, the hook should no-op.
    expect(() =>
      renderHook(() => useFocusRefresh(undefined, { mutating: false }))
    ).not.toThrow();
  });

  it("removes its event listener on unmount", () => {
    const refresh = vi.fn(async () => {});
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useFocusRefresh(refresh, { mutating: false, minHiddenMs: 100 }));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    removeSpy.mockRestore();
  });

  it("only fires once per hide→visible cycle, not on subsequent visibility ticks", () => {
    const refresh = vi.fn(async () => {});
    renderHook(() => useFocusRefresh(refresh, { mutating: false, minHiddenMs: 100 }));

    setVisibility("hidden");
    vi.advanceTimersByTime(500);
    setVisibility("visible");
    expect(refresh).toHaveBeenCalledTimes(1);

    // Dispatching visibilitychange again without a new "hidden" first
    // should NOT trigger another refresh (hiddenSinceRef cleared).
    setVisibility("visible");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
