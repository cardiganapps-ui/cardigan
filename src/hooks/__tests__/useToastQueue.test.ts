/**
 * @vitest-environment happy-dom
 *
 * The single app toast channel, extracted from App.tsx's AppShell.
 * Pins the queue behavior the whole app relies on: keyed de-dup, the
 * MAX_TOASTS cap (dropping oldest non-persistent first), dismiss-clears-
 * the-data-layer-error, and the mutation/fetch error → persistent toast
 * wiring.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useToastQueue } from "../useToastQueue";

const t = (k: string) => k;

afterEach(() => cleanup());

describe("useToastQueue", () => {
  it("pushes toasts and de-dups by key (one copy of a recurring message)", () => {
    const { result } = renderHook(() => useToastQueue({ t }));
    act(() => { result.current.showToast("a", "info"); });
    act(() => { result.current.showToast("b", "info", { key: "k" }); });
    act(() => { result.current.showToast("b2", "info", { key: "k" }); });
    // The two "k"-keyed toasts collapse to the latest; "a" stays.
    expect(result.current.toasts.map((x: { message: string }) => x.message)).toEqual(["a", "b2"]);
  });

  it("caps at MAX_TOASTS (5), dropping the oldest non-persistent first", () => {
    const { result } = renderHook(() => useToastQueue({ t }));
    act(() => { result.current.showToast("p", "error", { persistent: true }); });
    act(() => { for (let i = 0; i < 6; i++) result.current.showToast(`m${i}`, "info"); });
    const msgs = result.current.toasts.map((x: { message: string }) => x.message);
    expect(result.current.toasts).toHaveLength(5);
    // The persistent toast survives even though it was first in.
    expect(msgs).toContain("p");
    // The two oldest non-persistent (m0, m1) were dropped.
    expect(msgs).not.toContain("m0");
    expect(msgs).toContain("m5");
  });

  it("showSuccess pushes a success toast", () => {
    const { result } = renderHook(() => useToastQueue({ t }));
    act(() => { result.current.showSuccess("saved"); });
    expect(result.current.toasts[0]).toMatchObject({ kind: "success", message: "saved" });
  });

  it("dismissing the mutation-error toast clears the data-layer error", () => {
    const clearMutationError = vi.fn();
    const { result } = renderHook(() => useToastQueue({ t, clearMutationError }));
    let id!: number;
    act(() => { id = result.current.showToast("boom", "error", { key: "mutation-error" }) as number; });
    act(() => { result.current.dismissToast(id); });
    expect(clearMutationError).toHaveBeenCalledTimes(1);
    expect(result.current.toasts).toHaveLength(0);
  });

  it("surfaces mutationError as a persistent toast and clears it when resolved", () => {
    const { result, rerender } = renderHook(
      ({ err }: { err?: string }) => useToastQueue({ t, mutationError: err, refresh: () => {} }),
      { initialProps: { err: "save failed" } },
    );
    const errToast = result.current.toasts.find((x: { key?: string }) => x.key === "mutation-error");
    expect(errToast).toMatchObject({ persistent: true, message: "save failed" });
    // Error resolves → the keyed toast is removed.
    rerender({ err: "" });
    expect(result.current.toasts.some((x: { key?: string }) => x.key === "mutation-error")).toBe(false);
  });

  it("surfaces fetchError via the t('loadFailed') message", () => {
    const { result } = renderHook(() => useToastQueue({ t, fetchError: "x", refresh: () => {} }));
    expect(result.current.toasts.find((x: { key?: string }) => x.key === "fetch-error")).toMatchObject({
      persistent: true, message: "loadFailed",
    });
  });
});
