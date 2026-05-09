import { useEffect, useRef, useState } from "react";
import { todayISO, isoToShortDate, shortDateToISO } from "../../utils/dates";
import {
  EXPENSE_CATEGORIES, EXPENSE_PAYMENT_METHODS,
  PAYMENT_METHOD, TAX_TREATMENT, TAX_TREATMENTS,
} from "../../data/constants";
import { IconX, IconPaperclip, IconCheck, IconTrash, IconRepeat } from "../Icons";
import { MoneyInput } from "../MoneyInput";
import { useCardigan } from "../../context/CardiganContext";
import { useT } from "../../i18n/index";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { haptic } from "../../utils/haptics";
import { formatMXN } from "../../utils/format";

const LAST_CATEGORY_KEY = "cardigan.lastExpenseCategory";

/* Sheet for recording or editing a single expense. Mirrors the
   PaymentModal pattern (sheet-overlay + sheet-panel + sheet-header +
   sticky footer) so the muscle memory is identical. The form
   intentionally keeps the simple-case path short: amount + category +
   date are the only required fields. CFDI fields collapse into an
   accordion so they don't clutter the simple "I just paid for office
   supplies" entry — only deductible expenses with an invoice need
   them. Recurring toggle expands a day-of-month picker that, on save,
   ALSO creates a recurring_expenses template the auto-generator will
   honor on subsequent app loads. */

