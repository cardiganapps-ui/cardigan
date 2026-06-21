import { supabase } from "../supabaseClient";
import { enqueue, registerHandler } from "../lib/mutationQueue";

/* ── useNoteAttachments ─────────────────────────────────────────────
   Phase 5 of the Notes premium roadmap. Image attachments for
   notes. Uses the same R2 + presigned URL plumbing as documents,
   but kept architecturally separate (no shared hook, no shared
   table) so the billing-document lifecycle and the note-media
   lifecycle don't drift.

   Upload is intentionally NOT queued — same constraint as the
   documents hook. The presigned-URL TTL + binary payload make
   it impractical to defer; offline callers get a clean error.

   Delete uses the existing /api/delete-document endpoint — its
   path validation now accepts the `notes/<userId>/...` namespace
   via the migration-073 / _r2.js update, so we don't need a
   parallel /api/delete-note-attachment route. */

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    "Authorization": `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };
}

/* Probe an image File for its natural pixel dimensions before
   upload. Persisting these in the DB lets downstream consumers
   (notePdf, image strip aspect-ratio reservations) avoid a second
   in-memory decode at render time. Best-effort — returns null if
   the browser can't decode the file (corrupt, exotic codec). */
async function probeImageDimensions(file) {
  try {
    if (typeof createImageBitmap === "function") {
      const bmp = await createImageBitmap(file);
      const out = { width: bmp.width, height: bmp.height };
      bmp.close?.();
      return out;
    }
  } catch { /* fall through to Image() */ }
  try {
    return await new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        resolve(null);
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  } catch { return null; }
}

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

// Hard-delete of the row + R2 object. Mirrors the documents handler;
// R2 failure is swallowed (orphan recoverable by audit) so we never
// block a DB delete on transient network state.
registerHandler("note_attachments.delete", async ({ id, userId, r2Path }) => {
  if (r2Path) {
    try {
      const headers = await authHeaders();
      await fetch("/api/delete-document", {
        method: "POST", headers,
        body: JSON.stringify({ path: r2Path }),
      });
    } catch { /* orphan — surfaces via audit */ }
  }
  return await supabase.from("note_attachments").delete().eq("id", id).eq("user_id", userId);
});

export function createNoteAttachmentActions(userId, attachments, setAttachments, setMutating, setMutationError, noteCrypto, setNotes) {

  /* uploadNoteAttachment
     Args: { noteId, file, onProgress? }
     Returns: the inserted row (with decrypted helper fields stripped)
              or null on failure.

     When encryption is unlocked, bytes are AES-GCM-wrapped client-side
     before upload; the row stores `encrypted=true` and the IV. The
     ciphertext is uploaded as application/octet-stream so the presigned
     GET (should it ever leak) downloads an opaque blob rather than a
     pretend image. */
  async function uploadNoteAttachment({ noteId, file, onProgress }) {
    if (!file || !noteId) return null;
    if (isOffline()) {
      setMutationError("Necesitas conexión para subir archivos.");
      return null;
    }

    setMutating(true);
    setMutationError("");

    try {
      // Probe dimensions in parallel with reading the bytes. Both
      // touch the file but the underlying browser code paths are
      // independent, so doing them together saves wall-clock time
      // on bigger photos.
      const [bytes, probedDims] = await Promise.all([
        file.arrayBuffer().then(buf => new Uint8Array(buf)),
        probeImageDimensions(file),
      ]);

      // Stable per-attachment uuid for the R2 key. The DB row gets a
      // separate uuid pk; we use the file uuid in the path so we can
      // upload BEFORE we have the row id and never have to rename.
      const attachmentUuid = crypto.randomUUID();
      const r2Path = `notes/${userId}/${noteId}/${attachmentUuid}`;

      let uploadBytes = bytes;
      let uploadContentType = file.type || "image/jpeg";
      let encrypted = false;
      let iv = null;

      // Crypto lane: wrap bytes if the vault is unlocked. canEncrypt
      // gates this — when the user hasn't set up / is locked, we
      // upload plaintext (matches the existing notes.encrypted=false
      // behaviour, same threat-model story).
      //
      // Lock-race guard: if the user locks the vault between the
      // outer check and the actual call, encryptAttachmentBytes
      // returns null. Silently uploading plaintext when the user
      // expected encryption is the worst possible outcome — refuse
      // and surface a clean error so they can re-unlock + retry.
      if (noteCrypto?.encryptAttachmentBytes && noteCrypto.canEncrypt) {
        const wrapped = await noteCrypto.encryptAttachmentBytes(bytes);
        if (!wrapped) {
          setMutationError("El cifrado se bloqueó a mitad de la subida. Desbloquea e intenta de nuevo.");
          return null;
        }
        // encryptBytes now returns raw bytes for the ciphertext — no
        // base64 round-trip needed on the upload path.
        uploadBytes = wrapped.ciphertext;
        uploadContentType = "application/octet-stream";
        encrypted = true;
        iv = wrapped.iv;
      }

      // Step 1: get presigned PUT URL
      const headers = await authHeaders();
      const presignRes = await fetch("/api/upload-url", {
        method: "POST", headers,
        body: JSON.stringify({ path: r2Path, contentType: uploadContentType }),
      });
      if (!presignRes.ok) {
        setMutationError("Error al generar URL de subida");
        return null;
      }
      const { url } = await presignRes.json();

      // Step 2: PUT bytes to R2. XHR rather than fetch so we can
      // surface upload progress to a status indicator — large
      // photos on cellular need motion or the UI feels frozen.
      const ok = await new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url, true);
        xhr.setRequestHeader("Content-Type", uploadContentType);
        if (onProgress) {
          xhr.upload.addEventListener("progress", (ev) => {
            if (ev.lengthComputable) onProgress(ev.loaded / ev.total);
          });
        }
        xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
        xhr.onerror = () => resolve(false);
        xhr.onabort = () => resolve(false);
        xhr.send(uploadBytes);
      });
      if (!ok) {
        setMutationError("Error al subir archivo");
        return null;
      }
      onProgress?.(1);

      // Step 3: insert the row. mime is the ORIGINAL image type so
      // the read path knows how to construct the Blob even when the
      // R2 bytes are octet-stream ciphertext. width/height (if the
      // probe succeeded) let the PDF / thumbnail layer reserve the
      // right aspect without a second decode pass.
      const row = {
        note_id: noteId,
        user_id: userId,
        r2_path: r2Path,
        mime: file.type || "image/jpeg",
        size_bytes: file.size,
        width: probedDims?.width || null,
        height: probedDims?.height || null,
        encrypted,
        iv,
      };
      const { data, error } = await supabase
        .from("note_attachments").insert(row).select().single();

      if (error) {
        setMutationError(error.message);
        // Best-effort R2 cleanup — same pattern as useDocuments.
        try {
          const delHeaders = await authHeaders();
          await fetch("/api/delete-document", {
            method: "POST", headers: delHeaders,
            body: JSON.stringify({ path: r2Path }),
          });
        } catch { /* leave orphan; audit will pick it up */ }
        return null;
      }

      setAttachments(prev => [data, ...prev]);
      return data;
    } catch (err) {
      setMutationError(err?.message || "Error al subir archivo");
      return null;
    } finally {
      setMutating(false);
    }
  }

  async function deleteNoteAttachment(id) {
    setMutationError("");
    const row = attachments.find(a => a.id === id);
    const r2Path = row?.r2_path;
    // Optimistic UI removal first — undo isn't surfaced for inline
    // media yet (Phase 5 v1 scope); the row simply disappears.
    setAttachments(prev => prev.filter(a => a.id !== id));
    // Mirror the server-side ON DELETE SET NULL cascade in local
    // state so any note that had this attachment as its cover
    // clears the slot immediately. Without this the UI lags one
    // refresh behind reality — the kebab still says "Cambiar
    // portada" pointing at an attachment that no longer exists.
    if (typeof setNotes === "function") {
      setNotes(prev => prev.map(n => n.cover_attachment_id === id ? { ...n, cover_attachment_id: null } : n));
    }
    if (isOffline()) {
      await enqueue("note_attachments.delete", { id, userId, r2Path });
      return true;
    }
    try {
      if (r2Path) {
        const headers = await authHeaders();
        await fetch("/api/delete-document", {
          method: "POST", headers,
          body: JSON.stringify({ path: r2Path }),
        });
      }
      const { error } = await supabase.from("note_attachments")
        .delete().eq("id", id).eq("user_id", userId);
      if (error) {
        setMutationError(error.message);
        return false;
      }
      return true;
    } catch {
      await enqueue("note_attachments.delete", { id, userId, r2Path });
      return true;
    }
  }

  return { uploadNoteAttachment, deleteNoteAttachment };
}
