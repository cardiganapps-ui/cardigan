import { supabase } from "../supabaseClient";

export function createNoteActions(userId, notes, setNotes, setMutating, setMutationError) {

  async function createNote({ patientId, sessionId, title, content }) {
    if (!patientId) return null;
    setMutating(true);
    setMutationError("");
    const { data, error } = await supabase.from("notes").insert({
      user_id: userId, patient_id: patientId,
      session_id: sessionId || null,
      title: title || "", content: content || "",
    }).select().single();
    setMutating(false);
    if (error) { setMutationError(error.message); return null; }
    setNotes(prev => [data, ...prev]);
    return data;
  }

  async function updateNote(id, { title, content }) {
    const { error } = await supabase.from("notes")
      .update({ title, content, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) { setMutationError(error.message); return false; }
    setNotes(prev => prev.map(n => n.id === id ? { ...n, title, content, updated_at: new Date().toISOString() } : n));
    return true;
  }

  async function deleteNote(id) {
    const { error } = await supabase.from("notes").delete().eq("id", id);
    if (error) { setMutationError(error.message); return false; }
    setNotes(prev => prev.filter(n => n.id !== id));
    return true;
  }

  return { createNote, updateNote, deleteNote };
}
