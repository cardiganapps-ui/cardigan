import { IconX, IconRepeat, IconTrash } from "../Icons";
import { useCardigan } from "../../context/CardiganContext";
import { useT } from "../../i18n/index";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { formatMXN } from "../../utils/format";
import { haptic } from "../../utils/haptics";

/* Manager for recurring expense templates. Listed newest-first inside
   the sheet; each row is a card showing amount + category + day-of-
   month, with a Pausar/Reactivar toggle and a destructive delete.
   Editing fields lives inside the row when expanded — keeping all
   recurring CRUD on one surface so a therapist who's juggling 3-4
   templates (rent, software, supervisión, contador) doesn't have to
   navigate sheet → row → edit-sheet → back. */

export function RecurringExpenseSheet({ onClose }) {
  const {
    recurringExpenses, updateRecurringTemplate, deleteRecurringTemplate,
    mutating,
  } = useCardigan();
  const { t } = useT();

  const safeClose = mutating ? null : onClose;
  useEscape(safeClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(safeClose, { isOpen: true });
  const setPanel = (el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  // Sort: active first, then paused, then alpha by description.
  const sorted = [...(recurringExpenses || [])].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return (a.description || "").localeCompare(b.description || "");
  });

  const handleToggle = async (tpl) => {
    haptic.tap();
    await updateRecurringTemplate(tpl.id, { active: !tpl.active });
  };

  const handleDelete = async (tpl) => {
    if (!window.confirm(t("gastos.recurringDelete") + "\n\n" + t("gastos.recurringDeleteWarning"))) return;
    await deleteRecurringTemplate(tpl.id);
  };

  return (
    <div className="sheet-overlay" onClick={safeClose}>
      <div ref={setPanel} className="sheet-panel" role="dialog" aria-modal="true"
        onClick={(e) => e.stopPropagation()} {...panelHandlers}
        style={{ maxHeight: "min(92dvh, calc(100dvh - var(--sat) - 16px))" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("gastos.recurringTitle")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={safeClose}>
            <IconX size={14} />
          </button>
        </div>

        <div style={{ padding: "8px 20px 24px", overflowY: "auto" }}>
          {sorted.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon"><IconRepeat size={20} /></div>
              <div className="empty-state-title">{t("gastos.recurringEmpty")}</div>
              <div className="empty-state-body">{t("gastos.recurringHelp")}</div>
            </div>
          )}

          {sorted.map(tpl => (
            <div key={tpl.id} style={{
              padding: "14px 16px", marginBottom: 10,
              background: "var(--white)",
              border: "1px solid var(--border-lt)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--shadow-sm)",
              opacity: tpl.active ? 1 : 0.7,
            }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 12, marginBottom: 6,
              }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontFamily: "var(--font-d)", fontWeight: 800,
                    fontSize: 15, color: "var(--charcoal)",
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    −{formatMXN(tpl.amount)}
                  </div>
                  <div style={{
                    fontSize: 12, color: "var(--charcoal-md)",
                    marginTop: 2, overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {t(`gastos.cat.${tpl.category}`) || tpl.category}
                    {tpl.description ? ` · ${tpl.description}` : ""}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--charcoal-xl)", marginTop: 2 }}>
                    {t("gastos.recurringDay")} {tpl.day_of_month}
                    {" · "}
                    <span style={{ color: tpl.active ? "var(--teal-dark)" : "var(--amber)" }}>
                      {tpl.active ? t("gastos.recurringActive") : t("gastos.recurringPaused")}
                    </span>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button type="button" className="btn btn-secondary btn-tap"
                  onClick={() => handleToggle(tpl)} disabled={mutating}
                  style={{ flex: 1, height: 36, fontSize: 12 }}>
                  {tpl.active ? t("gastos.recurringPause") : t("gastos.recurringResume")}
                </button>
                <button type="button" className="btn btn-ghost btn-tap"
                  onClick={() => handleDelete(tpl)} disabled={mutating}
                  aria-label={t("gastos.recurringDelete")}
                  style={{ width: 44, padding: 0, color: "var(--red)" }}>
                  <IconTrash size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
