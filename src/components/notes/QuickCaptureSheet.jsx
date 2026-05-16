import { useEffect, useRef, useState, useCallback } from "react";
import { useT } from "../../i18n/index.jsx";
import { useCardigan } from "../../context/CardiganContext";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { IconX } from "../Icons";
import { haptic } from "../../utils/haptics";

/* ── QuickCaptureSheet ────────────────────────────────────────────
   Phase 3 of the Notes premium roadmap. The "jot now, file later"
   path: opens via the FAB's Nota action and lets the user dump a
   thought without the full editor's chrome (templates, link
   selector, format toolbar, find/outline drawers).

   The note is created with patient_id = null + session_id = null +
   no tags — exactly the shape the Inbox filter on the Notes screen
   picks up. The full editor stays one tap away ("Abrir editor
   completo") for users who realise they want markdown or linking
   after they've started typing.

   Mobile-first by design: 16px input font (iOS no-zoom floor),
   44×44 hit targets, sheet pattern with focus trap + escape +
   swipe-to-close. */

export function QuickCaptureSheet({ open, onClose, onSaved }) {
  const { t } = useT();
  const { createNote, setHideFab, showToast } = useCardigan();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef(null);

  // The component unmounts on close (see `if (!open) return null` below),
  // so useState defaults reset the form on every reopen automatically.
  // This effect just focuses the body on mount — autoFocus on the
  // element loses the focus race with the sheet animation on iOS, so
  // we defer one frame.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => textareaRef.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setHideFab?.(true);
    return () => setHideFab?.(false);
  }, [open, setHideFab]);

  const isEmpty = !title.trim() && !content.trim();

  const safeClose = busy ? null : onClose;
  useEscape(open ? safeClose : null);
  const panelRef = useFocusTrap(!!open);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(safeClose, { isOpen: open });
  const setPanel = useCallback((el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  }, [panelRef, scrollRef, setPanelEl]);

  const save = useCallback(async ({ openInEditor } = {}) => {
    if (busy) return;
    if (isEmpty && !openInEditor) {
      // Closing on empty is just a dismiss — no row written.
      onClose?.();
      return;
    }
    setBusy(true);
    try {
      const note = await createNote({
        patientId: null,
        sessionId: null,
        title: title.trim(),
        content,
      });
      if (!note) {
        haptic.warn();
        showToast?.(t("notes.saveFailed"), "error");
        setBusy(false);
        return;
      }
      haptic.success();
      onSaved?.(note, { openInEditor: !!openInEditor });
      onClose?.();
    } catch {
      haptic.warn();
      showToast?.(t("notes.saveFailed"), "error");
      setBusy(false);
    }
  }, [busy, isEmpty, createNote, title, content, onSaved, onClose, showToast, t]);

  // ⌘/Ctrl+Enter saves. Most therapists are typing on phone, but on
  // desktop tablet/laptop they expect this shortcut.
  const handleKeyDown = useCallback((e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      save();
    }
  }, [save]);

  if (!open) return null;

  return (
    <div className="sheet-overlay" onClick={safeClose || undefined}>
      <div
        ref={setPanel}
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("notes.quickCapture.title")}
        onClick={(e) => e.stopPropagation()}
        {...panelHandlers}
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("notes.quickCapture.title")}</span>
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
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("notes.quickCapture.titlePlaceholder")}
            disabled={busy}
            aria-label={t("notes.quickCapture.titlePlaceholder")}
            style={{
              width: "100%", boxSizing: "border-box",
              fontFamily: "var(--font-d)", fontWeight: 700,
              fontSize: 16, color: "var(--charcoal)",
              padding: "10px 0",
              border: "none", outline: "none", background: "transparent",
              borderBottom: "1px solid var(--border-lt)",
              marginBottom: 12,
            }}
          />
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("notes.quickCapture.placeholder")}
            disabled={busy}
            rows={6}
            aria-label={t("notes.quickCapture.placeholder")}
            style={{
              width: "100%", boxSizing: "border-box",
              fontFamily: "var(--font)", fontSize: 16,
              color: "var(--charcoal)", lineHeight: 1.55,
              padding: 12,
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              background: "var(--white)",
              resize: "vertical",
              minHeight: 140,
            }}
          />

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => save()}
              disabled={busy || isEmpty}
              style={{ flex: 1, minHeight: 44 }}
            >
              {busy ? t("loading") : t("notes.quickCapture.save")}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => save({ openInEditor: true })}
              disabled={busy}
              style={{ flex: 1, minHeight: 44 }}
            >
              {t("notes.quickCapture.openEditor")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
