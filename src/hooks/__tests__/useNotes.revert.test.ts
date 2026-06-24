/**
 * @vitest-environment happy-dom
 *
 * Revert-on-error tests for note mutations (WS-2 / integrity hardening).
 *
 * Optimistic note edits must NOT survive a rejected server write — otherwise
 * the editor shows content the database refused, the exact "UI lies about
 * what's saved" class the prime directive forbids for money and that applies
 * equally to clinical notes. usePayments/useSessions already revert; these
 * tests lock the same contract onto useNotes. Mirrors the offline-path
 * scaffolding in useNotes.offline.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeSupabaseMock, makeStateHolder } from "../../test/mockSupabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const mock = makeSupabaseMock();

let kvStore: Record<string, Row> = {};
vi.mock("../../lib/idbKv.js", () => ({
  kvGet: async (k: Row) => kvStore[k],
  kvSet: async (k: Row, v: Row) => { kvStore[k] = v; },
  kvDelete: async (k: Row) => { delete kvStore[k]; },
  kvAvailable: async () => true,
}));

vi.mock("../../supabaseClient", () => ({
  get supabase() { return mock.supabase; },
}));

const { createNoteActions } = await import("../useNotes");
const queue: Row = await import("../../lib/mutationQueue");

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true, writable: true });
}

function seed({ notes: initialNotes = [] as Row[] } = {}) {
  const notes = makeStateHolder(initialNotes);
  const mutationError = makeStateHolder("");
  const actions = createNoteActions(
    "user-1", notes.get(), notes,
    makeStateHolder(false), mutationError,
    null as Row, // no crypto bag — tests stay plaintext
  );
  return { actions, notes, mutationError };
}

beforeEach(async () => {
  mock.reset();
  kvStore = {};
  await queue.clearForTest();
  await queue.init();
  setOnline(true);
});

describe("updateNote revert-on-error", () => {
  it("reverts title + content to the pre-edit row when the server rejects the write", async () => {
    const ctx = seed({ notes: [{ id: "n-1", title: "old", content: "old body", encrypted: false }] });
    // Server rejects the update (e.g. RLS / constraint / version conflict).
    mock.enqueue("notes", { data: null, error: { message: "permission denied" } });

    const ok = await ctx.actions.updateNote("n-1", { title: "new", content: "new body" });

    expect(ok).toBe(false);
    // The optimistic edit must be rolled back — not left showing "new".
    expect(ctx.notes.get()[0].title).toBe("old");
    expect(ctx.notes.get()[0].content).toBe("old body");
    expect(ctx.mutationError.get()).toBe("permission denied");
  });

  it("keeps the new value when the server accepts the write", async () => {
    const ctx = seed({ notes: [{ id: "n-1", title: "old", content: "old body", encrypted: false }] });
    mock.enqueue("notes", { data: { updated_at: "2026-06-24T00:00:00Z" }, error: null });

    const ok = await ctx.actions.updateNote("n-1", { title: "new", content: "new body" });

    expect(ok).toBe(true);
    expect(ctx.notes.get()[0].title).toBe("new");
    expect(ctx.notes.get()[0].content).toBe("new body");
  });
});

describe("togglePinNote revert-on-error", () => {
  it("flips pinned back when the server rejects the write", async () => {
    const ctx = seed({ notes: [{ id: "n-1", title: "x", content: "y", pinned: false }] });
    mock.enqueue("notes", { data: null, error: { message: "permission denied" } });

    const ok = await ctx.actions.togglePinNote("n-1");

    expect(ok).toBe(false);
    expect(ctx.notes.get()[0].pinned).toBe(false);
    expect(ctx.mutationError.get()).toBe("permission denied");
  });
});

describe("setNoteCover revert-on-error", () => {
  it("restores the prior cover when the server rejects the write", async () => {
    const ctx = seed({ notes: [{ id: "n-1", title: "x", content: "y", cover_attachment_id: "att-old" }] });
    mock.enqueue("notes", { data: null, error: { message: "permission denied" } });

    const ok = await ctx.actions.setNoteCover("n-1", "att-new");

    expect(ok).toBe(false);
    expect(ctx.notes.get()[0].cover_attachment_id).toBe("att-old");
    expect(ctx.mutationError.get()).toBe("permission denied");
  });
});