export function ExpenseSheet({ editingExpense, onClose }) {
  const {
    createExpense, updateExpense, deleteExpense,
    createRecurringTemplate, mutating, mutationError,
    uploadDocument, deleteDocument,
  } = useCardigan();
  const { t } = useT();
  const isEditing = !!editingExpense;

  const safeClose = mutating ? null : onClose;
  useEscape(safeClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(safeClose, { isOpen: true });
  const setPanel = (el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  const lastCategory = (typeof window !== "undefined" && localStorage.getItem(LAST_CATEGORY_KEY)) || EXPENSE_CATEGORIES[0];

  const [amount, setAmount] = useState(editingExpense ? String(editingExpense.amount || "") : "");
  const [category, setCategory] = useState(editingExpense?.category || lastCategory);
  const [description, setDescription] = useState(editingExpense?.description || "");
  const [date, setDate] = useState(editingExpense?.date ? shortDateToISO(editingExpense.date) : todayISO());
  const [paymentMethod, setPaymentMethod] = useState(editingExpense?.payment_method || PAYMENT_METHOD.TRANSFER);
  const [taxTreatment, setTaxTreatment] = useState(editingExpense?.tax_treatment || TAX_TREATMENT.DEDUCTIBLE);
  const [cfdiUuid, setCfdiUuid] = useState(editingExpense?.cfdi_uuid || "");
  const [cfdiUrl, setCfdiUrl] = useState(editingExpense?.cfdi_url || "");
  const [showCfdi, setShowCfdi] = useState(!!editingExpense?.cfdi_uuid);
  const [note, setNote] = useState(editingExpense?.note || "");
  const [receiptDocId, setReceiptDocId] = useState(editingExpense?.receipt_document_id || null);
  const [receiptName, setReceiptName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [dayOfMonth, setDayOfMonth] = useState(() => {
    const d = editingExpense?.date ? new Date(shortDateToISO(editingExpense.date)) : new Date();
    return Number.isFinite(d.getDate()) ? d.getDate() : 1;
  });
  const [formError, setFormError] = useState("");
  const fileInputRef = useRef(null);

  // Display name for an existing receipt (best-effort — we don't refetch
  // the document name, just show "Recibo adjunto" in the editing case).
  useEffect(() => {
    if (editingExpense?.receipt_document_id) setReceiptName(t("gastos.receiptAttached"));
  }, [editingExpense?.receipt_document_id, t]);

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    setFormError("");
    try {
      const doc = await uploadDocument({ file, kind: "receipt" });
      if (doc?.id) {
        setReceiptDocId(doc.id);
        setReceiptName(doc.name || file.name);
      } else {
        setFormError(t("docs.uploadFailed") || "Error al subir el recibo");
      }
    } catch (e) {
      setFormError(e?.message || "Error al subir el recibo");
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveReceipt = async () => {
    if (!receiptDocId) return;
    try { await deleteDocument(receiptDocId); } catch { /* swallow */ }
    setReceiptDocId(null);
    setReceiptName("");
  };

  const handleViewReceipt = async () => {
    if (!receiptDocId) return;
    // Find the document via the documents collection isn't available
    // here; getDocumentUrl needs the file path. We re-resolve via
    // the document id by fetching from supabase indirectly: look it
    // up through getDocumentUrl-by-id pattern. The PatientExpediente
    // viewer pattern wants a path, so we keep this simple — surface
    // the receipt only after the row has been saved (then the user
    // can tap it from the GastosTab list which has the path).
    setFormError(t("gastos.receiptAttached"));
  };

  const submit = async (e) => {
    e.preventDefault();
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError(t("gastos.enterAmount"));
      return;
    }
    if (!category) {
      setFormError(t("gastos.selectCategory"));
      return;
    }
    setFormError("");
    if (typeof window !== "undefined") localStorage.setItem(LAST_CATEGORY_KEY, category);

    const shortDate = isoToShortDate(date);
    const payload = {
      amount: parsedAmount,
      category,
      description: description.trim(),
      date: shortDate,
      paymentMethod,
      taxTreatment,
      cfdiUuid: showCfdi ? cfdiUuid.trim() : "",
      cfdiUrl: showCfdi ? cfdiUrl.trim() : "",
      receiptDocumentId: receiptDocId,
      note: note.trim(),
    };
    try {
      if (isEditing) {
        const ok = await updateExpense(editingExpense.id, payload);
        if (ok) { haptic.success(); onClose(`${t("gastos.updated")}: −${formatMXN(parsedAmount)}`); }
      } else {
        const ok = await createExpense(payload);
        if (!ok) {
          setFormError(mutationError || "Error al guardar");
          return;
        }
        // Recurring template — fire and forget so the toast lands
        // immediately. The DB unique index protects against the race.
        if (makeRecurring) {
          createRecurringTemplate({
            amount: parsedAmount,
            category,
            description: description.trim(),
            dayOfMonth,
            paymentMethod,
            taxTreatment,
          }).catch(() => {});
        }
        haptic.success();
        onClose(`${t("gastos.saved")}: −${formatMXN(parsedAmount)}`);
      }
    } catch (ex) {
      setFormError(ex?.message || "Error al guardar");
    }
  };

  const handleDelete = async () => {
    if (!isEditing) return;
    if (!window.confirm(t("gastos.deleteConfirm") + "\n\n" + t("gastos.deleteWarning"))) return;
    const ok = await deleteExpense(editingExpense.id);
    if (ok) { haptic.success(); onClose(t("gastos.deleted")); }
  };

  return (
    <div className="sheet-overlay" onClick={safeClose}>
      <div ref={setPanel} className="sheet-panel" role="dialog" aria-modal="true"
        onClick={(e) => e.stopPropagation()} {...panelHandlers}
        style={{ maxHeight: "min(92dvh, calc(100dvh - var(--sat) - 16px))" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{isEditing ? t("gastos.edit") : t("gastos.record")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={safeClose}>
            <IconX size={14} />
          </button>
        </div>
        <form onSubmit={submit} style={{ padding: "0 20px 0" }}>
          <div>
            {/* Amount — autofocused so the keyboard pops on open and the
                3-tap quick-capture path works without an extra tap. */}
            <div className="input-group">
              <label className="input-label">
                {t("gastos.amount")}
                <span style={{ color: "var(--red)", marginLeft: 4 }} aria-hidden>*</span>
              </label>
              <MoneyInput min="1" step="1" required autoFocus value={amount}
                onChange={(e) => setAmount(e.target.value)} />
            </div>

            {/* Category */}
            <div className="input-group">
              <label className="input-label">
                {t("gastos.category")}
                <span style={{ color: "var(--red)", marginLeft: 4 }} aria-hidden>*</span>
              </label>
              <select className="input" required value={category}
                onChange={(e) => setCategory(e.target.value)}>
                {EXPENSE_CATEGORIES.map(k => (
                  <option key={k} value={k}>{t(`gastos.cat.${k}`)}</option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div className="input-group">
              <label className="input-label">{t("gastos.description")}</label>
              <input className="input" type="text" value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("gastos.descriptionPlaceholder")} />
            </div>

            {/* Date */}
            <div className="input-group">
              <label className="input-label">{t("gastos.date")}</label>
              <input className="input" type="date" value={date}
                onChange={(e) => setDate(e.target.value)} max={todayISO()} />
            </div>

            {/* Payment method */}
            <div className="input-group">
              <label className="input-label">{t("gastos.method")}</label>
              <select className="input" value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}>
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

            {/* Tax treatment — segmented (3 options). Tight, scannable. */}
            <div className="input-group">
              <label className="input-label">{t("gastos.treatment")}</label>
              <div role="radiogroup" aria-label={t("gastos.treatment")}
                style={{ display: "flex", gap: 6, padding: 4, background: "var(--cream)",
                  borderRadius: "var(--radius-pill)", border: "1px solid var(--border-lt)" }}>
                {TAX_TREATMENTS.map(tt => {
                  const tk = (
                    tt === TAX_TREATMENT.DEDUCTIBLE     ? "gastos.treatmentDeductible" :
                    tt === TAX_TREATMENT.NON_DEDUCTIBLE ? "gastos.treatmentNonDeductible" :
                    "gastos.treatmentPersonal"
                  );
                  const active = taxTreatment === tt;
                  return (
                    <button key={tt} type="button" role="radio" aria-checked={active}
                      className="btn-tap"
                      onClick={() => setTaxTreatment(tt)}
                      style={{
                        flex: 1, height: 34,
                        background: active ? "var(--white)" : "transparent",
                        border: "none",
                        borderRadius: "var(--radius-pill)",
                        boxShadow: active ? "0 1px 2px rgba(46,46,46,0.08)" : "none",
                        color: active ? "var(--charcoal)" : "var(--charcoal-md)",
                        fontFamily: "inherit", fontSize: 12, fontWeight: 700,
                        cursor: "pointer", transition: "background-color var(--dur-fast) ease",
                      }}>
                      {t(tk)}
                    </button>
                  );
                })}
              </div>
              <span className="input-help" style={{ display: "block", marginTop: 4 }}>
                {t("gastos.treatmentHelp")}
              </span>
            </div>

            {/* CFDI accordion — only relevant for deductible */}
            {taxTreatment === TAX_TREATMENT.DEDUCTIBLE && (
              <div className="input-group" style={{ marginBottom: 14 }}>
                <button type="button" onClick={() => setShowCfdi(s => !s)}
                  className="btn-tap"
                  style={{
                    border: "none", background: "none", padding: "4px 0",
                    color: "var(--teal-dark)", fontFamily: "inherit",
                    fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}>
                  {showCfdi ? "▾" : "▸"} {t("gastos.cfdiUuid")}
                </button>
                {showCfdi && (
                  <div style={{ marginTop: 8 }}>
                    <input className="input" type="text" value={cfdiUuid}
                      onChange={(e) => setCfdiUuid(e.target.value)}
                      placeholder={t("gastos.cfdiUuidPlaceholder")} />
                    <input className="input" type="url" value={cfdiUrl}
                      onChange={(e) => setCfdiUrl(e.target.value)}
                      placeholder={t("gastos.cfdiUrl")}
                      style={{ marginTop: 8 }} />
                    <span className="input-help" style={{ display: "block", marginTop: 4 }}>
                      {t("gastos.cfdiHelp")}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Receipt upload */}
            <div className="input-group">
              <label className="input-label">{t("gastos.receipt")}</label>
              <input ref={fileInputRef} type="file"
                accept="image/*,application/pdf"
                capture="environment"
                style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
              {!receiptDocId && (
                <button type="button" className="btn btn-secondary btn-tap"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  style={{ width: "100%", height: 44, gap: 8 }}>
                  <IconPaperclip size={16} />
                  <span>{uploading ? t("gastos.receiptUploading") : t("gastos.receiptUpload")}</span>
                </button>
              )}
              {receiptDocId && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "10px 12px", background: "var(--green-bg)",
                  border: "1px solid var(--border-lt)",
                  borderRadius: "var(--radius)",
                }}>
                  <IconCheck size={14} style={{ color: "var(--green)" }} />
                  <span style={{ flex: 1, fontSize: 13, color: "var(--charcoal)" }}
                    onClick={handleViewReceipt}>
                    {receiptName || t("gastos.receiptAttached")}
                  </span>
                  <button type="button"
                    onClick={handleRemoveReceipt}
                    aria-label={t("gastos.receiptRemove")}
                    className="btn-tap"
                    style={{
                      border: "none", background: "none", color: "var(--charcoal-md)",
                      cursor: "pointer", padding: 4,
                    }}>
                    <IconX size={14} />
                  </button>
                </div>
              )}
              <span className="input-help" style={{ display: "block", marginTop: 4 }}>
                {t("gastos.receiptHint")}
              </span>
            </div>

            {/* Note */}
            <div className="input-group">
              <label className="input-label">{t("gastos.note")}</label>
              <input className="input" type="text" value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("gastos.notePlaceholder")} />
            </div>

            {/* Recurring toggle — last so the simple-case path stays
                visually clean. Hidden when editing an existing expense
                (recurring template management lives in its own sheet). */}
            {!isEditing && (
              <div className="input-group" style={{
                background: "var(--cream)", padding: "12px 14px",
                borderRadius: "var(--radius)", border: "1px solid var(--border-lt)",
              }}>
                <label style={{
                  display: "flex", alignItems: "center", gap: 10,
                  cursor: "pointer", color: "var(--charcoal)",
                  fontSize: 13, fontWeight: 600,
                }}>
                  <input type="checkbox" checked={makeRecurring}
                    onChange={(e) => setMakeRecurring(e.target.checked)} />
                  <IconRepeat size={14} style={{ color: "var(--teal-dark)" }} />
                  <span>{t("gastos.recurring")}</span>
                </label>
                {makeRecurring && (
                  <div style={{ marginTop: 10 }}>
                    <label className="input-label">{t("gastos.recurringDay")}</label>
                    <input className="input" type="number" min="1" max="31"
                      value={dayOfMonth}
                      onChange={(e) => setDayOfMonth(Number(e.target.value) || 1)} />
                    <span className="input-help" style={{ display: "block", marginTop: 4 }}>
                      {t("gastos.recurringDayHint")}
                    </span>
                  </div>
                )}
                {!makeRecurring && (
                  <span className="input-help" style={{ display: "block", marginTop: 6 }}>
                    {t("gastos.recurringHelp")}
                  </span>
                )}
              </div>
            )}

            {formError && (
              <div className="form-error" style={{ marginTop: 8 }}>{formError}</div>
            )}
          </div>

          {/* Sticky footer with submit + (when editing) destructive delete */}
          <div style={{
            position: "sticky", bottom: 0, background: "var(--white)",
            padding: "12px 0 22px", borderTop: "1px solid var(--border-lt)",
            marginTop: 8, display: "flex", gap: 8,
          }}>
            {isEditing && (
              <button type="button" className="btn btn-ghost btn-tap"
                onClick={handleDelete} disabled={mutating}
                style={{ width: 44, padding: 0, color: "var(--red)" }}
                aria-label={t("delete")}>
                <IconTrash size={16} />
              </button>
            )}
            <button className="btn btn-primary-teal" type="submit"
              disabled={mutating || uploading}
              style={{ flex: 1 }}>
              {mutating ? t("saving") :
                isEditing ? t("gastos.update") : t("gastos.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
