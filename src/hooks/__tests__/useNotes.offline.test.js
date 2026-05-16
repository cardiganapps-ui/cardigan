/**
 * @vitest-environment happy-dom
 *
 * Offline-path tests for note mutations (Phase 3 of offline support).
 * Same scaffolding pattern as usePayments.offline / useSessions.offline.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeSupabaseMock, makeStateHolder } from "../../test/mockSupabase";

const mock = makeSupabaseMock();

let kvStore = {};
vi.mock("../../lib/idbKv.js", () => ({
  kvGet: async (k) => kvStore[k],
  kvSet: async (k, v) => { kvStore[k] = v; },
  kvDelete: async (k) => { delete kvStore[k]; },
  kvAvailable: async () => true,
}));

vi.mock("../../supabaseClient", () => ({
  get supabase() { return mock.supabase; },
}));

const { createNoteActions } = await import("../useNotes");
const queue = await import("../../lib/mutationQueue.js");

function setOnline(value) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true, writable: true });
}

async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

function seed({ notes: initialNotes = [] } = {}) {
  const notes = makeStateHolder(initialNotes);
  const actions = createNoteActions(
    "user-1", notes.get(), notes,
    makeStateHolder(false), makeStateHolder(""),
    null, // no crypto bag — tests stay plaintext
  );
  return { actions, notes };
}

beforeEach(async () => {
  mock.reset();
  kvStore = {};
  await queue.clearForTest();
  await queue.init();
  setOnline(true);
});

describe("createNote offline path", () => {
  it("offline: inserts temp-id row + enqueues notes.insert; no wire call", async () => {
    setOnline(false);
    const ctx = seed();

    const row = await ctx.actions.createNote({ patientId: "pat-1", sessionId: null, title: "Plan", content: "Refer to PT" });

    expect(row).toBeTruthy();
    expect(row.id.startsWith("temp-")).toBe(true);
    expect(ctx.notes.get()).toHaveLength(1);
    expect(ctx.notes.get()[0]._optimistic).toBe(true);
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("notes.insert");
    expect(queue.getEntries()[0].args.row.title).toBe("Plan");
    expect(queue.getEntries()[0].args.row.content).toBe("Refer to PT");
    expect(queue.getEntries()[0].optimisticMeta.tempId).toBe(row.id);
    expect(mock.calls).toHaveLength(0);
  });

  it("draining swaps temp-id for server row", async () => {
    setOnline(false);
    const ctx = seed();
    const local = await ctx.actions.createNote({ patientId: "pat-1", sessionId: null, title: "Hi", content: "X" });

    setOnline(true);
    mock.enqueue("notes", { data: { id: "real-n-1", patient_id: "pat-1", session_id: null, title: "Hi", content: "X", encrypted: false, pinned: false, created_at: "now", updated_at: "now" }, error: null });

    await queue.drain();
    await flush();

    expect(ctx.notes.get()[0].id).toBe("real-n-1");
    expect(ctx.notes.get()[0]._optimistic).toBeUndefined();
    // Plaintext-preservation path doesn't apply here (no crypto), so
    // the local row's content matches the server row directly.
    expect(ctx.notes.get()[0].content).toBe("X");
    // The local copy of `local` shouldn't be holding a stale id — the
    // setter replaced the entry. Sanity:
    expect(local.id.startsWith("temp-")).toBe(true);
  });
});

describe("updateNote offline path", () => {
  it("offline: applies optimistic patch + enqueues notes.update; no wire call", async () => {
    setOnline(false);
    const ctx = seed({ notes: [{ id: "n-1", title: "old", content: "old body", encrypted: false }] });

    const ok = await ctx.actions.updateNote("n-1", { title: "new", content: "new body" });

    expect(ok).toBe(true);
    expect(ctx.notes.get()[0].title).toBe("new");
    expect(ctx.notes.get()[0].content).toBe("new body");
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("notes.update");
    expect(queue.getEntries()[0].args.patch.title).toBe("new");
    expect(mock.calls).toHaveLength(0);
  });

  it("temp-id row: applies optimistic locally and skips both wire and queue", async () => {
    setOnline(true);
    const ctx = seed({ notes: [{ id: "temp-xyz", title: "old", content: "x", encrypted: false }] });

    const ok = await ctx.actions.updateNote("temp-xyz", { title: "new", content: "y" });

    expect(ok).toBe(true);
    expect(ctx.notes.get()[0].title).toBe("new");
    expect(queue.getEntries()).toHaveLength(0);
    expect(mock.calls).toHaveLength(0);
  });
});

describe("deleteNote offline path", () => {
  it("offline: removes locally + enqueues notes.delete", async () => {
    setOnline(false);
    const ctx = seed({ notes: [{ id: "n-1", title: "x", content: "y" }] });

    const ok = await ctx.actions.deleteNote("n-1");

    expect(ok).toBe(true);
    expect(ctx.notes.get()).toHaveLength(0);
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("notes.delete");
    expect(queue.getEntries()[0].args.id).toBe("n-1");
  });

  it("temp-id delete: removes locally without queuing", async () => {
    setOnline(true);
    const ctx = seed({ notes: [{ id: "temp-q", title: "x", content: "y" }] });

    const ok = await ctx.actions.deleteNote("temp-q");

    expect(ok).toBe(true);
    expect(ctx.notes.get()).toHaveLength(0);
    expect(queue.getEntries()).toHaveLength(0);
  });
});

describe("togglePinNote offline path", () => {
  it("offline: flips pinned locally + enqueues a notes.update with the new pinned value", async () => {
    setOnline(false);
    const ctx = seed({ notes: [{ id: "n-1", title: "x", content: "y", pinned: false }] });

    const ok = await ctx.actions.togglePinNote("n-1");

    expect(ok).toBe(true);
    expect(ctx.notes.get()[0].pinned).toBe(true);
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("notes.update");
    expect(queue.getEntries()[0].args.patch).toEqual({ pinned: true });
  });
});
