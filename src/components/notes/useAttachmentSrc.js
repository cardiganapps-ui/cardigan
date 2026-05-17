import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../supabaseClient";
import { useCardigan } from "../../context/CardiganContext";

/* ── useAttachmentSrc(noteId) ───────────────────────────────────────
   Shared resolver for every surface that needs to render a note's
   attachments: the AttachmentStrip thumbnails AND the inline image
   rendering in the body. Both used to keep their own copy of the
   resolution + caching code (presigned URL fetch, decrypt-to-blob
   for encrypted rows, retry plumbing, object-URL revocation on
   unmount). Hoisted to one hook so the cache is shared across
   surfaces: an image that's already rendered in the body doesn't
   re-fetch + re-decrypt to show up in the strip.

   Returned shape:
     • tiles    — { [id]: { url? : string, failed? : true } }
                  url present when the attachment resolved; failed
                  set when fetch / decrypt threw. Both absent while
                  the resolver is in-flight (the caller treats that
                  as "loading").
     • retryTile(id) — clears one tile's entry so the effect
                       re-resolves it on the next render. Used by
                       the strip's failed-thumb retry button.

   Auto-recovery:
     • When the vault unlocks (canEncrypt false→true) every
       previously-failed tile is cleared so the resolver re-fires
       — opening an encrypted note while locked, then unlocking,
       no longer leaves the user manually re-tapping each tile.

   Cleanup:
     • Blob URLs for encrypted attachments are tracked in a Map
       and individually revoked when the originating row goes
       away (delete, note swap) or on hook unmount. Unencrypted
       rows reuse the raw presigned URL (the browser GCs it
       naturally).
*/

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

export function useAttachmentSrc(noteId) {
  const { noteAttachments, noteCrypto } = useCardigan();

  const rows = useMemo(
    () => (noteAttachments || []).filter(a => a.note_id === noteId),
    [noteAttachments, noteId]
  );

  const [tiles, setTiles] = useState({});
  const objectUrlsRef = useRef(new Map());

  useEffect(() => {
    let alive = true;
    const tracked = objectUrlsRef.current;

    // Prune state + revoke blob URLs whose row is gone.
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
        const plain = await noteCrypto.decryptAttachmentBytes(buf, row.iv);
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

  // Auto-clear failed tiles when the vault unlocks. A user who
  // opens an encrypted note while locked sees every tile fail;
  // requiring them to tap "retry" on each one after unlock is
  // friction we can avoid by detecting the canEncrypt→true flip.
  const canDecrypt = !!noteCrypto?.canEncrypt;
  useEffect(() => {
    if (!canDecrypt) return;
    setTiles(prev => {
      let changed = false;
      const next = {};
      for (const k of Object.keys(prev)) {
        if (prev[k]?.failed) { changed = true; continue; }
        next[k] = prev[k];
      }
      return changed ? next : prev;
    });
  }, [canDecrypt]);

  const retryTile = useCallback((id) => {
    setTiles(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  return { tiles, retryTile, rows };
}
