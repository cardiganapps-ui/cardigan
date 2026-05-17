import { useState, useCallback } from "react";
import { useT } from "../../i18n/index.jsx";
import { useCardigan } from "../../context/CardiganContext";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { IconX, IconTrash } from "../Icons";
import { haptic } from "../../utils/haptics";

/* ── AttachmentStrip ──────────────────────────────────────────────
   Phase 5 of the Notes premium roadmap. Horizontal strip of image
   thumbnails sitting below the editor body. Phase D refactor: the
   resolution + cache logic moved to useAttachmentSrc so the inline
   image rendering in MarkdownEditor can share the same blob URLs
   without re-fetching / re-decrypting.

   The hook is owned by the parent (NoteEditor) — it calls
   useAttachmentSrc once and passes the result to BOTH the strip
   and the editor body. Without lifting we'd hit the network +
   decrypt twice per attachment.

   Each tile shows the thumb + a delete chip; tapping the thumb
   opens a fullscreen lightbox for inspection. */

export function AttachmentStrip({ tiles, retryTile, rows }) {
  const { t } = useT();
  const { deleteNoteAttachment, showToast } = useCardigan();

  // The hook owner (NoteEditor) always passes these, but defaulting
  // here keeps the component safe if a future caller forgets — never
  // crash a notes screen because of a missing prop.
  const safeRows = rows || [];
  const safeTiles = tiles || {};

  const [lightboxId, setLightboxId] = useState(null);

  const handleDelete = useCallback(async (id) => {
    haptic.warn();
    const ok = await deleteNoteAttachment(id);
    if (!ok) showToast?.(t("notes.attachments.deleteFailed"), "error");
  }, [deleteNoteAttachment, showToast, t]);

  // Lightbox a11y: wire Escape, trap focus so keyboard users
  // can dismiss without tab-escaping to the editor underneath.
  // The FAB is auto-hidden via a `body:has(.mde-attach-lightbox)`
  // rule in base.css — calling setHideFab(true) here would unmount
  // <QuickActions /> in the FAB-launched NoteEditor flow, which is
  // an ancestor of this strip; the lightbox would kill itself.
  const closeLightbox = useCallback(() => setLightboxId(null), []);
  useEscape(lightboxId ? closeLightbox : null);
  const lightboxRef = useFocusTrap(!!lightboxId);

  // Close the lightbox if the underlying row vanishes (delete from
  // another surface, note swap). Adjust state during render rather
  // than in an effect — matches the pattern used elsewhere for
  // derived-state corrections (see CommandPalette + Notes.jsx).
  if (lightboxId && !safeRows.some(r => r.id === lightboxId)) {
    setLightboxId(null);
  }

  if (safeRows.length === 0) return null;

  return (
    <>
      <div className="mde-attach-strip" aria-label={t("notes.attachments.label")}>
        {safeRows.map(row => {
          const tile = safeTiles[row.id];
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
        const tile = safeTiles[lightboxId];
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
