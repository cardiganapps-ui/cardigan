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
});
