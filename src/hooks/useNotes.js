import { supabase } from "../supabaseClient";

export function createNoteActions(userId, notes, setNotes, setMutating, setMutationError) {

  async function createNote({ patientId, sessionId, title, content }) {
    setMutating(true);
    setMutationError("");
    const { data, error } = await supabase.from("notes").insert({
      user_id: userId, patient_id: patientId || null,
      session_id: sessionId || null,
      title: title || "", content: content || "",
    }).select().single();
    setMutating(false);
    if (error) { setMutationError(error.message); return null; }
    setNotes(prev => [data, ...prev]);
    return data;
  }

  async function updateNote(id, { title, content }) {
    setMutating(true);
    setMutationError("");
    const { data, error } = await supabase.from("notes")
      .update({ title, content })
      .eq("id", id).select("updated_at").single();
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setNotes(prev => prev.map(n => n.id === id ? { ...n, title, content, updated_at: data.updated_at } : n));
    return true;
  }

  async function updateNoteLink(id, { patientId, sessionId }) {
    setMutating(true);
    setMutationError("");
    const patch = { patient_id: patientId || null, session_id: sessionId || null };
    const { data, error } = await supabase.from("notes").update(patch).eq("id", id).select("updated_at").single();
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...patch, updated_at: data.updated_at } : n));
    return true;
  }

  async function deleteNotes(ids) {
    if (!ids?.length) return false;
    const { error } = await supabase.from("notes").delete().in("id", ids);
    if (error) { setMutationError(error.message); return false; }
    setNotes(prev => prev.filter(n => !ids.includes(n.id)));
    return true;
  }

  async function deleteNote(id) {
    const { error } = await supabase.from("notes").delete().eq("id", id);
    if (error) { setMutationError(error.message); return false; }
    setNotes(prev => prev.filter(n => n.id !== id));
    return true;
  }

  async function togglePinNote(id) {
    const note = notes.find(n => n.id === id);
    if (!note) return false;
    const pinned = !note.pinned;
    const { error } = await supabase.from("notes").update({ pinned }).eq("id", id);
    if (error) { setMutationError(error.message); return false; }
    setNotes(prev => prev.map(n => n.id === id ? { ...n, pinned } : n));
    return true;
  }

  return { createNote, updateNote, updateNoteLink, togglePinNote, deleteNote, deleteNotes };
}
