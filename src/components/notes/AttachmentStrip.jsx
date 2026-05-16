import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useT } from "../../i18n/index.jsx";
import { useCardigan } from "../../context/CardiganContext";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { supabase } from "../../supabaseClient";
import { IconX, IconTrash } from "../Icons";
import { haptic } from "../../utils/haptics";

/* ── AttachmentStrip ──────────────────────────────────────────────
   Phase 5 of the Notes premium roadmap. Horizontal strip of image
   thumbnails sitting below the editor body. Doesn't render media
   inside the contentEditable — too many edge cases with the
   line-based model, and a strip reads better on mobile anyway.

   Each tile shows the thumb + a delete chip; tapping the thumb
   opens a fullscreen lightbox for inspection.

   Blob URL cache:
     The presigned GET URL has a 5-minute TTL. We fetch each
     attachment once on mount, materialise a Blob URL, and stash
     it keyed by attachment id. The cache is component-scoped
     (per editor mount) so a re-open re-fetches — the right
     trade-off vs. a global cache with revoke-on-eviction. URLs
     are revoked on unmount.

   Encryption:
     For encrypted rows, the fetched bytes are AES-GCM ciphertext.
     We use the noteCrypto bag from context to decrypt with the
     stored IV before constructing the Blob. The constructed Blob
     uses the ORIGINAL mime from the DB row, not the octet-stream
     R2 served — so the browser renders it as a real image. */

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    "Authorization": `Bearer ${session?.access_token}`,
    "Content-Type": "application/json",
  };
}

async function fetchPresigned(path, mime) {
  const headers = await authHeaders();
  const res = await fetch("/api/note-attachment-url", {
    method: "POST",
    headers,
    body: JSON.stringify({ path, mime: mime || "application/octet-stream" }),
  });
  if (!res.ok) return null;
  const { url } = await res.json();
  return url || null;
}

