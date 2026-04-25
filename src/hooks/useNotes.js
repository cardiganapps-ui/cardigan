import { supabase } from "../supabaseClient";

/* createNoteActions
   `crypto` is an optional bag of { encrypt(plain) → { content, encrypted } }.
   When the user has note encryption unlocked, encrypt() returns the
   ciphertext bundle and { encrypted: true }; otherwise it returns the
   original plaintext and { encrypted: false }. Persisting the encrypted
   flag into the row tells the read path which content lane to take. */
export function createNoteActions(userId, notes, setNotes, setMutating, setMutationError, crypto) {

  async function maybeEncrypt(plaintext) {
    if (!crypto?.encrypt) return { content: plaintext || "", encrypted: false };
    return crypto.encrypt(plaintext || "");
  }

  async function createNote({ patientId, sessionId, title, content }) {
    setMutating(true);
    setMutationError("");
    const { content: storedContent, encrypted } = await maybeEncrypt(content);
    const { data, error } = await supabase.from("notes").insert({
      user_id: userId, patient_id: patientId || null,
      session_id: sessionId || null,
      title: title || "", content: storedContent,
      encrypted,
    }).select().single();
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
    setMutating(true);
    setMutationError("");
    const { content: storedContent, encrypted } = await maybeEncrypt(content);
    const { data, error } = await supabase.from("notes")
      .update({ title, content: storedContent, encrypted })
      .eq("id", id).eq("user_id", userId).select("updated_at").single();
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setNotes(prev => prev.map(n => n.id === id
      ? { ...n, title, content: content || "", encrypted, updated_at: data.updated_at }
      : n));
    return true;
  }

  async function updateNoteLink(id, { patientId, sessionId }) {
    setMutating(true);
    setMutationError("");
    const patch = { patient_id: patientId || null, session_id: sessionId || null };
    const { data, error } = await supabase.from("notes").update(patch).eq("id", id).eq("user_id", userId).select("updated_at").single();
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...patch, updated_at: data.updated_at } : n));
    return true;
  }

  async function deleteNotes(ids) {
    if (!ids?.length) return false;
    const { error } = await supabase.from("notes").delete().eq("user_id", userId).in("id", ids);
    if (error) { setMutationError(error.message); return false; }
    setNotes(prev => prev.filter(n => !ids.includes(n.id)));
    return true;
  }

  async function deleteNote(id) {
    const { error } = await supabase.from("notes").delete().eq("id", id).eq("user_id", userId);
    if (error) { setMutationError(error.message); return false; }
    setNotes(prev => prev.filter(n => n.id !== id));
    return true;
  }

  async function togglePinNote(id) {
    const note = notes.find(n => n.id === id);
    if (!note) return false;
    const pinned = !note.pinned;
    const { error } = await supabase.from("notes").update({ pinned }).eq("id", id).eq("user_id", userId);
    if (error) { setMutationError(error.message); return false; }
    setNotes(prev => prev.map(n => n.id === id ? { ...n, pinned } : n));
    return true;
  }

  return { createNote, updateNote, updateNoteLink, togglePinNote, deleteNote, deleteNotes };
}
