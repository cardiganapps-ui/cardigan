import type { Dispatch, SetStateAction } from "react";
import { supabase } from "../supabaseClient";
import type { Database } from "../types/supabase";
import type { TablesInsert, TablesUpdate } from "../types/db";
import { enqueue, registerHandler, onReplay } from "../lib/mutationQueue";

// ── Domain row types ────────────────────────────────────────────────
interface Note {
  id: string;
  user_id?: string;
  patient_id?: string | null;
  session_id?: string | null;
  group_id?: string | null;
  title?: string;
  content?: string;
  encrypted?: boolean;
  pinned?: boolean;
  cover_attachment_id?: string | null;
  created_at?: string;
  updated_at?: string;
  _optimistic?: boolean;
  [key: string]: unknown;
}

interface EncryptResult { content: string; encrypted: boolean }
interface NoteCrypto { encrypt?: (plain: string) => EncryptResult | Promise<EncryptResult> }

type SetNotes = Dispatch<SetStateAction<Note[]>>;
type SetFlag = Dispatch<SetStateAction<boolean>>;
type SetError = Dispatch<SetStateAction<string>>;

/* createNoteActions
   `crypto` is an optional bag of { encrypt(plain) → { content, encrypted } }.
   When the user has note encryption unlocked, encrypt() returns the
   ciphertext bundle and { encrypted: true }; otherwise it returns the
   original plaintext and { encrypted: false }. Persisting the encrypted
   flag into the row tells the read path which content lane to take. */

// Offline queue handlers (registered once at module load). For note
// inserts the persisted `row` already carries the encrypted content;
// the plaintext is only kept in the optimistic React state and never
// hits IndexedDB. That keeps the queue itself encryption-aware: even
// while pending, the disk-bound payload is ciphertext for any user
// who has encryption set up.
registerHandler("notes.insert", async ({ row }: { row: Record<string, unknown> }) => {
  return await supabase.from("notes").insert(row as TablesInsert<"notes">).select().single();
});
registerHandler("notes.update", async ({ id, userId, patch }: { id: string; userId: string; patch: Record<string, unknown> }) => {
  return await supabase.from("notes").update(patch as TablesUpdate<"notes">).eq("id", id).eq("user_id", userId).select("updated_at").single();
});
registerHandler("notes.delete", async ({ id, userId }: { id: string; userId: string }) => {
  return await supabase.from("notes").delete().eq("id", id).eq("user_id", userId);
});
registerHandler("notes.delete_many", async ({ ids, userId }: { ids: string[]; userId: string }) => {
  return await supabase.from("notes").delete().eq("user_id", userId).in("id", ids);
});

// Version snapshot (Phase 2). Enqueued by createNote + updateNote
// after a successful network write. The RPC handles debounce
// (60s collapse) + cap (50 versions/note) atomically. Ciphertext
// payloads — the client-side encrypt step already happened in
// the caller before this handler runs.
//
// `debounceSeconds` is optional. RPC defaults to 60s; callers that
// must force a new version row (the restore-from-history flow —
// otherwise its pre-restore snapshot would be collapsed into the
// most-recent save and the pre-restore content would be lost
// forever) pass 0 to skip the debounce branch.
registerHandler("notes.snapshot", async ({ noteId, titleCt, contentCt, encrypted, debounceSeconds }: { noteId: string; titleCt: string; contentCt: string; encrypted?: boolean; debounceSeconds?: number }) => {
  const params: Record<string, unknown> = {
    p_note_id: noteId,
    p_title_ciphertext: titleCt,
    p_content_ciphertext: contentCt,
    p_encrypted: !!encrypted,
  };
  if (typeof debounceSeconds === "number" && debounceSeconds >= 0) {
    params.p_debounce_seconds = debounceSeconds;
  }
  return await supabase.rpc("snapshot_note", params as Database["public"]["Functions"]["snapshot_note"]["Args"]);
});

