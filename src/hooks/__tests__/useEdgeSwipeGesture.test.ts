/**
 * @vitest-environment happy-dom
 *
 * Characterization test for the left-edge swipe-to-open drawer gesture,
 * extracted from App.tsx into useEdgeSwipeGesture. Pins the behavior the
 * App shell relied on so the extraction (and future edits) can't silently
 * regress it:
 *   - the pure commit decision (distance OR velocity),
 *   - a real touch-drag from the edge band past the threshold opens the
 *     drawer,
 *   - a short drag does NOT,
 *   - the gesture is inert at tablet width (persistent sidebar),
 *   - a drag that starts OUTSIDE the edge band is ignored.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import {
  useEdgeSwipeGesture,
  shouldCommitDrawerOpen,
  OPEN_DISTANCE_PX,
} from "../useEdgeSwipeGesture";

describe("shouldCommitDrawerOpen", () => {
  it("commits on a long-enough pull regardless of speed", () => {
    expect(shouldCommitDrawerOpen(OPEN_DISTANCE_PX + 1, 5000)).toBe(true); // slow but far
  });
  it("commits on a fast flick even if short", () => {
    expect(shouldCommitDrawerOpen(60, 100)).toBe(true); // 0.6 px/ms > 0.3
  });
  it("does not commit on a short, slow drag", () => {
    expect(shouldCommitDrawerOpen(40, 1000)).toBe(false); // 40px, 0.04 px/ms
  });
  it("does not commit on a leftward (negative) drag", () => {
    expect(shouldCommitDrawerOpen(-200, 100)).toBe(false);
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

// happy-dom has no TouchEvent constructor; the handlers only read
// e.touches / e.changedTouches / e.cancelable / e.preventDefault, so a
// plain Event with those fields attached is a faithful stand-in.
function touch(el: HTMLElement, type: string, x: number, y = 0) {
  const ev: Row = new Event(type, { bubbles: true, cancelable: type === "touchmove" });
  const point = [{ clientX: x, clientY: y }];
  Object.defineProperty(ev, "touches", { value: point });
  Object.defineProperty(ev, "changedTouches", { value: point });
  el.dispatchEvent(ev);
}

function setup(opts: Partial<Row> = {}) {
  const shell = document.createElement("div");
  document.body.appendChild(shell);
  const refs = {
    shellRef: { current: shell },
    edgeRef: { current: null as Row },
    drawerOpenRef: { current: false },
    screenSlidingRef: { current: false },
  };
  const setSwipeProgress = vi.fn();
  const setDrawerOpen = vi.fn();
  renderHook(() =>
    useEdgeSwipeGesture({
      ...refs,
      isTablet: false,
      setSwipeProgress,
      setDrawerOpen,
      ...opts,
    } as Row),
  );
  return { shell, setSwipeProgress, setDrawerOpen, refs };
}

describe("useEdgeSwipeGesture — drag behavior", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => cleanup());

  it("opens the drawer on a left-edge drag past the distance threshold", () => {
    const { shell, setDrawerOpen, setSwipeProgress } = setup();
    touch(shell, "touchstart", 8);   // inside the 32px edge band
    touch(shell, "touchmove", 60);   // dx 52 > 10 → engage + claim
    touch(shell, "touchmove", 140);  // tracking; progress updates
    touch(shell, "touchend", 140);   // dx 132 > 100 → commit

    expect(setDrawerOpen).toHaveBeenCalledWith(true);
    expect(setSwipeProgress).toHaveBeenCalled(); // progress was driven mid-drag
  });

  it("does NOT open on a short drag that never crosses the threshold", () => {
    const { shell, setDrawerOpen } = setup();
    touch(shell, "touchstart", 8);
    touch(shell, "touchmove", 30);  // dx 22 > 10 → engages
    touch(shell, "touchend", 45);   // dx 37 < 100, slow → no commit

    expect(setDrawerOpen).not.toHaveBeenCalled();
  });

  it("ignores a drag that starts outside the edge band", () => {
    const { shell, setDrawerOpen, setSwipeProgress } = setup();
    touch(shell, "touchstart", 200); // well past the 32px band
    touch(shell, "touchmove", 320);
    touch(shell, "touchend", 320);

    expect(setDrawerOpen).not.toHaveBeenCalled();
    // touchend resets progress to 0 unconditionally, but the drag was
    // never tracked → no positive progress value was ever pushed.
    const trackedPositive = setSwipeProgress.mock.calls.some((c: number[]) => c[0] > 0);
    expect(trackedPositive).toBe(false);
  });

  it("is inert at tablet width (no listeners attached)", () => {
    const { shell, setDrawerOpen } = setup({ isTablet: true });
    touch(shell, "touchstart", 8);
    touch(shell, "touchmove", 140);
    touch(shell, "touchend", 140);

    expect(setDrawerOpen).not.toHaveBeenCalled();
  });
});
