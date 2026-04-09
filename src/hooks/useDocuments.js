import { supabase } from "../supabaseClient";

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    "Authorization": `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };
}

export function createDocumentActions(userId, documents, setDocuments) {

  async function uploadDocument({ patientId, file, sessionId, name }) {
    if (!patientId || !file) return null;
    const ext = file.name.split(".").pop();
    const path = `${userId}/${patientId}/${Date.now()}.${ext}`;

    // Get presigned upload URL from API
    const headers = await authHeaders();
    const res = await fetch("/api/upload-url", {
      method: "POST",
      headers,
      body: JSON.stringify({ path, contentType: file.type || "application/octet-stream" }),
    });
    if (!res.ok) return null;
    const { url } = await res.json();

    // Upload directly to R2
    const uploadRes = await fetch(url, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type || "application/octet-stream" },
    });
    if (!uploadRes.ok) return null;

    // Save metadata to Supabase
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
      const headers = await authHeaders();
      await fetch("/api/delete-document", {
        method: "POST",
        headers,
        body: JSON.stringify({ path: doc.file_path }),
      });
    }
    const { error } = await supabase.from("documents").delete().eq("id", id);
    if (error) return false;
    setDocuments(prev => prev.filter(d => d.id !== id));
    return true;
  }

  async function getDocumentUrl(filePath) {
    const headers = await authHeaders();
    const res = await fetch("/api/document-url", {
      method: "POST",
      headers,
      body: JSON.stringify({ path: filePath }),
    });
    if (!res.ok) return null;
    const { url } = await res.json();
    return url;
  }

  return { uploadDocument, renameDocument, tagDocumentSession, deleteDocument, getDocumentUrl };
}
