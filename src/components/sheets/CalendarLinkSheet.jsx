import { IconX } from "../Icons";
import { useT } from "../../i18n/index";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { CalendarLinkPanel } from "../CalendarLinkPanel";

export function CalendarLinkSheet({ onClose, readOnly = false }) {
  const { t } = useT();
  useEscape(onClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose);
  const setPanel = (el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div ref={setPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...panelHandlers} style={{ maxHeight:"92vh", overflowY:"auto" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("settings.calendarTitle")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={onClose}><IconX size={14} /></button>
        </div>
        <div style={{ padding:"4px 20px 24px" }}>
          <CalendarLinkPanel readOnly={readOnly} />
        </div>
      </div>
    </div>
  );
}
