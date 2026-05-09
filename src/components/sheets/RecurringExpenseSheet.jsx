import { useState } from "react";
import { IconX, IconRepeat, IconTrash, IconEdit } from "../Icons";
import { useCardigan } from "../../context/CardiganContext";
import { useT } from "../../i18n/index";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { formatMXN } from "../../utils/format";
import { haptic } from "../../utils/haptics";
import {
  EXPENSE_CATEGORIES, EXPENSE_PAYMENT_METHODS,
  PAYMENT_METHOD, TAX_TREATMENT, TAX_TREATMENTS,
} from "../../data/constants";
import { MoneyInput } from "../MoneyInput";

/* Manager for recurring expense templates. Listed in this single sheet
   so a therapist juggling 3-4 templates (rent, software, supervisión,
   contador) doesn't have to navigate sheet → row → edit-sheet → back.

   Each row has two modes:
     - display: amount + category + day + status + actions (edit, pause/resume, delete)
     - edit: full form (amount, category, description, day_of_month,
             payment_method, tax_treatment) with Save / Cancel
   Only one row is in edit mode at a time — tapping Edit on a different
   row collapses the previous edit (we don't surface a "discard?" prompt
   because templates aren't destructive and the user can always re-enter).
*/

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

  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);

  // Sort: active first, then paused, then alpha by description.
  const sorted = [...(recurringExpenses || [])].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return (a.description || "").localeCompare(b.description || "");
  });

  const startEdit = (tpl) => {
    setEditingId(tpl.id);
    setDraft({
      amount: String(tpl.amount || ""),
      category: tpl.category,
      description: tpl.description || "",
      dayOfMonth: tpl.day_of_month || 1,
      paymentMethod: tpl.payment_method || PAYMENT_METHOD.TRANSFER,
      taxTreatment: tpl.tax_treatment || TAX_TREATMENT.DEDUCTIBLE,
    });
  };
  const cancelEdit = () => { setEditingId(null); setDraft(null); };

  const saveEdit = async (tpl) => {
    if (!draft) return;
    const amount = Number(draft.amount);
    const dom = Number(draft.dayOfMonth);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (!draft.category) return;
    if (!Number.isFinite(dom) || dom < 1 || dom > 31) return;
    const ok = await updateRecurringTemplate(tpl.id, {
      amount,
      category: draft.category,
      description: draft.description.trim(),
      dayOfMonth: dom,
      paymentMethod: draft.paymentMethod,
      taxTreatment: draft.taxTreatment,
    });
    if (ok) { haptic.success(); cancelEdit(); }
  };

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

          {sorted.map(tpl => {
            const editing = editingId === tpl.id;
            return (
              <div key={tpl.id} style={{
                padding: "14px 16px", marginBottom: 10,
                background: "var(--white)",
                border: `1px solid ${editing ? "var(--teal)" : "var(--border-lt)"}`,
                borderRadius: "var(--radius-lg)",
                boxShadow: "var(--shadow-sm)",
                opacity: tpl.active || editing ? 1 : 0.7,
              }}>
                {!editing ? (
                  <>
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
                        onClick={() => startEdit(tpl)} disabled={mutating}
                        aria-label={t("edit")}
                        style={{ width: 44, padding: 0 }}>
                        <IconEdit size={14} />
                      </button>
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
                  </>
                ) : (
                  <>
                    {/* Edit form — same field set as ExpenseSheet's
                        recurring section but stand-alone. Kept compact:
                        no CFDI / receipt fields (those belong to
                        individual generated expenses, not the template). */}
                    <div className="input-group">
                      <label className="input-label">{t("gastos.amount")}</label>
                      <MoneyInput min="1" step="1" value={draft.amount}
                        onChange={(e) => setDraft(d => ({ ...d, amount: e.target.value }))} />
                    </div>
                    <div className="input-group">
                      <label className="input-label">{t("gastos.category")}</label>
                      <select className="input" value={draft.category}
                        onChange={(e) => setDraft(d => ({ ...d, category: e.target.value }))}>
                        {EXPENSE_CATEGORIES.map(c => (
                          <option key={c} value={c}>{t(`gastos.cat.${c}`)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="input-group">
                      <label className="input-label">{t("gastos.description")}</label>
                      <input className="input" type="text" value={draft.description}
                        onChange={(e) => setDraft(d => ({ ...d, description: e.target.value }))}
                        placeholder={t("gastos.descriptionPlaceholder")} />
                    </div>
                    <div className="input-group">
                      <label className="input-label">{t("gastos.recurringDay")}</label>
                      <input className="input" type="number" min="1" max="31" value={draft.dayOfMonth}
                        onChange={(e) => setDraft(d => ({ ...d, dayOfMonth: Number(e.target.value) || 1 }))} />
                      <span className="input-help" style={{ display: "block", marginTop: 4 }}>
                        {t("gastos.recurringDayHint")}
                      </span>
                    </div>
                    <div className="input-group">
                      <label className="input-label">{t("gastos.method")}</label>
                      <select className="input" value={draft.paymentMethod}
                        onChange={(e) => setDraft(d => ({ ...d, paymentMethod: e.target.value }))}>
                        {EXPENSE_PAYMENT_METHODS.map(m => {
                          const key = (
                            m === PAYMENT_METHOD.TRANSFER ? "finances.transfer" :
                            m === PAYMENT_METHOD.CASH     ? "finances.cash" :
                            m === PAYMENT_METHOD.CARD     ? "finances.card" :
                            "finances.other"
                          );
                          return <option key={m} value={m}>{t(key)}</option>;
                        })}
                      </select>
                    </div>
                    <div className="input-group">
                      <label className="input-label">{t("gastos.treatment")}</label>
                      <div role="radiogroup" aria-label={t("gastos.treatment")}
                        style={{
                          display: "flex", gap: 6, padding: 4,
                          background: "var(--cream)",
                          borderRadius: "var(--radius-pill)", border: "1px solid var(--border-lt)",
                        }}>
                        {TAX_TREATMENTS.map(tt => {
                          const tk = (
                            tt === TAX_TREATMENT.DEDUCTIBLE     ? "gastos.treatmentDeductible" :
                            tt === TAX_TREATMENT.NON_DEDUCTIBLE ? "gastos.treatmentNonDeductible" :
                            "gastos.treatmentPersonal"
                          );
                          const active = draft.taxTreatment === tt;
                          return (
                            <button key={tt} type="button" role="radio" aria-checked={active}
                              className="btn-tap"
                              onClick={() => setDraft(d => ({ ...d, taxTreatment: tt }))}
                              style={{
                                flex: 1, height: 32,
                                background: active ? "var(--white)" : "transparent",
                                border: "none",
                                borderRadius: "var(--radius-pill)",
                                boxShadow: active ? "0 1px 2px rgba(46,46,46,0.08)" : "none",
                                color: active ? "var(--charcoal)" : "var(--charcoal-md)",
                                fontFamily: "inherit", fontSize: 12, fontWeight: 700,
                                cursor: "pointer",
                              }}>
                              {t(tk)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <button type="button" className="btn btn-ghost btn-tap"
                        onClick={cancelEdit} disabled={mutating}
                        style={{ flex: 1, height: 38 }}>
                        {t("cancel")}
                      </button>
                      <button type="button" className="btn btn-primary-teal btn-tap"
                        onClick={() => saveEdit(tpl)} disabled={mutating}
                        style={{ flex: 1, height: 38 }}>
                        {mutating ? t("saving") : t("gastos.update")}
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
