import { supabase } from "../supabaseClient";
import { maybeConvertHeic } from "../utils/heicConvert";
import { enqueue, registerHandler } from "../lib/mutationQueue.js";

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    "Authorization": `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };
}

// Offline queue handlers for the DB-only mutations. uploadDocument is
// intentionally NOT queued — the binary payload + presigned URL TTL +
// R2 PUT make it a bigger design problem. Users see an explicit
// "necesitas conexión para subir archivos" error in the upload sheet
// when offline.
registerHandler("documents.update", async ({ id, userId, patch }) => {
  return await supabase.from("documents").update(patch).eq("id", id).eq("user_id", userId).select("updated_at").maybeSingle();
});

// Delete is two server-side ops: R2 object purge (via API endpoint)
// then the DB row. Both run on replay; R2 errors are swallowed
// (orphan recoverable via audit) so we don't block the DB delete.
// authHeaders is called inside the handler so the token is fresh at
// replay time — a stale enqueue-time token would 401.
registerHandler("documents.delete", async ({ id, userId, filePath }) => {
  if (filePath) {
    try {
      const headers = await authHeaders();
      await fetch("/api/delete-document", {
        method: "POST", headers,
        body: JSON.stringify({ path: filePath }),
      });
    } catch { /* R2 orphan — audit surfaces */ }
  }
  return await supabase.from("documents").delete().eq("id", id).eq("user_id", userId);
});

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function createDocumentActions(userId, documents, setDocuments, setMutating, setMutationError) {

  async function uploadDocument({ patientId, file, sessionId, name, onProgress, kind }) {
    if (!file) return null;
    // Uploads need network — the presigned URL flow + R2 PUT don't
    // queue cleanly. Surface a clear error rather than silently
    // failing or pretending to queue.
    if (isOffline()) {
      setMutationError("Necesitas conexión para subir archivos.");
      return null;
    }
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
    setMutationError("");
    const nowIso = new Date().toISOString();
    setDocuments(prev => prev.map(d => d.id === id ? { ...d, name, updated_at: nowIso } : d));
    if (typeof id === "string" && id.startsWith("temp-")) return true;
    if (isOffline()) {
      await enqueue("documents.update", { id, userId, patch: { name } });
      return true;
    }
    setMutating(true);
    let data, error;
    try {
      const res = await supabase.from("documents")
        .update({ name }).eq("id", id).eq("user_id", userId).select("updated_at").maybeSingle();
      data = res.data; error = res.error;
    } catch {
      await enqueue("documents.update", { id, userId, patch: { name } });
      setMutating(false);
      return true;
    }
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    if (data?.updated_at) {
      setDocuments(prev => prev.map(d => d.id === id ? { ...d, updated_at: data.updated_at } : d));
    }
    return true;
  }

  async function tagDocumentSession(id, sessionId) {
    setMutationError("");
    const next = sessionId || null;
    const nowIso = new Date().toISOString();
    setDocuments(prev => prev.map(d => d.id === id ? { ...d, session_id: next, updated_at: nowIso } : d));
    if (typeof id === "string" && id.startsWith("temp-")) return true;
    if (isOffline()) {
      await enqueue("documents.update", { id, userId, patch: { session_id: next } });
      return true;
    }
    setMutating(true);
    let data, error;
    try {
      const res = await supabase.from("documents")
        .update({ session_id: next }).eq("id", id).eq("user_id", userId).select("updated_at").maybeSingle();
      data = res.data; error = res.error;
    } catch {
      await enqueue("documents.update", { id, userId, patch: { session_id: next } });
      setMutating(false);
      return true;
    }
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    if (data?.updated_at) {
      setDocuments(prev => prev.map(d => d.id === id ? { ...d, updated_at: data.updated_at } : d));
    }
    return true;
  }

  async function deleteDocument(id) {
    setMutationError("");
    const doc = documents.find(d => d.id === id);
    const filePath = doc?.file_path;
    // Optimistic removal applies whether we hit the wire, the queue,
    // or just drop a temp-id doc locally.
    setDocuments(prev => prev.filter(d => d.id !== id));
    if (typeof id === "string" && id.startsWith("temp-")) return true;
    if (isOffline()) {
      await enqueue("documents.delete", { id, userId, filePath });
      return true;
    }
    // Online: R2 first (so a failed DB delete doesn't leave the file
    // orphaned), then the row. Failures on either side fall to the
    // queue with the same args.
    try {
      if (filePath) {
        const headers = await authHeaders();
        await fetch("/api/delete-document", {
          method: "POST", headers,
          body: JSON.stringify({ path: filePath }),
        });
      }
      const { error } = await supabase.from("documents").delete().eq("id", id).eq("user_id", userId);
      if (error) { setMutationError(error.message); return false; }
      return true;
    } catch {
      await enqueue("documents.delete", { id, userId, filePath });
      return true;
    }
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