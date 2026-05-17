import { useState, useCallback } from "react";
import { useT } from "../../i18n/index.jsx";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { IconX, IconCheck } from "../Icons";
import { haptic } from "../../utils/haptics";

/* ── CoverPickerSheet ─────────────────────────────────────────────
   Phase E.2 of the Notes premium polish roadmap. Lets the user
   pick one of a note's attachments as its cover image (rendered
   as a hero in the editor body, as a thumb on the list row).

   Receives the resolved tiles map from useAttachmentSrc upstream
   — no fetch / decrypt of its own. That keeps the picker fast to
   open and avoids duplicate network work.

   Bottom-sheet pattern same as the rest of the app: focus trap,
   escape, swipe-to-close. Tapping a thumb is the implicit confirm;
   no separate "Save" button. */

export function CoverPickerSheet({ open, onClose, attachmentRows, tiles, currentCoverId, onPick, onClear }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);

  const safeClose = busy ? null : onClose;
  useEscape(open ? safeClose : null);
  const panelRef = useFocusTrap(!!open);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(safeClose, { isOpen: open });
  const setPanel = useCallback((el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  }, [panelRef, scrollRef, setPanelEl]);

  const pick = useCallback(async (attachmentId) => {
    if (busy) return;
    setBusy(true);
    try {
      await onPick?.(attachmentId);
      haptic.success();
      onClose?.();
    } finally {
      setBusy(false);
    }
  }, [busy, onPick, onClose]);

  const clear = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onClear?.();
      haptic.tap();
      onClose?.();
    } finally {
      setBusy(false);
    }
  }, [busy, onClear, onClose]);

  if (!open) return null;

  const hasCover = !!currentCoverId;
  const hasAnyAttachments = (attachmentRows || []).length > 0;

  return (
    <div className="sheet-overlay" onClick={safeClose || undefined}>
      <div
        ref={setPanel}
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("notes.cover.title")}
        onClick={(e) => e.stopPropagation()}
        {...panelHandlers}
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("notes.cover.title")}</span>
          <button
            type="button"
            className="sheet-close"
            onClick={() => safeClose?.()}
            disabled={busy}
            aria-label={t("close")}
          >
            <IconX size={14} />
          </button>
        </div>
        <div style={{ padding: "0 20px 22px" }}>
          {!hasAnyAttachments ? (
            <div style={{
              padding: "18px 0",
              fontSize: "var(--text-sm)",
              color: "var(--charcoal-md)",
              textAlign: "center",
              lineHeight: 1.5,
            }}>
              {t("notes.cover.noAttachments")}
            </div>
          ) : (
            <>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
                gap: 10,
                marginBottom: 14,
              }}>
                {attachmentRows.map(row => {
                  const tile = tiles?.[row.id];
                  const isCurrent = row.id === currentCoverId;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      className="btn-tap"
                      onClick={() => pick(row.id)}
                      disabled={busy || !tile?.url}
                      aria-pressed={isCurrent}
                      aria-label={t(isCurrent ? "notes.cover.current" : "notes.cover.usePill")}
                      style={{
                        position: "relative",
                        aspectRatio: "1 / 1",
                        width: "100%",
                        padding: 0,
                        background: "var(--cream)",
                        border: isCurrent ? "2px solid var(--teal)" : "1px solid var(--border-lt)",
                        borderRadius: "var(--radius)",
                        overflow: "hidden",
                        cursor: tile?.url ? "pointer" : "default",
                        opacity: tile?.url ? 1 : 0.6,
                      }}>
                      {tile?.url && (
                        <img
                          src={tile.url}
                          alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        />
                      )}
                      {isCurrent && (
                        <span style={{
                          position: "absolute",
                          top: 4, right: 4,
                          width: 22, height: 22,
                          borderRadius: "50%",
                          background: "var(--teal)",
                          color: "var(--white)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          boxShadow: "var(--shadow-sm)",
                        }}>
                          <IconCheck size={12} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {hasCover && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={clear}
                  disabled={busy}
                  style={{ width: "100%", minHeight: 44 }}
                >
                  {t("notes.cover.remove")}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
