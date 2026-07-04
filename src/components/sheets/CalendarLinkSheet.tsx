import { IconX } from "../Icons";
import { useT } from "../../i18n/index";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useSheetExit } from "../../hooks/useSheetExit";
import { CalendarLinkPanel } from "../CalendarLinkPanel";
import { SheetOverlay } from "../SheetOverlay";

export function CalendarLinkSheet({ onClose, readOnly = false }: { onClose: () => void; readOnly?: boolean }) {
  const { t } = useT();
  const { exiting, animatedClose } = useSheetExit(true, onClose);
  useEscape(animatedClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose);
  const setPanel = (el: HTMLElement | null) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  return (
    <SheetOverlay exiting={exiting} onClose={animatedClose}>
      {/* No inline maxHeight — defer to .sheet-panel's `max-height: 85svh`
          in screens.css. On Capacitor iOS the `html.cap-ios { zoom: 0.80 }`
          rule interacts strangely with viewport-relative units inside
          position:fixed overlays, occasionally clipping the panel below
          the Activar button. Letting the base svh-based rule own the
          ceiling matches what every other sheet uses by default — and
          it Just Works on native because svh is the most conservative
          (smallest) value, which compensates for the zoom rounding.
          Display flex/column + content min-height ensures the button
          is part of the layout regardless of any rounding edge cases. */}
      <div
        ref={setPanel}
        className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.calendarTitle")}
        {...panelHandlers}
        style={{ display: "flex", flexDirection: "column" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("settings.calendarTitle")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={animatedClose}><IconX size={14} /></button>
        </div>
        <div style={{ padding: "4px 20px 24px", flex: "1 0 auto", minHeight: 180 }}>
          <CalendarLinkPanel readOnly={readOnly} />
        </div>
      </div>
    </SheetOverlay>
  );
}
