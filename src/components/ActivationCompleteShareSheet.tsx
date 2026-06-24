import { useEffect } from "react";
import { useT } from "../i18n/index";
import { useCardiganMain } from "../context/CardiganContext";
import { useEscape } from "../hooks/useEscape";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useSheetDrag } from "../hooks/useSheetDrag";
import { useSheetExit } from "../hooks/useSheetExit";
import { ReferralShareBlock } from "./ReferralShareBlock";
import { IconCheck, IconX } from "./Icons";
import { track } from "../lib/analytics";
import { SheetOverlay } from "./SheetOverlay";

/* ── ActivationCompleteShareSheet ──────────────────────────────────────
   Bottom-sheet shown the moment a user crosses all four activation
   steps. Reuses ReferralShareBlock so the share buttons match the
   Settings panel byte-for-byte (same labels, same analytics
   `referral_share` events).

   Triggered from the parent (App.jsx) via `open` prop. The parent
   owns the activation-complete handshake — this component is a
   passive presentation surface so it can re-mount cleanly on
   subsequent sessions if a future feature ever wants to re-prompt.

   Show conditions are enforced by the parent:
     - allDone activation transition just fired
     - !readOnly
     - subscription has a referral code (otherwise we degrade to a
       celebration card without the share buttons). */

export function ActivationCompleteShareSheet({ open, onClose, code }: {
  open?: boolean;
  onClose?: () => void;
  code?: string;
}) {
  const { t } = useT();
  const { setHideFab } = useCardiganMain();

  // Hide the global FAB while open — same pattern other sheets use.
  useEffect(() => {
    if (!open) return;
    setHideFab?.(true);
    return () => setHideFab?.(false);
  }, [open, setHideFab]);

  useEffect(() => {
    if (open) track("activation_share_opened");
  }, [open]);

  const { exiting, animatedClose } = useSheetExit(!!open, onClose);
  useEscape(open ? animatedClose : null);
  const panelRef = useFocusTrap(!!open);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose || (() => {}), { isOpen: !!open });
  const setPanel = (el: HTMLElement | null) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  if (!open) return null;

  return (
    <SheetOverlay exiting={exiting} onClose={animatedClose}>
      <div
        ref={setPanel}
        className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={t("activationShare.title")}
        {...panelHandlers}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("activationShare.title")}</span>
          <button
            type="button"
            className="sheet-close"
            onClick={animatedClose}
            aria-label={t("close")}>
            <IconX size={14} />
          </button>
        </div>
        <div style={{ padding: "0 20px 28px" }}>
          {/* Celebration band — green check, "Tu cuenta está
              completa". Mirrors the activation checklist's idiom
              (green circles for completed steps) so the moment
              reads as continuous with the experience the user
              just finished. */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 16px",
            background: "var(--green-pale, #E5F1E1)",
            border: "1px solid var(--green-mist, #C6E1BE)",
            borderRadius: "var(--radius)",
            marginBottom: 18,
          }}>
            <div style={{
              flexShrink: 0,
              width: 36, height: 36, borderRadius: "50%",
              background: "var(--green)",
              color: "var(--white)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <IconCheck size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: "var(--text-md)", color: "var(--charcoal)" }}>
                {t("activationShare.celebration")}
              </div>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--charcoal-md)", marginTop: 2 }}>
                {t("activationShare.bonus")}
              </div>
            </div>
          </div>

          {/* Body — single sentence, then the share block. No
              multi-paragraph wall of copy; the activation moment
              is high-attention but the user wants to move on. */}
          <div style={{ fontSize: "var(--text-md)", color: "var(--charcoal)", marginBottom: 14, lineHeight: 1.45 }}>
            {t("activationShare.body")}
          </div>

          {code ? (
            <ReferralShareBlock code={code} t={t} />
          ) : (
            <div style={{ fontSize: "var(--text-sm)", color: "var(--charcoal-md)" }}>
              {t("activationShare.codeUnavailable")}
            </div>
          )}

          <button
            type="button"
            onClick={animatedClose}
            style={{
              width: "100%",
              marginTop: 18,
              height: 38, padding: "0 14px",
              fontSize: "var(--text-sm)", fontWeight: 600,
              background: "transparent", border: "none", cursor: "pointer",
              color: "var(--charcoal-md)", fontFamily: "var(--font)",
            }}>
            {t("activationShare.dismiss")}
          </button>
        </div>
      </div>
    </SheetOverlay>
  );
}
