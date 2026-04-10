import { useEffect, useState } from "react";
import { todayISO, isoToShortDate } from "../utils/dates";
import { IconX } from "./Icons";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";

export function PaymentModal({ open, onClose, initialPatientName, initialAmount }) {
  const { patients, createPayment, mutating } = useCardigan();
  const { t } = useT();
  useEscape(open ? onClose : null);
  const [patientName, setPatientName] = useState(initialPatientName || "");
  const [amount, setAmount] = useState(initialAmount || "");
  const [method, setMethod] = useState("Transferencia");
  const [customMethod, setCustomMethod] = useState("");
  const [date, setDate] = useState(todayISO());
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!open) return;
    setPatientName(initialPatientName || "");
    setAmount(initialAmount || "");
    setMethod("Transferencia");
    setCustomMethod("");
    setDate(todayISO());
    setFormError("");
  }, [open, initialPatientName, initialAmount]);

  const handlePatientChange = (name) => {
    setPatientName(name);
    if (name) {
      const p = patients.find(pt => pt.name === name);
      if (p && p.amountDue > 0) setAmount(String(p.amountDue));
      else setAmount("");
    }
  };

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    const parsedAmount = Number(amount);
    if (!patientName.trim()) {
      setFormError(t("finances.selectPatient"));
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError(t("finances.enterAmount"));
      return;
    }
    const finalMethod = method === "Otro" ? (customMethod.trim() || t("finances.other")) : method;
    setFormError("");
    const ok = await createPayment({
      patientName: patientName.trim(),
      amount: parsedAmount,
      method: finalMethod,
      date: isoToShortDate(date),
    });
    if (ok) onClose();
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("finances.recordPayment")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={onClose}><IconX size={14} /></button>
        </div>
        <form onSubmit={submit} style={{ padding:"0 20px 22px" }}>
          <div className="input-group">
            <label className="input-label">{t("sessions.patient")}</label>
            <select className="input" value={patientName} onChange={(e) => handlePatientChange(e.target.value)}>
              <option value="">{t("finances.selectPatient")}</option>
              {patients.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">{t("finances.amount")}</label>
            <input className="input" type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t("patients.ratePlaceholder")} />
          </div>
          <div className="input-group">
            <label className="input-label">{t("finances.method")}</label>
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="Transferencia">{t("finances.transfer")}</option>
              <option value="Efectivo">{t("finances.cash")}</option>
              <option value="Otro">{t("finances.other")}</option>
            </select>
          </div>
          {method === "Otro" && (
            <div className="input-group">
              <label className="input-label">{t("finances.specifyMethod")}</label>
              <input className="input" type="text" value={customMethod} onChange={(e) => setCustomMethod(e.target.value)} placeholder={t("finances.otherPlaceholder")} />
            </div>
          )}
          <div className="input-group">
            <label className="input-label">{t("finances.paymentDate")}</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {formError && <div style={{ fontSize:12, color:"var(--red)", marginBottom:10 }}>{formError}</div>}
          <button className="btn btn-primary" type="submit" disabled={mutating}>
            {mutating ? t("saving") : t("finances.savePayment")}
          </button>
        </form>
      </div>
    </div>
  );
}
