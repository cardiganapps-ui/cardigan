import { supabase } from "../supabaseClient";
import { maybeConvertHeic } from "../utils/heicConvert";

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    "Authorization": `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };
}

export function createDocumentActions(userId, documents, setDocuments, setMutating, setMutationError) {

  async function uploadDocument({ patientId, file, sessionId, name, onProgress, kind }) {
    if (!file) return null;
    setMutating(true);
    setMutationError("");
    // iPhones default to HEIC, which Anthropic vision can't read and
    // most non-Safari browsers can't render. Convert to JPEG up-front
    // so every downstream surface (OCR, viewer, archive) gets a
    // format it understands. No-op for non-HEIC files; falls back to
    // the original file if conversion fails so upload still proceeds.
    const uploadFile = await maybeConvertHeic(file);
    const ext = uploadFile.name.split(".").pop();
    // kind=receipt → expense receipts live under _expenses/, never tied to
    // a patient. Default kind=patient preserves the prior signature.
    const docKind = kind === "receipt" ? "receipt" : "patient";
    const folder = docKind === "receipt" ? "_expenses" : (patientId || "_general");
    const path = `${userId}/${folder}/${Date.now()}.${ext}`;

    // Get presigned upload URL from API
    const headers = await authHeaders();
    const res = await fetch("/api/upload-url", {
      method: "POST",
      headers,
      body: JSON.stringify({ path, contentType: uploadFile.type || "application/octet-stream" }),
    });
    if (!res.ok) { setMutating(false); setMutationError("Error al generar URL de subida"); return null; }
    const { url } = await res.json();

    // Upload directly to R2 via XHR so we can surface progress
    // events. fetch() doesn't expose a body-upload progress callback;
    // for files in the MB range the user needs to see motion or the
    // upload reads as frozen. The onProgress callback is optional —
    // call sites that don't care (background uploads, future
    // automation) just omit it and lose nothing.
    const ok = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url, true);
      xhr.setRequestHeader("Content-Type", uploadFile.type || "application/octet-stream");
      if (onProgress) {
        xhr.upload.addEventListener("progress", (ev) => {
          if (ev.lengthComputable) onProgress(ev.loaded / ev.total);
        });
      }
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
      xhr.onerror = () => resolve(false);
      xhr.onabort = () => resolve(false);
      xhr.send(uploadFile);
    });
    if (!ok) { setMutating(false); setMutationError("Error al subir archivo"); return null; }
    onProgress?.(1); // belt — guarantee the bar lands at 100% even if the
                     //         last progress event was rounded down

    // Save metadata to Supabase
    const { data, error } = await supabase.from("documents").insert({
      user_id: userId,
      patient_id: docKind === "receipt" ? null : (patientId || null),
      session_id: docKind === "receipt" ? null : (sessionId || null),
      name: name || uploadFile.name,
      file_path: path,
      file_type: uploadFile.type || "application/octet-stream",
      file_size: uploadFile.size,
      kind: docKind,
    }).select().single();
    setMutating(false);
    if (error) {
      setMutationError(error.message);
      // Clean up orphaned R2 file
      const delHeaders = await authHeaders();
      await fetch("/api/delete-document", {
        method: "POST", headers: delHeaders,
        body: JSON.stringify({ path }),
      }).catch(() => {});
      return null;
    }
    setDocuments(prev => [data, ...prev]);
    return data;
  }

  async function renameDocument(id, name) {
    setMutating(true);
    setMutationError("");
    const { data, error } = await supabase.from("documents")
      .update({ name })
      .eq("id", id).eq("user_id", userId).select("updated_at").single();
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setDocuments(prev => prev.map(d => d.id === id ? { ...d, name, updated_at: data.updated_at } : d));
    return true;
  }

  async function tagDocumentSession(id, sessionId) {
    setMutating(true);
    setMutationError("");
    const { data, error } = await supabase.from("documents")
      .update({ session_id: sessionId || null })
      .eq("id", id).eq("user_id", userId).select("updated_at").single();
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setDocuments(prev => prev.map(d => d.id === id ? { ...d, session_id: sessionId || null, updated_at: data.updated_at } : d));
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
    const { error } = await supabase.from("documents").delete().eq("id", id).eq("user_id", userId);
    if (error) { setMutationError(error.message); return false; }
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
