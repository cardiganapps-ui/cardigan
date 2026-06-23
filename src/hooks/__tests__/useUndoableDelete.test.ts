/**
 * @vitest-environment happy-dom
 *
 * useUndoableDelete — the undo-aware delete wrapper extracted from
 * AppShell. withUndoableDelete(softFn, label) returns a delete fn; calling
 * it runs softFn optimistically, shows the "Deshacer" toast, and commits
 * on timeout (or eagerly on tab-hide) unless undone. Pins that contract +
 * the guard returns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useUndoableDelete } from "../useUndoableDelete";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); cleanup(); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

describe("useUndoableDelete", () => {
  it("commits after the undo window elapses", async () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useUndoableDelete(showToast));
    const commit = vi.fn();
    const del = result.current(() => ({ commit, undo: vi.fn() }), "Sesión eliminada");

    let ret: unknown;
    await act(async () => { ret = await del(); });
    expect(ret).toBe(true);
    expect(showToast).toHaveBeenCalledWith("Sesión eliminada", "info", expect.objectContaining({ actionLabel: "Deshacer" }));
    expect(commit).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(3000); });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("undo via the toast action restores and never commits", async () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useUndoableDelete(showToast));
    const commit = vi.fn();
    const undo = vi.fn();
    const del = result.current(() => ({ commit, undo }), "x");
    await act(async () => { await del(); });

    const opts = (showToast.mock.calls[0] as Any)[2];
    act(() => opts.onRetry());
    expect(undo).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(3000); });
    expect(commit).not.toHaveBeenCalled();
  });

  it("eager-commits when the tab is hidden mid-window", async () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useUndoableDelete(showToast));
    const commit = vi.fn();
    const del = result.current(() => ({ commit, undo: vi.fn() }), "x");
    await act(async () => { await del(); });

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(commit).toHaveBeenCalledTimes(1);

    // the timer is cleared, so advancing doesn't double-commit
    act(() => { vi.advanceTimersByTime(3000); });
    expect(commit).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("returns false for a non-function softFn or a handle without commit", async () => {
    const { result } = renderHook(() => useUndoableDelete(vi.fn()));
    let a: unknown, b: unknown;
    await act(async () => { a = await result.current(null, "x")(); });
    await act(async () => { b = await result.current(() => ({ undo: vi.fn() }), "x")(); });
    expect(a).toBe(false);
    expect(b).toBe(false);
  });
});
