/**
 * @vitest-environment happy-dom
 *
 * useSheetExit — covers the animated-close lifecycle: animatedClose
 * sets exiting=true, defers onClose by EXIT_MS, re-entrant calls
 * during exit are no-ops, and no onClose fires if animatedClose was
 * never called.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { useSheetExit, SHEET_EXIT_MS } = await import("../useSheetExit");

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useSheetExit", () => {
  it("starts with exiting=false", () => {
    const { result } = renderHook(() => useSheetExit(true, vi.fn()));
    expect(result.current.exiting).toBe(false);
  });

  it("animatedClose flips exiting=true synchronously", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSheetExit(true, onClose));
    act(() => result.current.animatedClose());
    expect(result.current.exiting).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose after EXIT_MS", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSheetExit(true, onClose));
    act(() => result.current.animatedClose());
    act(() => vi.advanceTimersByTime(SHEET_EXIT_MS - 1));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("resets exiting after onClose fires", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSheetExit(true, onClose));
    act(() => result.current.animatedClose());
    act(() => vi.advanceTimersByTime(SHEET_EXIT_MS));
    expect(result.current.exiting).toBe(false);
  });

  it("re-entrant calls during exit are no-ops", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useSheetExit(true, onClose));
    act(() => result.current.animatedClose());
    act(() => result.current.animatedClose());
    act(() => result.current.animatedClose());
    act(() => vi.advanceTimersByTime(SHEET_EXIT_MS));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("missing onClose is a safe no-op", () => {
    const { result } = renderHook(() => useSheetExit(true, undefined));
    expect(() => act(() => result.current.animatedClose())).not.toThrow();
    expect(result.current.exiting).toBe(false);
  });

  it("idle state never fires onClose", () => {
    const onClose = vi.fn();
    renderHook(() => useSheetExit(true, onClose));
    act(() => vi.advanceTimersByTime(SHEET_EXIT_MS * 2));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("forwards arguments through to onClose", () => {
    // PaymentModal calls onClose("Pago registrado: ...") to show a
    // success toast; the hook must not swallow that argument.
    const onClose = vi.fn();
    const { result } = renderHook(() => useSheetExit(true, onClose));
    act(() => result.current.animatedClose("hi", 42, { tag: "x" }));
    act(() => vi.advanceTimersByTime(SHEET_EXIT_MS));
    expect(onClose).toHaveBeenCalledWith("hi", 42, { tag: "x" });
  });

  it("cancels the timer on unmount so onClose can't fire against a stale parent", () => {
    // Regression: without the cleanup, a sheet that unmounts mid-
    // exit (parent's state ripped it out via an unrelated path)
    // would call onClose 260ms later against a now-gone tree, plus
    // try setExiting(false) on a dead component.
    const onClose = vi.fn();
    const { result, unmount } = renderHook(() => useSheetExit(true, onClose));
    act(() => result.current.animatedClose());
    unmount();
    act(() => vi.advanceTimersByTime(SHEET_EXIT_MS * 2));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cancels the timer when open flips false externally", () => {
    // Regression: parent decides to close the sheet without routing
    // through animatedClose (network event invalidated the displayed
    // entity, admin takeover, etc.). The in-flight exit timer must
    // be cancelled — otherwise onClose fires seconds after the sheet
    // is already gone.
    const onClose = vi.fn();
    const { result, rerender } = renderHook(
      ({ open }) => useSheetExit(open, onClose),
      { initialProps: { open: true } }
    );
    act(() => result.current.animatedClose());
    expect(result.current.exiting).toBe(true);
    rerender({ open: false });
    expect(result.current.exiting).toBe(false);
    act(() => vi.advanceTimersByTime(SHEET_EXIT_MS * 2));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("resets exiting when open re-toggles after a cancelled exit", () => {
    // Without resetting on open=false, a re-opened sheet would
    // render in the "exiting" state immediately — broken visual.
    const onClose = vi.fn();
    const { result, rerender } = renderHook(
      ({ open }) => useSheetExit(open, onClose),
      { initialProps: { open: true } }
    );
    act(() => result.current.animatedClose());
    rerender({ open: false });
    rerender({ open: true });
    expect(result.current.exiting).toBe(false);
  });
});
