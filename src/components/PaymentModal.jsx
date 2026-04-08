import { useEffect, useState } from "react";
import { todayISO, isoToShortDate } from "../data/api";
import { IconX } from "./Icons";

export function PaymentModal({
  open,
  onClose,
  patients,
  initialPatientName,
  initialAmount,
  onSubmit,
  mutating,
}) {
  const [patientName, setPatientName] = useState(initialPatientName || "");
  const [amount, setAmount] = useState(initialAmount || "");
  const [method, setMethod] = useState("Transferencia");
  const [date, setDate] = useState(todayISO());
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!open) return;
    setPatientName(initialPatientName || "");
    setAmount(initialAmount || "");
    setMethod("Transferencia");
    setDate(todayISO());
    setFormError("");
  }, [open, initialPatientName, initialAmount]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    const parsedAmount = Number(amount);
    if (!patientName.trim()) {
      setFormError("Selecciona un paciente.");
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError("Ingresa un monto valido.");
      return;
    }
    setFormError("");
    const ok = await onSubmit({
      patientName: patientName.trim(),
      amount: parsedAmount,
      method,
      date: isoToShortDate(date),
    });
    if (ok) onClose();
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">Registrar pago</span>
          <button className="sheet-close" onClick={onClose}><IconX size={14} /></button>
        </div>
        <form onSubmit={submit} style={{ padding:"0 20px 22px" }}>
          <div className="input-group">
            <label className="input-label">Paciente</label>
            <select className="input" value={patientName} onChange={(e) => setPatientName(e.target.value)}>
              <option value="">Seleccionar paciente</option>
              {patients.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">Monto</label>
            <input className="input" type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="700" />
          </div>
          <div className="input-group">
            <label className="input-label">Método</label>
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="Transferencia">Transferencia</option>
              <option value="Efectivo">Efectivo</option>
            </select>
          </div>
          <div className="input-group">
            <label className="input-label">Fecha</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {formError && <div style={{ fontSize:12, color:"var(--red)", marginBottom:10 }}>{formError}</div>}
          <button className="btn btn-primary" type="submit" disabled={mutating}>
            {mutating ? "Guardando..." : "Guardar pago"}
          </button>
        </form>
      </div>
    </div>
  );
}
