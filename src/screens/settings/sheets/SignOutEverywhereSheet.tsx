import { useT } from "../../../i18n/index";
import { IconX } from "../../../components/Icons";
import { SheetOverlay } from "../../../components/SheetOverlay";

/* ── Sign-out-everywhere sheet ────────────────────────────────────────
   Extracted from Settings.tsx. Calls signOut("global"), which revokes
   every refresh token tied to the user (kicks them out of every device)
   — the lost-phone recovery action. Stateless; the shared focus-trap +
   drag wiring threads through setSheetPanel / sheetPanelHandlers. */

export interface SignOutEverywhereSheetProps {
  open: boolean;
  onClose: () => void;
  signOut: (scope?: string) => void | Promise<void>;
  setSheetPanel: (el: HTMLDivElement | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheetPanelHandlers: Record<string, any>;
}

export function SignOutEverywhereSheet({ open, onClose, signOut, setSheetPanel, sheetPanelHandlers }: SignOutEverywhereSheetProps) {
  const { t } = useT();
  if (!open) return null;
  return (
    <SheetOverlay onClose={() => onClose()}>
      <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" {...sheetPanelHandlers}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("settings.signOutEverywhere")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={() => onClose()}><IconX size={14} /></button>
        </div>
        <div style={{ padding:"0 20px 22px" }}>
          <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.55, marginBottom: 16 }}>
            {t("settings.signOutEverywhereExplain")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ background:"var(--red)", color:"var(--white)" }}
              onClick={async () => { await signOut("global"); }}
            >
              {t("settings.signOutEverywhereCta")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => onClose()}>
              {t("cancel")}
            </button>
          </div>
        </div>
      </div>
    </SheetOverlay>
  );
}
