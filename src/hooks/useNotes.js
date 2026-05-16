import { supabase } from "../supabaseClient";
import { enqueue, registerHandler, onReplay } from "../lib/mutationQueue.js";

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
registerHandler("notes.insert", async ({ row }) => {
  return await supabase.from("notes").insert(row).select().single();
});
registerHandler("notes.update", async ({ id, userId, patch }) => {
  return await supabase.from("notes").update(patch).eq("id", id).eq("user_id", userId).select("updated_at").single();
});
registerHandler("notes.delete", async ({ id, userId }) => {
  return await supabase.from("notes").delete().eq("id", id).eq("user_id", userId);
});
registerHandler("notes.delete_many", async ({ ids, userId }) => {
  return await supabase.from("notes").delete().eq("user_id", userId).in("id", ids);
});

// Module-level ref so the once-registered replay listener swaps temp
// note ids in the live state holder (same pattern as usePayments /
// useSessions).
let _setNotesRef = null;
onReplay((entry, result) => {
  if (entry.op !== "notes.insert") return;
  if (!result || result.error || !result.data) return;
  const tempId = entry.optimisticMeta?.tempId;
  const plaintext = entry.optimisticMeta?.plaintextContent;
  if (!tempId || !_setNotesRef) return;
  const data = result.data;
  // If encrypted, swap the ciphertext-bearing server row but keep the
  // plaintext from the optimisticMeta in local state so the UI can
  // render. The encrypted flag stays true.
  const localRow = data.encrypted && plaintext !== undefined
    ? { ...data, content: plaintext }
    : data;
  _setNotesRef(prev => prev.map(n => n.id === tempId ? localRow : n));
});

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function createNoteActions(userId, notes, setNotes, setMutating, setMutationError, crypto) {
  _setNotesRef = setNotes;

  async function maybeEncrypt(plaintext) {
    if (!crypto?.encrypt) return { content: plaintext || "", encrypted: false };
    return crypto.encrypt(plaintext || "");
  }

  async function createNote({ patientId, sessionId, title, content }) {
    setMutationError("");
    const { content: storedContent, encrypted } = await maybeEncrypt(content);
    const row = {
      user_id: userId, patient_id: patientId || null,
      session_id: sessionId || null,
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
      setNotes(prev => [localRow, ...prev]);
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
    const localRow = encrypted ? { ...data, content: content || "" } : data;
    setNotes(prev => [localRow, ...prev]);
    return localRow;
  }

  async function updateNote(id, { title, content }) {
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
      setNotes(prev => prev.map(n => n.id === id ? { ...n, updated_at: data.updated_at } : n));
    }
    return true;
  }

  async function updateNoteLink(id, { patientId, sessionId }) {
    setMutationError("");
    const patch = { patient_id: patientId || null, session_id: sessionId || null };
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
      const res = await supabase.from("notes").update(patch)
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
      setNotes(prev => prev.map(n => n.id === id ? { ...n, updated_at: data.updated_at } : n));
    }
    return true;
  }

  async function deleteNotes(ids) {
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

  async function deleteNote(id) {
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

  async function togglePinNote(id) {
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

  return { createNote, updateNote, updateNoteLink, togglePinNote, deleteNote, deleteNotes };
}
