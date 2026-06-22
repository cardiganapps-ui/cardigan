/**
 * @vitest-environment happy-dom
 *
 * happy-dom because the IndexedDB shim and `window` symbols only exist
 * in a DOM environment. The queue lib is otherwise framework-agnostic.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

// Reset between tests: re-import the module so its module-level state
// (entries cache, handler registry, subscribers) starts fresh.
let mq: Row;
beforeEach(async () => {
  vi.resetModules();
  // Fake an empty IndexedDB by mocking idbKv to in-memory storage.
  // happy-dom doesn't ship a real IDB; the mock is cleaner than
  // polyfilling for what we're testing.
  const store: Record<string, Row> = {};
  vi.doMock("../idbKv.js", () => ({
    kvGet: async (k: Row) => store[k],
    kvSet: async (k: Row, v: Row) => { store[k] = v; },
    kvDelete: async (k: Row) => { delete store[k]; },
    kvAvailable: async () => true,
  }));
  mq = await import("../mutationQueue");
  await mq.init();
});

describe("mutationQueue", () => {
  it("enqueue + drain happy path runs handler in order and clears the queue", async () => {
    const seen: Row[] = [];
    mq.registerHandler("test.a", async (args: Row) => { seen.push(["a", args.x]); return { data: { id: args.x } }; });
    mq.registerHandler("test.b", async (args: Row) => { seen.push(["b", args.x]); return { data: { id: args.x } }; });

    await mq.enqueue("test.a", { x: 1 });
    await mq.enqueue("test.b", { x: 2 });
    await mq.enqueue("test.a", { x: 3 });

    const result = await mq.drain();

    expect(result).toEqual({ drained: 3, remaining: 0, conflicts: 0 });
    expect(seen).toEqual([["a", 1], ["b", 2], ["a", 3]]);
    expect(mq.getEntries()).toEqual([]);
  });

  it("handler error halts drain at the failing entry and preserves order", async () => {
    let calls = 0;
    mq.registerHandler("test.fail-once", async () => {
      calls += 1;
      if (calls === 1) return { error: { message: "network" } };
      return { data: { ok: true } };
    });

    await mq.enqueue("test.fail-once", { i: 1 });
    await mq.enqueue("test.fail-once", { i: 2 });

    const first = await mq.drain();
    // First call errored, queue still has 2 entries (the head wasn't shifted).
    expect(first).toEqual({ drained: 0, remaining: 2, conflicts: 0 });
    expect(mq.getEntries()[0].lastError).toBe("network");
    expect(mq.getEntries()[0].attempts).toBe(1);

    // Retry — first now succeeds, second runs and succeeds.
    const second = await mq.drain();
    expect(second).toEqual({ drained: 2, remaining: 0, conflicts: 0 });
  });

  it("missing handler leaves the entry in queue without throwing", async () => {
    await mq.enqueue("unknown.op", { x: 1 });
    const result = await mq.drain();
    expect(result.drained).toBe(0);
    expect(result.remaining).toBe(1);
    expect(mq.getEntries()[0].lastError).toContain("no handler");
  });

  it("subscribers receive snapshots on enqueue and drain", async () => {
    const calls: Row[] = [];
    mq.subscribe((entries: Row) => calls.push(entries.length));

    mq.registerHandler("test.ok", async () => ({ data: { ok: true } }));
    await mq.enqueue("test.ok", { x: 1 });
    await mq.enqueue("test.ok", { x: 2 });
    await mq.drain();

    // Initial snapshot (0), +1, +2, ... drain notifies per pop (1, 0).
    // We don't pin exact sequence (depends on init/notify timing), but
    // the LAST snapshot must be 0 after a clean drain.
    expect(calls[0]).toBe(0); // initial on subscribe
    expect(calls.at(-1)).toBe(0); // after drain
    expect(calls).toContain(2); // peak
  });

  it("onReplay fires per successful drain, not on enqueue", async () => {
    mq.registerHandler("test.replay", async (args: Row) => ({ data: { echo: args.x } }));
    const replayed: Row[] = [];
    mq.onReplay((entry: Row, result: Row) => replayed.push([entry.args.x, result.data.echo]));

    await mq.enqueue("test.replay", { x: 42 });
    expect(replayed).toEqual([]); // not yet

    await mq.drain();
    expect(replayed).toEqual([[42, 42]]);
  });

  it("entries persist optimisticMeta so the replay listener can swap temp ids", async () => {
    mq.registerHandler("test.persist", async () => ({ data: { id: "real-1" } }));
    let received: Row;
    mq.onReplay((entry: Row, result: Row) => { received = { meta: entry.optimisticMeta, real: result.data.id }; });

    await mq.enqueue("test.persist", { row: {} }, { tempId: "temp-abc" });
    await mq.drain();

    expect(received).toEqual({ meta: { tempId: "temp-abc" }, real: "real-1" });
  });

  it("drain aggregates the per-entry `conflict` flag into the result count", async () => {
    let i = 0;
    mq.registerHandler("test.maybe-conflict", async () => {
      i += 1;
      // Every other entry "conflicts" with a remote write.
      return { data: { ok: true }, conflict: i % 2 === 1 };
    });

    await mq.enqueue("test.maybe-conflict", {});
    await mq.enqueue("test.maybe-conflict", {});
    await mq.enqueue("test.maybe-conflict", {});

    const result = await mq.drain();
    expect(result).toEqual({ drained: 3, remaining: 0, conflicts: 2 });
  });

  it("re-entrant drain() returns immediately instead of double-running handlers", async () => {
    let running = 0;
    let peak = 0;
    mq.registerHandler("test.slow", async () => {
      running += 1; peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, 10));
      running -= 1;
      return { data: { ok: true } };
    });

    await mq.enqueue("test.slow", {});
    await mq.enqueue("test.slow", {});

    await Promise.all([mq.drain(), mq.drain()]);
    expect(peak).toBe(1); // never two handlers in flight at once
  });
});

  it("dead-letters a permanently-failing entry after MAX attempts and unblocks the queue", async () => {
    let bCalls = 0;
    // 'bad' always errors (permanent failure, e.g. check-constraint).
    mq.registerHandler("test.bad", async () => ({ error: { message: "23514 check constraint" } }));
    mq.registerHandler("test.good", async () => { bCalls += 1; return { data: { ok: true } }; });

    await mq.enqueue("test.bad", { x: 1 });
    await mq.enqueue("test.good", { x: 2 });

    // Each drain retries the head once then bails (transient assumption).
    // The good entry stays blocked behind the bad one until it's dead-lettered.
    for (let i = 0; i < 4; i++) {
      const r = await mq.drain();
      expect(r.remaining).toBe(2);     // still wedged, retrying
      expect(bCalls).toBe(0);          // good entry not reached yet
    }
    expect(mq.getEntries()[0].attempts).toBe(4);

    // 5th drain hits MAX_DRAIN_ATTEMPTS: the bad entry is moved to the
    // dead-letter list and draining CONTINUES to the good entry.
    const final = await mq.drain();
    expect(final.drained).toBe(1);     // the good entry drained
    expect(final.remaining).toBe(0);
    expect(bCalls).toBe(1);
    expect(mq.getEntries()).toEqual([]);

    const dl = mq.getDeadLetter();
    expect(dl.length).toBe(1);
    expect(dl[0].op).toBe("test.bad");
    expect(dl[0].attempts).toBe(5);
    expect(dl[0].lastError).toMatch(/23514/);
  });

  it("retryDeadLetter re-queues set-aside entries with attempts reset", async () => {
    mq.registerHandler("test.bad", async () => ({ error: { message: "boom" } }));
    await mq.enqueue("test.bad", { x: 1 });
    for (let i = 0; i < 5; i++) await mq.drain();
    expect(mq.getDeadLetter().length).toBe(1);
    expect(mq.getEntries().length).toBe(0);

    const revived = await mq.retryDeadLetter();
    expect(revived).toBe(1);
    expect(mq.getDeadLetter().length).toBe(0);
    const entries = mq.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].op).toBe("test.bad");
    expect(entries[0].attempts).toBe(0);
    expect(entries[0].lastError).toBe(null);
  });

  it("drops structurally-invalid persisted entries on load", async () => {
    // Persist a mix of valid and malformed entries directly, then re-init.
    vi.resetModules();
    const store: Record<string, Row> = {
      mutation_queue_v1: [
        { id: "ok", op: "test.x", args: { a: 1 }, optimisticMeta: null, createdAt: 1, attempts: 0, lastError: null },
        { op: "no-id", args: {} },           // missing id
        { id: "no-op", args: {} },           // missing op
        null,                                  // junk
        "garbage",                             // junk
      ],
    };
    vi.doMock("../idbKv.js", () => ({
      kvGet: async (k: Row) => store[k],
      kvSet: async (k: Row, v: Row) => { store[k] = v; },
      kvDelete: async (k: Row) => { delete store[k]; },
      kvAvailable: async () => true,
    }));
    const fresh = await import("../mutationQueue");
    await fresh.init();
    const entries = fresh.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].id).toBe("ok");
  });