export function AttachmentStrip({ noteId }) {
  const { t } = useT();
  const { noteAttachments, noteCrypto, deleteNoteAttachment, showToast, setHideFab } = useCardigan();

  const rows = useMemo(
    () => (noteAttachments || []).filter(a => a.note_id === noteId),
    [noteAttachments, noteId]
  );

  // id → { url: string, failed?: boolean }
  const [tiles, setTiles] = useState({});
  // id → object-URL string. Map (not Set) so we can revoke per-id
  // when a row leaves the list; the previous Set-based version
  // leaked one blob URL per deleted attachment until unmount.
  const objectUrlsRef = useRef(new Map());
  const [lightboxId, setLightboxId] = useState(null);

  // Resolve every attachment row into a renderable Blob URL.
  // Encrypted rows go through the bytes lane (fetch → decrypt →
  // Blob); unencrypted rows can use the presigned URL directly
  // since R2 serves the original mime + an inline disposition.
  useEffect(() => {
    let alive = true;
    const tracked = objectUrlsRef.current;

    // Prune state + revoke blob URLs whose attachment row is gone.
    // Without this, deleting an attachment leaks its blob URL until
    // the editor unmounts AND keeps a stale `tiles` entry forever.
    const liveIds = new Set(rows.map(r => r.id));
    for (const [id, url] of Array.from(tracked.entries())) {
      if (!liveIds.has(id)) {
        URL.revokeObjectURL(url);
        tracked.delete(id);
      }
    }
    setTiles(prev => {
      let changed = false;
      const next = {};
      for (const key of Object.keys(prev)) {
        if (liveIds.has(key)) next[key] = prev[key];
        else changed = true;
      }
      return changed ? next : prev;
    });

    rows.forEach(async (row) => {
      if (tiles[row.id]) return; // already resolved / failed once
      try {
        if (!row.encrypted) {
          const url = await fetchPresigned(row.r2_path, row.mime);
          if (!alive) return;
          if (!url) {
            setTiles(prev => ({ ...prev, [row.id]: { failed: true } }));
            return;
          }
          setTiles(prev => ({ ...prev, [row.id]: { url } }));
          return;
        }
        // Encrypted lane: fetch ciphertext bytes, decrypt, build
        // an object URL keyed off the original mime.
        if (!noteCrypto?.decryptAttachmentBytes) {
          setTiles(prev => ({ ...prev, [row.id]: { failed: true } }));
          return;
        }
        const url = await fetchPresigned(row.r2_path, "application/octet-stream");
        if (!url) {
          setTiles(prev => ({ ...prev, [row.id]: { failed: true } }));
          return;
        }
        const r = await fetch(url);
        if (!r.ok) {
          setTiles(prev => ({ ...prev, [row.id]: { failed: true } }));
          return;
        }
        const buf = new Uint8Array(await r.arrayBuffer());
        // Re-base64 the bytes for the decrypt helper — it accepts the
        // same envelope the upload path emitted.
        let bin = "";
        for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
        const ctBase64 = btoa(bin);
        const plain = await noteCrypto.decryptAttachmentBytes(ctBase64, row.iv);
        if (!alive) return;
        if (!plain) {
          setTiles(prev => ({ ...prev, [row.id]: { failed: true } }));
          return;
        }
        const blob = new Blob([plain], { type: row.mime || "image/jpeg" });
        const objectUrl = URL.createObjectURL(blob);
        tracked.set(row.id, objectUrl);
        setTiles(prev => ({ ...prev, [row.id]: { url: objectUrl } }));
      } catch {
        if (alive) setTiles(prev => ({ ...prev, [row.id]: { failed: true } }));
      }
    });
    return () => { alive = false; };
    // tiles intentionally NOT in deps — we only want to resolve
    // newly-seen rows, not retry-loop on every state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, noteCrypto]);

  // Final cleanup on unmount — sweep anything still in the map.
  useEffect(() => () => {
    objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();
  }, []);

  // Retry a previously-failed tile (network blip, transient decrypt
  // failure). Clearing the tile entry causes the resolver effect to
  // pick the row up again on the next run.
  const retryTile = useCallback((id) => {
    setTiles(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const handleDelete = useCallback(async (id) => {
    haptic.warn();
    const ok = await deleteNoteAttachment(id);
    if (!ok) showToast?.(t("notes.attachments.deleteFailed"), "error");
  }, [deleteNoteAttachment, showToast, t]);

  // Lightbox a11y: hide the FAB so it doesn't float over the
  // image, wire Escape, and trap focus so keyboard users can
  // dismiss without tab-escaping to the editor underneath.
  const closeLightbox = useCallback(() => setLightboxId(null), []);
  useEscape(lightboxId ? closeLightbox : null);
  const lightboxRef = useFocusTrap(!!lightboxId);
  useEffect(() => {
    if (!lightboxId) return;
    setHideFab?.(true);
    return () => setHideFab?.(false);
  }, [lightboxId, setHideFab]);

  if (rows.length === 0) return null;

  return (
    <>
      <div className="mde-attach-strip" aria-label={t("notes.attachments.label")}>
        {rows.map(row => {
          const tile = tiles[row.id];
          return (
            <div key={row.id} className="mde-attach-tile">
              {tile?.url ? (
                <button
                  type="button"
                  className="mde-attach-thumb btn-tap"
                  onClick={() => setLightboxId(row.id)}
                  aria-label={t("notes.attachments.preview")}
                >
                  <img src={tile.url} alt="" />
                </button>
              ) : tile?.failed ? (
                <button
                  type="button"
                  className="mde-attach-thumb mde-attach-failed btn-tap"
                  onClick={() => retryTile(row.id)}
                  aria-label={t("notes.attachments.retry")}
                  title={t("notes.attachments.retry")}
                >
                  <span aria-hidden="true">↻</span>
                </button>
              ) : (
                <div className="mde-attach-thumb mde-attach-loading" aria-hidden="true" />
              )}
              <button
                type="button"
                className="mde-attach-delete btn-tap"
                onClick={() => handleDelete(row.id)}
                aria-label={t("delete")}
              >
                <IconTrash size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {lightboxId && (() => {
        const tile = tiles[lightboxId];
        if (!tile?.url) return null;
        return (
          <div
            ref={lightboxRef}
            className="mde-attach-lightbox"
            onClick={closeLightbox}
            role="dialog"
            aria-modal="true"
            aria-label={t("notes.attachments.preview")}
          >
            <button
              type="button"
              className="mde-attach-lightbox-close"
              onClick={(e) => { e.stopPropagation(); closeLightbox(); }}
              aria-label={t("close")}
              autoFocus
            >
              <IconX size={18} />
            </button>
            <img src={tile.url} alt="" onClick={(e) => e.stopPropagation()} />
          </div>
        );
      })()}
    </>
  );
}
