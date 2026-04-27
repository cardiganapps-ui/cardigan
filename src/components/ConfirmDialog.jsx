import { useEffect, useState } from "react";
import { haptic } from "../utils/haptics";
import { useEscape } from "../hooks/useEscape";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useT } from "../i18n/index";
import { IconTrash } from "./Icons";

/* ── ConfirmDialog ────────────────────────────────────────────────
   A polished, centered confirmation modal that replaces the
   inline-styled "are you sure?" boxes that drifted across the app
   (Drawer sign-out, DocumentList delete, etc.).

   Design contract:
   - Centered card, scale-in 0.92 → 1 over 0.3s on the canonical curve.
   - Backdrop scrim with the unified `--scrim-bg` token + per-layer blur.
   - haptic.warn() fires once on mount when destructive=true (and only
     once per open — re-renders during the same open don't re-fire).
   - ESC closes; backdrop click closes (configurable via dismissOnOverlay).
   - Focus trapped inside the dialog, restored to the trigger on close.
   - Optional `typeToConfirm` text input — the confirm CTA stays
     disabled until the user types the matching string. Used for
     destructive actions where we want a deliberate gesture
     (e.g. "type your email to delete account").

   Variants:
     destructive=true:  red CTA, IconTrash above the title
     destructive=false: charcoal CTA, no icon

   Composition:
     <ConfirmDialog
       open
       title={t("admin.deleteAccountTitle")}
       body={t("admin.deleteAccountWarning")}
       confirmLabel={t("admin.deleteAccountConfirm")}
       cancelLabel={t("cancel")}
       destructive
       onConfirm={() => doDelete(id)}
       onCancel={() => setOpen(false)}
       typeToConfirm={{ value: account.email, label: t("admin.deleteAccountTypeToConfirm", { email }) }}
     /> */

export function ConfirmDialog({
  open,
  title,
  body,
  bodyExtra,
  confirmLabel,
  cancelLabel,
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
  dismissOnOverlay = true,
  typeToConfirm,
}) {
  const { t } = useT();
  const containerRef = useFocusTrap(open);
  useEscape(open && !busy ? onCancel : null);
  const [typed, setTyped] = useState("");

  // Reset the type-to-confirm input every time the dialog closes so a
  // re-open starts blank rather than carrying over the prior attempt.
  // The intentional setState-in-effect mirrors useUserProfile's pattern
  // — we're synchronising local state with an external lifecycle
  // (the parent's `open` flag).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!open) setTyped("");
  }, [open]);

  // Fire haptic.warn() exactly once per open (destructive only). We
  // gate on `open` flipping to true rather than on render so a
  // re-render during the same open doesn't double-fire.
  useEffect(() => {
    if (open && destructive) haptic.warn();
  }, [open, destructive]);

  if (!open) return null;

  const expectedText = typeToConfirm?.value || "";
  const matchesType = expectedText
    ? typed.trim().toLowerCase() === expectedText.trim().toLowerCase()
    : true;
  const canConfirm = !busy && matchesType;

  const handleOverlayClick = () => {
    if (!dismissOnOverlay || busy) return;
    onCancel?.();
  };

  return (
    <div
      className="confirm-dialog-overlay"
      onClick={handleOverlayClick}
      role="presentation">
      <div
        ref={containerRef}
        className={`confirm-dialog ${destructive ? "confirm-dialog--destructive" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}>
        {destructive && (
          <div className="confirm-dialog-icon" aria-hidden>
            <IconTrash size={22} />
          </div>
        )}
        <div id="confirm-dialog-title" className="confirm-dialog-title">{title}</div>
        {body && <div className="confirm-dialog-body">{body}</div>}
        {bodyExtra && <div className="confirm-dialog-extra">{bodyExtra}</div>}

        {typeToConfirm?.value && (
          <div className="input-group confirm-dialog-type-to-confirm">
            <label className="input-label">{typeToConfirm.label}</label>
            <input
              className="input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={typeToConfirm.placeholder || expectedText}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
        )}

        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="btn btn-secondary confirm-dialog-cancel"
            onClick={onCancel}
            disabled={busy}>
            {cancelLabel || t("cancel")}
          </button>
          <button
            type="button"
            className={`btn ${destructive ? "btn-danger" : "btn-primary"} confirm-dialog-confirm`}
            onClick={onConfirm}
            disabled={!canConfirm}>
            {busy ? (t("admin.processing") || t("saving")) : (confirmLabel || t("ok"))}
          </button>
        </div>
      </div>
    </div>
  );
}
