import { useState, useRef } from "react";
import { todayISO, isoToShortDate, shortDateToISO } from "../utils/dates";
import { PAYMENT_METHOD } from "../data/constants";
import { IconX } from "./Icons";
import { MoneyInput } from "./MoneyInput";
import { useCardiganMain } from "../context/CardiganContext";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useSheetDrag } from "../hooks/useSheetDrag";
import { useSheetExit } from "../hooks/useSheetExit";
import { haptic } from "../utils/haptics";
import { formatMXN } from "../utils/format";
import { SheetOverlay } from "./SheetOverlay";

export function PaymentModal({ open, onClose, initialPatientName, initialAmount, editingPayment }: {
  open?: boolean;
  onClose?: () => void;
  initialPatientName?: string;
  initialAmount?: string | number;
  editingPayment?: { id: string; patient?: string; amount?: number; method?: string; date?: string; note?: string } | null;
}) {
  const { patients, createPayment, updatePayment, mutating } = useCardiganMain();
  const { t } = useT();
  const isEditing = !!editingPayment;
  // Animated close — see useSheetExit / SessionSheet for the pattern.
  const { exiting, animatedClose } = useSheetExit(!!open, onClose);
  useEscape(open ? animatedClose : null);
  const panelRef = useFocusTrap(!!open);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose || (() => {}), { isOpen: !!open });
  const setPanel = (el: HTMLElement | null) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };
  const inFlightRef = useRef(false);
  const [patientName, setPatientName] = useState(initialPatientName || "");
  const [amount, setAmount] = useState(initialAmount || "");
  const [method, setMethod] = useState<string>(PAYMENT_METHOD.TRANSFER);
  const [customMethod, setCustomMethod] = useState("");
  const [date, setDate] = useState(todayISO());
  const [paymentNote, setPaymentNote] = useState("");
  const [formError, setFormError] = useState("");

  // Populate form fields when the modal opens (or when the props
  // driving it change while it's open). Adjust-state-during-render is
  // the React-recommended alternative to a reset-in-effect for this
  // "when inputs change, reset derived state" pattern.
  const inputKey = open ? `${editingPayment?.id ?? "new"}:${initialPatientName || ""}:${initialAmount || ""}` : null;
  const [prevInputKey, setPrevInputKey] = useState<string | null>(null);
  if (inputKey !== prevInputKey) {
    setPrevInputKey(inputKey);
    if (inputKey) {
      if (editingPayment) {
        setPatientName(editingPayment.patient || "");
        setAmount(String(editingPayment.amount || ""));
        const stdMethods: string[] = [PAYMENT_METHOD.TRANSFER, PAYMENT_METHOD.CASH, PAYMENT_METHOD.CARD, PAYMENT_METHOD.CARDLESS, PAYMENT_METHOD.OTHER];
        if (editingPayment.method && stdMethods.includes(editingPayment.method)) {
          setMethod(editingPayment.method);
          setCustomMethod("");
        } else {
          setMethod(PAYMENT_METHOD.OTHER);
          setCustomMethod(editingPayment.method || "");
        }
        setDate(editingPayment.date ? shortDateToISO(editingPayment.date) : todayISO());
        setPaymentNote(editingPayment.note || "");
      } else {
        setPatientName(initialPatientName || "");
        setAmount(initialAmount || "");
        setMethod(PAYMENT_METHOD.TRANSFER);
        setCustomMethod("");
        setDate(todayISO());
        setPaymentNote("");
      }
      setFormError("");
    }
  }

  const handlePatientChange = (name: string) => {
    setPatientName(name);
    if (name) {
      const p = patients.find((pt: { name?: string; amountDue?: number }) => pt.name === name);
      if (p && p.amountDue > 0) setAmount(String(p.amountDue));
      else setAmount("");
    }
  };

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Real in-flight guard. The button's `disabled={mutating}` is dead
    // for creates: createPayment is fully optimistic and returns
    // synchronously without ever setting `mutating`, so a fast second
    // tap (or Enter-then-click) used to fire a SECOND createPayment and
    // insert a duplicate payment row — inflating patient.paid. A ref
    // (not state) blocks re-entry synchronously within the same tick.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const parsedAmount = Number(amount);
    if (!patientName.trim()) {
      setFormError(t("finances.selectPatient"));
      inFlightRef.current = false;
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError(t("finances.enterAmount"));
      inFlightRef.current = false;
      return;
    }
    const finalMethod = method === PAYMENT_METHOD.OTHER ? (customMethod.trim() || t("finances.other")) : method;
    setFormError("");
    try {
      if (isEditing) {
        const ok = await updatePayment(editingPayment.id, {
          patientName: patientName.trim(),
          amount: parsedAmount,
          method: finalMethod,
          date: isoToShortDate(date),
          note: paymentNote.trim(),
        });
        if (ok) { haptic.success(); animatedClose(`Pago actualizado: ${formatMXN(parsedAmount)} de ${patientName.trim()}`); }
      } else {
        const ok = await createPayment({
          patientName: patientName.trim(),
          amount: parsedAmount,
          method: finalMethod,
          date: isoToShortDate(date),
          note: paymentNote.trim(),
        });
        if (ok) { haptic.success(); animatedClose(`Pago registrado: ${formatMXN(parsedAmount)} de ${patientName.trim()}`); }
      }
    } catch (ex) {
      setFormError((ex as Error)?.message || "Error al guardar");
    } finally {
      // Released after the awaited create/update settles. On the success
      // path animatedClose already unmounts the modal, so this mainly
      // re-arms the form when a validation/server error kept it open.
      inFlightRef.current = false;
    }
  };

  return (
    <SheetOverlay exiting={exiting} onClose={animatedClose}>
      <div ref={setPanel} className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`} role="dialog" aria-modal="true" {...panelHandlers} style={{ maxHeight:"min(92lvh, calc(100lvh - var(--sat) - 16px))" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{isEditing ? t("finances.editPayment") : t("finances.recordPayment")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={animatedClose}><IconX size={14} /></button>
        </div>
        <form onSubmit={submit} style={{ padding:"0 20px 0" }}>
          <div>
          <div className="input-group">
            <label className="input-label">
              {t("sessions.patient")}
              <span style={{ color:"var(--red)", marginLeft:4 }} aria-hidden>*</span>
            </label>
            <select className="input" required value={patientName} onChange={(e) => handlePatientChange(e.target.value)}>
              <option value="">{t("finances.selectPatient")}</option>
              {/* Every patient is selectable regardless of lifecycle
                  status — a finalized ("ended") or paused patient can
                  still owe a balance and pay it off later, so the picker
                  must not hide them. Sorted active → potential → ended →
                  discarded (stable within each group) so the common case
                  stays at the top. Payment creation has no status gate;
                  the row just records against the patient and the DB
                  trigger recalcs their `paid` counter. */}
              {patients
                .slice()
                .sort((a: { status?: string | null }, b: { status?: string | null }) => {
                  const rank = (s?: string | null) => (s === "active" ? 0 : s === "potential" ? 1 : s === "ended" ? 2 : 3);
                  return rank(a.status) - rank(b.status);
                })
                .map((p: { id?: string; name?: string }) => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">
              {t("finances.amount")}
              <span style={{ color:"var(--red)", marginLeft:4 }} aria-hidden>*</span>
            </label>
            <MoneyInput min="1" step="1" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t("patients.ratePlaceholder")} />
          </div>
          <div className="input-group">
            <label className="input-label">{t("finances.method")}</label>
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value={PAYMENT_METHOD.TRANSFER}>{t("finances.transfer")}</option>
              <option value={PAYMENT_METHOD.CASH}>{t("finances.cash")}</option>
              <option value={PAYMENT_METHOD.CARD}>{t("finances.card")}</option>
              <option value={PAYMENT_METHOD.CARDLESS}>{t("finances.cardlessWithdrawal")}</option>
              <option value={PAYMENT_METHOD.OTHER}>{t("finances.other")}</option>
            </select>
          </div>
          {method === PAYMENT_METHOD.OTHER && (
            <div className="input-group">
              <label className="input-label">{t("finances.specifyMethod")}</label>
              <input className="input" type="text" value={customMethod} onChange={(e) => setCustomMethod(e.target.value)} placeholder={t("finances.otherPlaceholder")} />
            </div>
          )}
          <div className="input-group">
            <label className="input-label">{t("finances.paymentDate")}</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} max={todayISO()} />
          </div>
          <div className="input-group">
            <label className="input-label">{t("finances.paymentNote")}</label>
            <input className="input" type="text" value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} placeholder={t("finances.paymentNotePlaceholder")} />
          </div>
          {formError && <div className="form-error">{formError}</div>}
          </div>
          <div style={{ position:"sticky", bottom:0, background:"var(--white)", padding:"12px 0 22px", borderTop:"1px solid var(--border-lt)", marginTop:8 }}>
            <button className="btn btn-primary-teal" type="submit" disabled={mutating}>
              {mutating ? t("saving") : isEditing ? t("finances.updatePayment") : t("finances.savePayment")}
            </button>
          </div>
        </form>
      </div>
    </SheetOverlay>
  );
}
