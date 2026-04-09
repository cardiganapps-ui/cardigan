import { supabase } from "../supabaseClient";

const BUCKET = "documents";

export function createDocumentActions(userId, documents, setDocuments) {

  async function uploadDocument({ patientId, file, sessionId, name }) {
    if (!patientId || !file) return null;
    const ext = file.name.split(".").pop();
    const path = `${userId}/${patientId}/${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, file);
    if (uploadErr) return null;
    const { data, error } = await supabase.from("documents").insert({
      user_id: userId,
      patient_id: patientId,
      session_id: sessionId || null,
      name: name || file.name,
      file_path: path,
      file_type: file.type || "application/octet-stream",
      file_size: file.size,
    }).select().single();
    if (error) return null;
    setDocuments(prev => [data, ...prev]);
    return data;
  }

  async function renameDocument(id, name) {
    const { error } = await supabase.from("documents")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return false;
    setDocuments(prev => prev.map(d => d.id === id ? { ...d, name, updated_at: new Date().toISOString() } : d));
    return true;
  }

  async function tagDocumentSession(id, sessionId) {
    const { error } = await supabase.from("documents")
      .update({ session_id: sessionId || null, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return false;
    setDocuments(prev => prev.map(d => d.id === id ? { ...d, session_id: sessionId || null, updated_at: new Date().toISOString() } : d));
    return true;
  }

  async function deleteDocument(id) {
    const doc = documents.find(d => d.id === id);
    if (doc?.file_path) {
      await supabase.storage.from(BUCKET).remove([doc.file_path]);
    }
    const { error } = await supabase.from("documents").delete().eq("id", id);
    if (error) return false;
    setDocuments(prev => prev.filter(d => d.id !== id));
    return true;
  }

  function getDocumentUrl(filePath) {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
    return data?.publicUrl || null;
  }

  return { uploadDocument, renameDocument, tagDocumentSession, deleteDocument, getDocumentUrl };
}
