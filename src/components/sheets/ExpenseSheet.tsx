import { useEffect, useRef, useState } from "react";
import { todayISO, isoToShortDate, shortDateToISO } from "../../utils/dates";
import {
  EXPENSE_CATEGORIES, EXPENSE_PAYMENT_METHODS,
  PAYMENT_METHOD, TAX_TREATMENT, TAX_TREATMENTS,
} from "../../data/constants";
import { IconX, IconPaperclip, IconCheck, IconTrash, IconRepeat, IconSparkle } from "../Icons";
import { MoneyInput } from "../MoneyInput";
import { useCardiganMain } from "../../context/CardiganContext";
import { useT } from "../../i18n/index";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useSheetExit } from "../../hooks/useSheetExit";
import { haptic } from "../../utils/haptics";
import { formatMXN } from "../../utils/format";
import { supabase } from "../../supabaseClient";
import { isNative } from "../../lib/platform";
import { takePhoto } from "../../lib/nativeCamera";
import { SheetOverlay } from "../SheetOverlay";
import { ConfirmDialog } from "../ConfirmDialog";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed expense/document rows + OCR payload
type Row = any;

export function ExpenseSheet({ editingExpense, onClose }: { editingExpense?: Row; onClose: () => void }) {
  const {
    createExpense, updateExpense, deleteExpense,
    createRecurringTemplate, mutating, mutationError,
    uploadDocument, deleteDocument, getDocumentUrl,
    documents = [], subscription, showToast,
  } = useCardiganMain();
  const { t } = useT();
  const isEditing = !!editingExpense;

  // Animated close — see useSheetExit / SessionSheet for the pattern.
  // safeClose gates escape / overlay / X behind the mutation lock
  // (no closing while a save is in flight); useSheetDrag stays on
  // raw onClose because it owns its own slide-down anim.
  const { exiting, animatedClose } = useSheetExit(true, onClose);
  const safeClose = mutating ? null : onClose;
  const safeAnimatedClose = mutating ? null : animatedClose;
  useEscape(safeAnimatedClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(safeClose || (() => {}), { isOpen: true });
  const setPanel = (el: HTMLElement | null) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  const lastCategory = (typeof window !== "undefined" && localStorage.getItem(LAST_CATEGORY_KEY)) || EXPENSE_CATEGORIES[0];

  const [amount, setAmount] = useState(editingExpense ? String(editingExpense.amount || "") : "");
  const [category, setCategory] = useState<string>(editingExpense?.category || lastCategory);
  const [description, setDescription] = useState(editingExpense?.description || "");
  const [date, setDate] = useState(editingExpense?.date ? shortDateToISO(editingExpense.date) : todayISO());
  const [paymentMethod, setPaymentMethod] = useState<string>(editingExpense?.payment_method || PAYMENT_METHOD.TRANSFER);
  const [taxTreatment, setTaxTreatment] = useState<string>(editingExpense?.tax_treatment || TAX_TREATMENT.DEDUCTIBLE);
  const [cfdiUuid, setCfdiUuid] = useState(editingExpense?.cfdi_uuid || "");
  const [cfdiUrl, setCfdiUrl] = useState(editingExpense?.cfdi_url || "");
  const [showCfdi, setShowCfdi] = useState(!!editingExpense?.cfdi_uuid);
  const [note, setNote] = useState(editingExpense?.note || "");
  const [receiptDocId, setReceiptDocId] = useState<string | null>(editingExpense?.receipt_document_id || null);
  const [receiptName, setReceiptName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [dayOfMonth, setDayOfMonth] = useState(() => {
    const d = editingExpense?.date ? new Date(shortDateToISO(editingExpense.date)) : new Date();
    return Number.isFinite(d.getDate()) ? d.getDate() : 1;
  });
  const [formError, setFormError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [ocring, setOcring] = useState(false);
  const [ocrNotice, setOcrNotice] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // OCR fires after a fresh receipt upload — never on edit (the
  // existing row already has fields the user reviewed). Pre-fills
  // ONLY empty fields so the user's typed input is sacred. Pro-only
  // for cost control; non-Pro uploads still attach the receipt, just
  // without auto-fill.
  const runOcr = async (documentId: string) => {
    if (isEditing) return; // never re-OCR an existing row
    if (!subscription?.isPro) return;
    setOcring(true);
    setOcrNotice("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/ocr-receipt", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ documentId }),
      });
      if (!res.ok) {
        // Soft-fail: receipt is still attached, the user fills the
        // form manually. We don't surface a blocking error — HEIC
        // (the historical 415 case) is now auto-converted at upload
        // time by maybeConvertHeic, so this branch is mostly hit by
        // genuine outages.
        return;
      }
      const ocr = await res.json();
      // Pre-fill empty fields. Setter functions check the current
      // state value via callback form so a fast typist who started
      // typing during the OCR call doesn't get clobbered.
      if (ocr.amount != null) setAmount((a) => a ? a : String(ocr.amount));
      if (ocr.date) setDate((d) => (d && d !== todayISO()) ? d : ocr.date);
      if (ocr.vendor || ocr.description) {
        setDescription((cur: string) => {
          if (cur && cur.trim()) return cur;
          // Prefer description; fall back to vendor; concatenate if
          // both look distinct enough to be useful.
          if (ocr.vendor && ocr.description && !ocr.description.toLowerCase().includes(ocr.vendor.toLowerCase())) {
            return `${ocr.vendor} · ${ocr.description}`.slice(0, 80);
          }
          return (ocr.description || ocr.vendor || "").slice(0, 80);
        });
      }
      if (ocr.category) setCategory((c) => c && c !== EXPENSE_CATEGORIES[0] ? c : ocr.category);
      if (ocr.cfdiUuid) {
        setCfdiUuid((u: string) => u || ocr.cfdiUuid);
        setShowCfdi(true);
      }
      // Build a transparent narration of what Cardi actually filled
      // in. "Cardi llenó los campos" is too generic — listing the
      // specific values lets the user spot mistakes at a glance
      // without having to scan every field. Skip the listing on low
      // confidence (the warning is more important than the values).
      if (ocr.confidence === "low") {
        setOcrNotice(t("gastos.ocrLowConfidence"));
      } else {
        const filled: string[] = [];
        if (ocr.amount != null) filled.push(formatMXN(ocr.amount));
        if (ocr.category) filled.push(t(`gastos.cat.${ocr.category}`));
        if (ocr.date) {
          // Use Spanish short date so it matches the rest of the app.
          const d = new Date(ocr.date + "T00:00:00");
          if (!isNaN(d.getTime())) {
            const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
            filled.push(`${d.getDate()}-${months[d.getMonth()]}`);
          }
        }
        if (filled.length > 0) {
          setOcrNotice(t("gastos.ocrFilledList", { values: filled.join(" · ") }));
        }
      }
    } catch {
      // Network error — silent. Receipt is still attached.
    } finally {
      setOcring(false);
    }
  };

  // Display name for an existing receipt (best-effort — we don't refetch
  // the document name, just show "Recibo adjunto" in the editing case).
  useEffect(() => {
    if (editingExpense?.receipt_document_id) setReceiptName(t("gastos.receiptAttached"));
  }, [editingExpense?.receipt_document_id, t]);

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    setUploading(true);
    setFormError("");
    setOcrNotice("");
    try {
      const doc = await uploadDocument({ file, kind: "receipt" });
      if (doc?.id) {
        setReceiptDocId(doc.id);
        setReceiptName(doc.name || file.name);
        // Fire OCR after the upload completes. The user sees the
        // upload land first ("Recibo adjunto" pill), then a Sparkle
        // pill while OCR runs, then the form fields populate.
        runOcr(doc.id);
      } else {
        setFormError(t("docs.uploadFailed") || "Error al subir el recibo");
      }
    } catch (e) {
      setFormError((e as Error)?.message || "Error al subir el recibo");
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
    // Look up the doc to get its file_path, presign a GET URL, and
    // open in a new tab. We deliberately avoid mounting a lightbox
    // inside the sheet — modal-on-modal is awkward, and the new-tab
    // path works for both images and PDFs without z-index drama.
    const doc = documents.find((d: Row) => d.id === receiptDocId);
    if (!doc?.file_path) return;
    const url = await getDocumentUrl(doc.file_path);
    if (url && typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
  };

  const submit = async (e: React.FormEvent) => {
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
        if (ok) { haptic.success(); animatedClose(`${t("gastos.updated")}: −${formatMXN(parsedAmount)}`); }
      } else {
        // When the user toggled "Make recurring", we MUST create the
        // template FIRST and link the just-created expense to its
        // (template, year, month) slot. Otherwise the next app-load
        // auto-extension sees the slot as unclaimed (recurring_id is
        // null on the manual row) and inserts a SECOND expense for
        // the same month — a real double-billing bug.
        let recurringLink: Record<string, unknown> = {};
        if (makeRecurring) {
          const tpl = await createRecurringTemplate({
            amount: parsedAmount,
            category,
            description: description.trim(),
            dayOfMonth,
            paymentMethod,
            taxTreatment,
          });
          if (tpl?.id) {
            // Derive period from the user-picked date (ISO yyyy-mm-dd).
            const [y, m] = date.split("-").map(Number);
            recurringLink = {
              recurringId: tpl.id,
              periodYear: y || null,
              periodMonth: m || null,
            };
          }
          // If template creation failed, fall through and create a
          // plain expense — the toggle was a nice-to-have, not load-
          // bearing. The user keeps their data; we silently degrade
          // to non-recurring.
        }
        const ok = await createExpense({ ...payload, ...recurringLink });
        if (!ok) {
          setFormError(mutationError || "Error al guardar");
          return;
        }
        haptic.success();
        animatedClose(`${t("gastos.saved")}: −${formatMXN(parsedAmount)}`);
      }
    } catch (ex) {
      setFormError((ex as Error)?.message || "Error al guardar");
    }
  };

  const handleDelete = () => {
    if (!isEditing) return;
    setConfirmDelete(true);
  };

  const doDelete = async () => {
    const ok = await deleteExpense(editingExpense.id);
    setConfirmDelete(false);
    if (ok) { haptic.success(); animatedClose(t("gastos.deleted")); }
  };

  return (
    <SheetOverlay exiting={exiting} onClose={safeAnimatedClose || undefined}>
      <div ref={setPanel} className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`} role="dialog" aria-modal="true"
        aria-label={isEditing ? t("gastos.edit") : t("gastos.record")}
        {...panelHandlers}
        style={{ maxHeight: "min(92lvh, calc(100lvh - var(--sat) - 16px))" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{isEditing ? t("gastos.edit") : t("gastos.record")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={safeAnimatedClose || undefined}>
            <IconX size={14} />
          </button>
        </div>
        <form onSubmit={submit} style={{ padding: "0 20px 0" }}>
          <div>
            {/* Amount — the user taps the field to start entering; we don't
                auto-pop the keyboard on open (it reads as intrusive and rushed). */}
            <div className="input-group">
              <label className="input-label">
                {t("gastos.amount")}
                <span style={{ color: "var(--red)", marginLeft: 4 }} aria-hidden>*</span>
              </label>
              <MoneyInput min="1" step="1" required value={amount}
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
              {!receiptDocId && !isNative() && (
                <button type="button" className="btn btn-secondary btn-tap"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  style={{ width: "100%", height: 44, gap: 8 }}>
                  <IconPaperclip size={16} />
                  <span>{uploading ? t("gastos.receiptUploading") : t("gastos.receiptUpload")}</span>
                </button>
              )}
              {/* Native: Tomar foto (Camera plugin) + Galería/Archivo (file
                  input, still works in WKWebView and gives access to PDFs
                  + Files app). The Camera path is the headline action
                  because most therapists photograph paper receipts on the
                  spot; the secondary button covers the rare PDF case. */}
              {!receiptDocId && isNative() && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="btn btn-secondary btn-tap"
                    onClick={async () => {
                      try {
                        const file = await takePhoto({ quality: 80 });
                        if (file) handleFile(file);
                      } catch {
                        // Real camera failure (permission/hardware) — a
                        // user cancel returns null and never reaches here.
                        showToast?.(t("gastos.receiptCameraError"), "error");
                      }
                    }}
                    disabled={uploading}
                    style={{ flex: 1, height: 44, gap: 6 }}>
                    <IconPaperclip size={14} />
                    <span>{uploading ? t("gastos.receiptUploading") : t("gastos.receiptTakePhoto")}</span>
                  </button>
                  <button type="button" className="btn btn-secondary btn-tap"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    style={{ flex: 1, height: 44, gap: 6 }}>
                    <span>{t("gastos.receiptFromLibrary")}</span>
                  </button>
                </div>
              )}
              {receiptDocId && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "10px 12px", background: "var(--green-bg)",
                  border: "1px solid var(--border-lt)",
                  borderRadius: "var(--radius)",
                }}>
                  <IconCheck size={14} style={{ color: "var(--green)" }} />
                  <button type="button" className="btn-tap"
                    onClick={handleViewReceipt}
                    style={{
                      flex: 1, textAlign: "left",
                      background: "transparent", border: "none", padding: 0,
                      fontSize: 13, color: "var(--charcoal)", fontFamily: "inherit",
                      cursor: receiptDocId ? "pointer" : "default",
                      textDecoration: receiptDocId ? "underline" : "none",
                      textUnderlineOffset: 2,
                      textDecorationColor: "var(--charcoal-xl)",
                    }}>
                    {receiptName || t("gastos.receiptAttached")}
                  </button>
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
              {/* OCR status pill. Three states:
                    1. ocring=true        — sparkle + "Analizando recibo..."
                    2. ocrNotice set      — sparkle + the notice (filled / low confidence)
                    3. neither            — fall back to the static help line
                  Pro-only OCR; for non-Pro the receipt still attaches but no pill appears. */}
              {(ocring || ocrNotice) ? (
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  marginTop: 6, fontSize: 12,
                  color: ocrNotice && !ocring && String(ocring) !== "low"
                    ? "var(--teal-dark)" : "var(--charcoal-md)",
                }}>
                  <IconSparkle size={12} />
                  <span>{ocring ? t("gastos.ocrAnalyzing") : ocrNotice}</span>
                </div>
              ) : (
                <span className="input-help" style={{ display: "block", marginTop: 4 }}>
                  {t("gastos.receiptHint")}
                </span>
              )}
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
      <ConfirmDialog
        open={confirmDelete}
        destructive
        busy={mutating}
        title={t("gastos.deleteConfirm")}
        body={t("gastos.deleteWarning")}
        confirmLabel={t("delete")}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </SheetOverlay>
  );
}
