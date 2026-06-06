/**
 * @vitest-environment happy-dom
 *
 * useLongPress — covers the timer lifecycle: trigger after the
 * configured ms, cancel on movement past the tolerance, cancel on
 * early release, and never trigger after unmount.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../../utils/haptics", () => ({ haptic: { warn: vi.fn() } }));

const { useLongPress } = await import("../useLongPress");

function touchEvent(touches) {
  return {
    touches: touches.map((t) => ({ clientX: t.x, clientY: t.y })),
    cancelable: true,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useLongPress", () => {
  it("fires onLongPress after the configured ms", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, { ms: 300 }));
    act(() => result.current.bind.onTouchStart(touchEvent([{ x: 10, y: 20 }])));
    expect(cb).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(299));
    expect(cb).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(cb).toHaveBeenCalledWith(10, 20);
  });

  it("does not fire when the user moves past tolerance", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, { ms: 300 }));
    act(() => result.current.bind.onTouchStart(touchEvent([{ x: 10, y: 20 }])));
    act(() => result.current.bind.onTouchMove(touchEvent([{ x: 30, y: 25 }])));
    act(() => vi.advanceTimersByTime(500));
    expect(cb).not.toHaveBeenCalled();
  });

  it("tolerates small movement under the threshold", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, { ms: 300 }));
    act(() => result.current.bind.onTouchStart(touchEvent([{ x: 10, y: 20 }])));
    act(() => result.current.bind.onTouchMove(touchEvent([{ x: 13, y: 23 }])));
    act(() => vi.advanceTimersByTime(300));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("cancels on early release before the ms elapses", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, { ms: 300 }));
    act(() => result.current.bind.onTouchStart(touchEvent([{ x: 10, y: 20 }])));
    act(() => result.current.bind.onTouchEnd(touchEvent([])));
    act(() => vi.advanceTimersByTime(500));
    expect(cb).not.toHaveBeenCalled();
  });

  it("preventDefault on touchend AFTER long-press fires (suppresses synthetic click)", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, { ms: 300 }));
    act(() => result.current.bind.onTouchStart(touchEvent([{ x: 10, y: 20 }])));
    act(() => vi.advanceTimersByTime(300));
    const endEvent = touchEvent([]);
    act(() => result.current.bind.onTouchEnd(endEvent));
    expect(endEvent.preventDefault).toHaveBeenCalled();
  });

  it("does NOT preventDefault on touchend when long-press didn't fire", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, { ms: 300 }));
    act(() => result.current.bind.onTouchStart(touchEvent([{ x: 10, y: 20 }])));
    const endEvent = touchEvent([]);
    act(() => result.current.bind.onTouchEnd(endEvent));
    expect(endEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("clears the timer on unmount so a callback never fires against a dead component", () => {
    const cb = vi.fn();
    const { result, unmount } = renderHook(() => useLongPress(cb, { ms: 300 }));
    act(() => result.current.bind.onTouchStart(touchEvent([{ x: 10, y: 20 }])));
    unmount();
    act(() => vi.advanceTimersByTime(500));
    expect(cb).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, { ms: 300, enabled: false }));
    expect(result.current.bind).toEqual({});
  });

  it("does nothing when onLongPress is null (parent opted out)", () => {
    const { result } = renderHook(() => useLongPress(null, { ms: 300 }));
    // bind still has the no-op handlers but firing them is a no-op.
    expect(() => act(() => result.current.bind.onTouchStart(touchEvent([{ x: 0, y: 0 }])))).not.toThrow();
    act(() => vi.advanceTimersByTime(500));
    // No callback to assert against — just confirm nothing throws.
  });

  it("onClickCapture swallows the synthetic click that follows a fired long-press", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, { ms: 300 }));
    act(() => result.current.bind.onTouchStart(touchEvent([{ x: 10, y: 20 }])));
    act(() => vi.advanceTimersByTime(300));
    const clickEvent = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
    act(() => result.current.bind.onClickCapture(clickEvent));
    expect(clickEvent.stopPropagation).toHaveBeenCalled();
    expect(clickEvent.preventDefault).toHaveBeenCalled();
  });

  it("onClickCapture is a no-op when no long-press fired", () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, { ms: 300 }));
    const clickEvent = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
    act(() => result.current.bind.onClickCapture(clickEvent));
    expect(clickEvent.stopPropagation).not.toHaveBeenCalled();
  });

  it("does not swallow keyboard activations long after a fired long-press", () => {
    // Regression: the hook previously kept a boolean firedRef that
    // only cleared inside onClickCapture or the next touchstart.
    // When preventDefault on touchend successfully suppressed the
    // synthetic click, the flag stayed true — and a later keyboard
    // activation (Enter/Space) within the same wrapper hit
    // onClickCapture and got swallowed too. The timestamp-based
    // scheme only suppresses clicks inside CLICK_SUPPRESS_MS (300ms);
    // anything later passes through.
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb, { ms: 100 }));
    act(() => result.current.bind.onTouchStart(touchEvent([{ x: 10, y: 20 }])));
    act(() => vi.advanceTimersByTime(100));
    expect(cb).toHaveBeenCalledTimes(1);
    // touchend with cancelable=false — preventDefault is a no-op, so
    // the synthetic click WILL fire (the case the bug fix targets).
    const endEvent = { cancelable: false, preventDefault: vi.fn() };
    act(() => result.current.bind.onTouchEnd(endEvent));
    // Synthetic click right after — within the 300ms suppression
    // window, should be swallowed.
    const earlyClick = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
    act(() => result.current.bind.onClickCapture(earlyClick));
    expect(earlyClick.stopPropagation).toHaveBeenCalled();
    expect(earlyClick.preventDefault).toHaveBeenCalled();
    // Advance system time past the suppression window. (vi.setSystemTime
    // shifts Date.now() forward; the hook reads Date.now() at the click
    // moment, so this puts us "400ms later" without any real wait.)
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0, 500));
    // Simulate a keyboard activation: a click event arrives via Enter
    // or Space, hits onClickCapture. The early-window's resetting of
    // firedAtRef in the swallowed click means firedAtRef is back to 0
    // already, but even if it weren't, the time gate would block
    // suppression.
    const lateClick = { stopPropagation: vi.fn(), preventDefault: vi.fn() };
    act(() => result.current.bind.onClickCapture(lateClick));
    expect(lateClick.stopPropagation).not.toHaveBeenCalled();
    expect(lateClick.preventDefault).not.toHaveBeenCalled();
  });
});