// Module-level ref so the once-registered replay listener swaps temp
// note ids in the live state holder (same pattern as usePayments /
// useSessions).
let _setNotesRef: SetNotes | null = null;
onReplay((entry: { op: string; optimisticMeta?: { tempId?: string; plaintextContent?: string } }, result: { error?: unknown; data?: Record<string, unknown> } | null) => {
  if (entry.op !== "notes.insert") return;
  if (!result || result.error || !result.data) return;
  const tempId = entry.optimisticMeta?.tempId;
  const plaintext = entry.optimisticMeta?.plaintextContent;
  if (!tempId || !_setNotesRef) return;
  const data = result.data;
  // If encrypted, swap the ciphertext-bearing server row but keep the
  // plaintext from the optimisticMeta in local state so the UI can
  // render. The encrypted flag stays true.
  const localRow = (data.encrypted && plaintext !== undefined
    ? { ...data, content: plaintext }
    : data) as Note;
  _setNotesRef(prev => prev.map(n => n.id === tempId ? localRow : n));
});

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function createNoteActions(
  userId: string,
  notes: Note[],
  setNotes: SetNotes,
  setMutating: SetFlag,
  setMutationError: SetError,
  crypto?: NoteCrypto,
) {
  _setNotesRef = setNotes;

  async function maybeEncrypt(plaintext?: string): Promise<EncryptResult> {
    if (!crypto?.encrypt) return { content: plaintext || "", encrypted: false };
    return crypto.encrypt(plaintext || "");
  }

  async function createNote({ patientId, sessionId, groupId, title, content }: { patientId?: string | null; sessionId?: string | null; groupId?: string | null; title?: string; content?: string }) {
    setMutationError("");
    const { content: storedContent, encrypted } = await maybeEncrypt(content);
    const row = {
      user_id: userId, patient_id: patientId || null,
      session_id: sessionId || null,
      group_id: groupId || null,
      title: title || "", content: storedContent,
      encrypted,
    };
    // Offline: insert a temp-id note locally + queue the insert.
    // Optimistic row carries the PLAINTEXT for display; the queue
    // entry persists only the ciphertext-bearing row.
    if (isOffline()) {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const localRow = {
        ...row, id: tempId,
        content: content || "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        pinned: false,
        _optimistic: true,
      };
      setNotes(prev => [localRow as Note, ...prev]);
      await enqueue("notes.insert", { row },
        encrypted ? { tempId, plaintextContent: content || "" } : { tempId });
      return localRow;
    }
    setMutating(true);
    let data, error;
    try {
      const res = await supabase.from("notes").insert(row).select().single();
      data = res.data; error = res.error;
    } catch {
      // Transport failure mid-flight — queue with a temp row.
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const localRow = {
        ...row, id: tempId,
        content: content || "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        pinned: false,
        _optimistic: true,
      };
      setNotes(prev => [localRow, ...prev]);
      await enqueue("notes.insert", { row },
        encrypted ? { tempId, plaintextContent: content || "" } : { tempId });
      setMutating(false);
      return localRow;
    }
    setMutating(false);
    if (error) { setMutationError(error.message); return null; }
    // Local state holds the plaintext content for display — the row
    // returned from the server has ciphertext when encrypted=true, so
    // we substitute the original plaintext back in.
    const localRow = (encrypted ? { ...data!, content: content || "" } : data!) as Note;
    setNotes(prev => [localRow, ...prev]);
    // Version snapshot (Phase 2). Fire-and-forget enqueue so the
    // returned note is the live row and the timeline gets a v1
    // captured at first save. Server RPC debounces + caps.
    enqueue("notes.snapshot", {
      noteId: data!.id,
      titleCt: data!.title || "",
      contentCt: data!.content || "",
      encrypted: !!data!.encrypted,
    }).catch(() => { /* snapshot is best-effort */ });
    return localRow;
  }

  async function updateNote(id: string, { title, content }: { title?: string; content?: string }) {
    setMutationError("");
    const { content: storedContent, encrypted } = await maybeEncrypt(content);
    const patch = { title, content: storedContent, encrypted };
    // Optimistic local update first so the UI can dismiss immediately.
    const nowIso = new Date().toISOString();
    setNotes(prev => prev.map(n => n.id === id
      ? { ...n, title, content: content || "", encrypted, updated_at: nowIso }
      : n));
    // Temp-id row: the insert hasn't drained yet. Defer the edit;
    // user can re-edit after drain.
    if (typeof id === "string" && id.startsWith("temp-")) return true;
    if (isOffline()) {
      await enqueue("notes.update", { id, userId, patch });
      return true;
    }
    setMutating(true);
    let data, error;
    try {
      const res = await supabase.from("notes")
        .update(patch).eq("id", id).eq("user_id", userId).select("updated_at").single();
      data = res.data; error = res.error;
    } catch {
      await enqueue("notes.update", { id, userId, patch });
      setMutating(false);
      return true;
    }
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    // Refine the optimistic updated_at with the server-stamped value.
    if (data?.updated_at) {
      setNotes(prev => prev.map(n => n.id === id ? ({ ...n, updated_at: data!.updated_at } as Note) : n));
    }
    // Version snapshot (Phase 2). Use the ciphertext we already
    // computed in `patch` so the snapshot matches what was just
    // persisted. RPC handles 60s debounce + 50-version cap.
    enqueue("notes.snapshot", {
      noteId: id,
      titleCt: patch.title || "",
      contentCt: patch.content || "",
      encrypted: !!patch.encrypted,
    }).catch(() => { /* snapshot is best-effort */ });
    return true;
  }

  async function updateNoteLink(id: string, { patientId, sessionId, groupId }: { patientId?: string | null; sessionId?: string | null; groupId?: string | null }) {
    setMutationError("");
    const patch: Record<string, unknown> = { patient_id: patientId || null, session_id: sessionId || null };
    if (groupId !== undefined) patch.group_id = groupId || null;
    const nowIso = new Date().toISOString();
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...patch, updated_at: nowIso } : n));
    if (typeof id === "string" && id.startsWith("temp-")) return true;
    if (isOffline()) {
      await enqueue("notes.update", { id, userId, patch });
      return true;
    }
    setMutating(true);
    let data, error;
    try {
      const res = await supabase.from("notes").update(patch as TablesUpdate<"notes">)
        .eq("id", id).eq("user_id", userId).select("updated_at").single();
      data = res.data; error = res.error;
    } catch {
      await enqueue("notes.update", { id, userId, patch });
      setMutating(false);
      return true;
    }
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    if (data?.updated_at) {
      setNotes(prev => prev.map(n => n.id === id ? ({ ...n, updated_at: data!.updated_at } as Note) : n));
    }
    return true;
  }

  async function deleteNotes(ids: string[]) {
    if (!ids?.length) return false;
    setMutationError("");
    setNotes(prev => prev.filter(n => !ids.includes(n.id)));
    // Strip temp ids — no real rows to delete server-side.
    const realIds = ids.filter(id => !(typeof id === "string" && id.startsWith("temp-")));
    if (realIds.length === 0) return true;
    if (isOffline()) {
      await enqueue("notes.delete_many", { ids: realIds, userId });
      return true;
    }
    let error;
    try {
      const res = await supabase.from("notes").delete().eq("user_id", userId).in("id", realIds);
      error = res.error;
    } catch {
      await enqueue("notes.delete_many", { ids: realIds, userId });
      return true;
    }
    if (error) { setMutationError(error.message); return false; }
    return true;
  }

  async function deleteNote(id: string) {
    setMutationError("");
    setNotes(prev => prev.filter(n => n.id !== id));
    if (typeof id === "string" && id.startsWith("temp-")) return true;
    if (isOffline()) {
      await enqueue("notes.delete", { id, userId });
      return true;
    }
    let error;
    try {
      const res = await supabase.from("notes").delete().eq("id", id).eq("user_id", userId);
      error = res.error;
    } catch {
      await enqueue("notes.delete", { id, userId });
      return true;
    }
    if (error) { setMutationError(error.message); return false; }
    return true;
  }

  /* setNoteCover — Phase E.2. Updates the note's cover_attachment_id.
     Pass null to clear the cover. Mirrors togglePinNote's pattern:
     optimistic local update, offline-aware enqueue, online write +
     in-memory rollback on error. Temp-id notes (offline-inserted)
     defer the update to drain time. */
  async function setNoteCover(id: string, attachmentId?: string | null) {
    const note = notes.find(n => n.id === id);
    if (!note) return false;
    const next = attachmentId || null;
    setMutationError("");
    setNotes(prev => prev.map(n => n.id === id ? { ...n, cover_attachment_id: next } : n));
    if (typeof id === "string" && id.startsWith("temp-")) return true;
    if (isOffline()) {
      await enqueue("notes.update", { id, userId, patch: { cover_attachment_id: next } });
      return true;
    }
    let error;
    try {
      const res = await supabase.from("notes").update({ cover_attachment_id: next }).eq("id", id).eq("user_id", userId);
      error = res.error;
    } catch {
      await enqueue("notes.update", { id, userId, patch: { cover_attachment_id: next } });
      return true;
    }
    if (error) { setMutationError(error.message); return false; }
    return true;
  }

  async function togglePinNote(id: string) {
    const note = notes.find(n => n.id === id);
    if (!note) return false;
    const pinned = !note.pinned;
    setMutationError("");
    setNotes(prev => prev.map(n => n.id === id ? { ...n, pinned } : n));
    if (typeof id === "string" && id.startsWith("temp-")) return true;
    if (isOffline()) {
      await enqueue("notes.update", { id, userId, patch: { pinned } });
      return true;
    }
    let error;
    try {
      const res = await supabase.from("notes").update({ pinned }).eq("id", id).eq("user_id", userId);
      error = res.error;
    } catch {
      await enqueue("notes.update", { id, userId, patch: { pinned } });
      return true;
    }
    if (error) { setMutationError(error.message); return false; }
    return true;
  }

  // Undo-aware note delete. Same shape as the other soft variants.
  // Temp-id notes (offline-inserted, not yet drained) are a local-
  // only delete and don't queue anything server-side on commit.
  function softDeleteNote(id: string) {
    const prev = notes.find(n => n.id === id);
    if (!prev) return { commit: async () => true, undo: () => {} };

    setMutationError("");
    setNotes(arr => arr.filter(n => n.id !== id));

    let done = false;
    return {
      async commit() {
        if (done) return true;
        done = true;
        const isOptimisticRow = typeof id === "string" && id.startsWith("temp-");
        if (isOptimisticRow) return true;
        if (isOffline()) {
          await enqueue("notes.delete", { id, userId });
          return true;
        }
        try {
          const res = await supabase.from("notes").delete().eq("id", id).eq("user_id", userId);
          if (res.error) {
            setNotes(arr => [prev, ...arr]);
            setMutationError(res.error.message);
            return false;
          }
        } catch {
          await enqueue("notes.delete", { id, userId });
        }
        return true;
      },
      undo() {
        if (done) return;
        done = true;
        setNotes(arr => [prev, ...arr]);
      },
    };
  }

  return { createNote, updateNote, updateNoteLink, togglePinNote, deleteNote, softDeleteNote, deleteNotes, setNoteCover };
}
