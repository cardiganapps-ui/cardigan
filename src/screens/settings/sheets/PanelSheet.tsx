import type { ReactNode } from "react";
import { useT } from "../../../i18n/index";
import { IconX } from "../../../components/Icons";
import { SheetOverlay } from "../../../components/SheetOverlay";

/* ── PanelSheet ───────────────────────────────────────────────────────
   Generic sheet shell for the Settings sheets that are just a titled
   wrapper around an existing multi-state panel component (Calendario →
   CalendarLinkPanel, Pagos en línea → OnlinePaymentsPanel). Centralizes
   the overlay + handle + header + close-button boilerplate so those
   wrappers stop copy-pasting it. Shared focus-trap + drag wiring threads
   through setSheetPanel / sheetPanelHandlers.

   When closed it returns null, so the wrapped panel never mounts (and
   never fetches) until the sheet is opened. */

export interface PanelSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  setSheetPanel: (el: HTMLDivElement | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheetPanelHandlers: Record<string, any>;
  children: ReactNode;
}

export function PanelSheet({ open, title, onClose, setSheetPanel, sheetPanelHandlers, children }: PanelSheetProps) {
  const { t } = useT();
  if (!open) return null;
  return (
        <SheetOverlay onClose={onClose}>
          <div ref={setSheetPanel} className="sheet-panel" role="dialog" aria-modal="true" {...sheetPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{title}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={onClose}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              {children}
            </div>
          </div>
        </SheetOverlay>
  );
}
