/**
 * @vitest-environment happy-dom
 *
 * useMutationQueue React-surface tests — focuses on the
 * lastDrainResult + acknowledgeDrain seam (Phase 5 of offline support)
 * because that's the new contract App.jsx + OfflineBanner depend on.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

let kvStore = {};
vi.mock("../../lib/idbKv.js", () => ({
  kvGet: async (k) => kvStore[k],
  kvSet: async (k, v) => { kvStore[k] = v; },
  kvDelete: async (k) => { delete kvStore[k]; },
  kvAvailable: async () => true,
}));

const queue = await import("../../lib/mutationQueue.js");
const { useMutationQueue } = await import("../useMutationQueue.js");

function setOnline(value) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true, writable: true });
}

async function flushMicrotasks() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(async () => {
  kvStore = {};
  await queue.clearForTest();
  await queue.init();
  setOnline(true);
});

describe("useMutationQueue lastDrainResult", () => {
  it("manual flush sets lastDrainResult once a non-empty drain completes", async () => {
    queue.registerHandler("test.ok", async () => ({ data: { ok: true } }));
    await queue.enqueue("test.ok", { x: 1 });
    await queue.enqueue("test.ok", { x: 2 });

    const { result } = renderHook(() => useMutationQueue());

    // Snapshot is captured eagerly in useState — flush microtasks so
    // the post-init subscribe notification lands.
    await act(async () => { await flushMicrotasks(); });
    expect(result.current.entries.length).toBe(2);
    expect(result.current.lastDrainResult).toBeNull();

    await act(async () => { await result.current.flush(); });
    expect(result.current.lastDrainResult).toMatchObject({ drained: 2, remaining: 0 });
    expect(typeof result.current.lastDrainResult.at).toBe("number");
  });

  it("acknowledgeDrain clears lastDrainResult so the same result doesn't re-fire", async () => {
    queue.registerHandler("test.ok", async () => ({ data: { ok: true } }));
    await queue.enqueue("test.ok", {});

    const { result } = renderHook(() => useMutationQueue());
    await act(async () => { await result.current.flush(); });
    expect(result.current.lastDrainResult).not.toBeNull();

    act(() => { result.current.acknowledgeDrain(); });
    expect(result.current.lastDrainResult).toBeNull();
  });

  it("a no-op drain (empty queue) does NOT set lastDrainResult", async () => {
    const { result } = renderHook(() => useMutationQueue());
    await act(async () => { await result.current.flush(); });
    expect(result.current.lastDrainResult).toBeNull();
  });
});
