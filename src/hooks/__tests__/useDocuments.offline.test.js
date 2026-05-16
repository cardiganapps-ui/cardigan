/**
 * @vitest-environment happy-dom
 *
 * Offline-path tests for document mutations (Phase 6 of offline
 * support). Covers rename, tag, delete. Upload is NOT queued — the
 * binary + presigned URL needs further infrastructure; that path
 * surfaces an explicit error when offline.
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
// HEIC conversion is only used in uploadDocument which we don't exercise.
vi.mock("../../utils/heicConvert", () => ({ maybeConvertHeic: async (f) => f }));

const { createDocumentActions } = await import("../useDocuments");
const queue = await import("../../lib/mutationQueue.js");

function setOnline(value) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true, writable: true });
}

function seed({ documents: initial = [] } = {}) {
  const documents = makeStateHolder(initial);
  const mutationError = makeStateHolder("");
  const actions = createDocumentActions(
    "user-1", documents.get(), documents,
    makeStateHolder(false), mutationError,
  );
  return { actions, documents, mutationError };
}

beforeEach(async () => {
  mock.reset();
  kvStore = {};
  await queue.clearForTest();
  await queue.init();
  setOnline(true);
});

describe("renameDocument offline path", () => {
  it("offline: applies rename locally + enqueues documents.update", async () => {
    setOnline(false);
    const ctx = seed({ documents: [{ id: "d-1", name: "old.pdf", file_path: "x", user_id: "user-1" }] });

    const ok = await ctx.actions.renameDocument("d-1", "new.pdf");

    expect(ok).toBe(true);
    expect(ctx.documents.get()[0].name).toBe("new.pdf");
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("documents.update");
    expect(queue.getEntries()[0].args.patch).toEqual({ name: "new.pdf" });
    expect(mock.calls).toHaveLength(0);
  });
});

describe("tagDocumentSession offline path", () => {
  it("offline: tags locally + enqueues documents.update", async () => {
    setOnline(false);
    const ctx = seed({ documents: [{ id: "d-1", name: "x", file_path: "x", session_id: null }] });

    const ok = await ctx.actions.tagDocumentSession("d-1", "ses-9");

    expect(ok).toBe(true);
    expect(ctx.documents.get()[0].session_id).toBe("ses-9");
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].args.patch).toEqual({ session_id: "ses-9" });
  });
});

describe("deleteDocument offline path", () => {
  it("offline: removes locally + enqueues documents.delete carrying the file path", async () => {
    setOnline(false);
    const ctx = seed({ documents: [{ id: "d-1", name: "x", file_path: "user-1/p/abc.pdf" }] });

    const ok = await ctx.actions.deleteDocument("d-1");

    expect(ok).toBe(true);
    expect(ctx.documents.get()).toHaveLength(0);
    expect(queue.getEntries()).toHaveLength(1);
    expect(queue.getEntries()[0].op).toBe("documents.delete");
    expect(queue.getEntries()[0].args).toEqual({
      id: "d-1", userId: "user-1", filePath: "user-1/p/abc.pdf",
    });
  });

  it("deleting a temp-id row removes locally without queuing", async () => {
    setOnline(true);
    const ctx = seed({ documents: [{ id: "temp-x", name: "x", file_path: "user-1/p/abc.pdf" }] });

    const ok = await ctx.actions.deleteDocument("temp-x");

    expect(ok).toBe(true);
    expect(ctx.documents.get()).toHaveLength(0);
    expect(queue.getEntries()).toHaveLength(0);
  });
});

describe("uploadDocument refuses offline (binary + presigned URL not queueable)", () => {
  it("offline: surfaces an error and returns null without enqueueing", async () => {
    setOnline(false);
    const ctx = seed();
    const fakeFile = new File(["payload"], "x.pdf", { type: "application/pdf" });

    const res = await ctx.actions.uploadDocument({ patientId: "p-1", file: fakeFile });

    expect(res).toBeNull();
    expect(ctx.mutationError.get()).toMatch(/conexión/);
    expect(queue.getEntries()).toHaveLength(0);
  });
});
