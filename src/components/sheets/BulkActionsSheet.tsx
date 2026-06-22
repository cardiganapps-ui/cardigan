import { IconX, IconCheck, IconDollar, IconTrash } from "../Icons";
import { useT } from "../../i18n/index";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useSheetExit } from "../../hooks/useSheetExit";
import { useLayer } from "../../hooks/useLayer";

/* Bulk actions for a selection of sessions. Canonical Cardigan sheet — a
   spacious action list (icon-in-tinted-circle + label) instead of a cramped
   bottom slab, so it scales and reads on-brand. Each row applies the action
   to the whole selection and closes. */
export function BulkActionsSheet({ count, busy, onClose, onComplete, onCancelNoCharge, onCancelCharge, onDelete }: {
  count?: number;
  busy?: boolean;
  onClose: () => void;
  onComplete?: () => void | Promise<unknown>;
  onCancelNoCharge?: () => void | Promise<unknown>;
  onCancelCharge?: () => void | Promise<unknown>;
  onDelete?: () => void | Promise<unknown>;
}) {
  const { t } = useT();
  const { exiting, animatedClose } = useSheetExit(true, onClose);
  useEscape(busy ? () => {} : animatedClose);
  useLayer("bulk-actions", animatedClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(busy ? () => {} : onClose);
  const setPanel = (el: HTMLElement | null) => { panelRef.current = el; scrollRef.current = el; setPanelEl(el); };

  const run = (fn?: () => void | Promise<unknown>) => async () => { await fn?.(); animatedClose(); };

  const actions = [
    { key: "complete", label: t("agenda.bulkComplete"),       Icon: IconCheck,  tint: "var(--green-bg)", color: "var(--green)",       onClick: run(onComplete) },
    { key: "cancel",   label: t("agenda.bulkCancelNoCharge"), Icon: IconX,      tint: "var(--cream-dark)", color: "var(--charcoal-md)", onClick: run(onCancelNoCharge) },
    { key: "charge",   label: t("agenda.bulkCancelCharge"),   Icon: IconDollar, tint: "var(--amber-bg)", color: "var(--amber)",       onClick: run(onCancelCharge) },
    { key: "delete",   label: t("agenda.bulkDelete"),         Icon: IconTrash,  tint: "var(--red-bg)",   color: "var(--red)",         onClick: run(onDelete), destructive: true },
  ];

  return (
    <div className={`sheet-overlay ${exiting ? "sheet-overlay--exit" : ""}`} onClick={busy ? undefined : animatedClose}>
      <div ref={setPanel} className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`} role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...panelHandlers}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("agenda.bulkActionsTitle", { n: count })}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={animatedClose}><IconX size={14} /></button>
        </div>
        <div style={{ padding: "4px 12px 24px", display: "flex", flexDirection: "column" }}>
          {actions.map((a, i) => (
            <button key={a.key} type="button" className="btn-tap" disabled={busy} onClick={a.onClick}
              style={{
                display: "flex", alignItems: "center", gap: 14, width: "100%",
                padding: "13px 12px", background: "transparent", border: "none",
                borderTop: i === 0 ? "none" : "1px solid var(--border-lt)",
                cursor: busy ? "default" : "pointer", textAlign: "left", opacity: busy ? 0.6 : 1,
              }}>
              <span aria-hidden style={{
                width: 38, height: 38, borderRadius: "var(--radius-pill)", flexShrink: 0,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                background: a.tint, color: a.color,
              }}>
                <a.Icon size={18} />
              </span>
              <span style={{
                fontFamily: "var(--font-d)", fontWeight: 700, fontSize: "var(--text-md)",
                color: a.destructive ? "var(--red)" : "var(--charcoal)",
              }}>
                {a.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
