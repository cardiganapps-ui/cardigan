import { supabase } from "../supabaseClient";
import { PAYMENT_METHOD } from "../data/constants";
import { formatShortDate, getInitials } from "../utils/dates";
import { recalcPatientCounters } from "../utils/patients";

export function createPaymentActions(userId, patients, setPatients, payments, setPayments, setMutating, setMutationError) {

  // Optimistic: the PaymentModal closes in the same frame the user
  // taps Save. We add a temporary row with a client-side id, apply
  // the patient.paid update locally, and fire the inserts in the
  // background. On server error we revert both and raise a toast.
  async function createPayment({ patientName, amount, method = PAYMENT_METHOD.TRANSFER, date = formatShortDate(), note = "" }) {
    const parsedAmount = Number(amount);
    if (!patientName || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return false;
    const patient = patients.find(p => p.name === patientName);
    const prevPatient = patient ? { ...patient } : null;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticRow = {
      id: tempId,
      user_id: userId,
      patient_id: patient?.id || null,
      patient: patientName,
      initials: patient?.initials || getInitials(patientName),
      amount: parsedAmount, date, method,
      note: note || null,
      colorIdx: patient?.colorIdx || 0,
      _optimistic: true,
    };
    const newPaid = patient ? patient.paid + parsedAmount : null;

    setPayments(prev => [optimisticRow, ...prev]);
    if (patient && newPaid != null) {
      setPatients(prev => prev.map(p => p.id === patient.id ? { ...p, paid: newPaid } : p));
    }
    setMutationError("");

    (async () => {
      const { data, error } = await supabase.from("payments").insert({
        user_id: userId,
        patient_id: patient?.id || null,
        patient: patientName,
        initials: patient?.initials || getInitials(patientName),
        amount: parsedAmount, date, method,
        note: note || null,
        color_idx: patient?.colorIdx || 0,
      }).select().single();

      if (error) {
        setPayments(prev => prev.filter(p => p.id !== tempId));
        if (prevPatient) setPatients(prev => prev.map(p => p.id === prevPatient.id ? prevPatient : p));
        setMutationError(error.message);
        return;
      }
      // Swap the temp row for the server-assigned one so later edits
      // and deletes can reference a real DB id.
      setPayments(prev => prev.map(p => p.id === tempId ? { ...data, colorIdx: data.color_idx } : p));

      if (patient && newPaid != null) {
        const { error: pErr } = await supabase.from("patients")
          .update({ paid: newPaid }).eq("id", patient.id).eq("user_id", userId);
        if (pErr) {
          const fixed = await recalcPatientCounters(patient.id);
          if (fixed) setPatients(prev => prev.map(p => p.id === patient.id ? { ...p, ...fixed } : p));
        }
      }
    })();

    return true;
  }

  async function deletePayment(paymentId) {
    const payment = payments.find(p => p.id === paymentId);
    setMutating(true);
    setMutationError("");
    const { error } = await supabase.from("payments").delete().eq("id", paymentId).eq("user_id", userId);
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setPayments(prev => prev.filter(p => p.id !== paymentId));

    if (payment?.patient_id) {
      const patient = patients.find(p => p.id === payment.patient_id);
      if (patient) {
        const newPaid = Math.max(0, patient.paid - payment.amount);
        const { error: pErr } = await supabase.from("patients")
          .update({ paid: newPaid }).eq("id", patient.id).eq("user_id", userId);
        if (pErr) {
          const fixed = await recalcPatientCounters(patient.id);
          if (fixed) setPatients(prev => prev.map(p => p.id === patient.id ? { ...p, ...fixed } : p));
        } else {
          setPatients(prev => prev.map(p => p.id === patient.id ? { ...p, paid: newPaid } : p));
        }
      }
    }
    return true;
  }

  // Optimistic edit: mirrors createPayment's pattern. Captures the
  // previous payment row and both affected patients for revert, then
  // applies the changes locally so the modal can close immediately.
  async function updatePayment(paymentId, { patientName, amount, method, date, note }) {
    const oldPayment = payments.find(p => p.id === paymentId);
    if (!oldPayment) return false;
    const parsedAmount = Number(amount);
    if (!patientName || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return false;
    const newPatient = patients.find(p => p.name === patientName);

    const prevPayment = { ...oldPayment };
    const oldPatient = oldPayment.patient_id ? patients.find(p => p.id === oldPayment.patient_id) : null;
    const prevOldPatient = oldPatient ? { ...oldPatient } : null;
    const prevNewPatient = newPatient ? { ...newPatient } : null;

    // Compute target patient.paid values. When old and new patient are
    // the same we must net against the decremented figure, not apply
    // both adjustments to the original.
    const optimisticRow = {
      ...oldPayment,
      patient_id: newPatient?.id || null,
      patient: patientName,
      initials: newPatient?.initials || getInitials(patientName),
      amount: parsedAmount, date, method,
      note: note || null,
      colorIdx: newPatient?.colorIdx || 0,
      _optimistic: true,
    };

    const patientUpdates = new Map();
    if (oldPatient) {
      const afterSubtract = Math.max(0, oldPatient.paid - oldPayment.amount);
      patientUpdates.set(oldPatient.id, afterSubtract);
    }
    if (newPatient) {
      const base = patientUpdates.get(newPatient.id);
      const start = base != null ? base : newPatient.paid;
      patientUpdates.set(newPatient.id, start + parsedAmount);
    }

    setPayments(prev => prev.map(p => p.id === paymentId ? optimisticRow : p));
    if (patientUpdates.size > 0) {
      setPatients(prev => prev.map(p => patientUpdates.has(p.id) ? { ...p, paid: patientUpdates.get(p.id) } : p));
    }
    setMutationError("");

    (async () => {
      const { data, error } = await supabase.from("payments").update({
        patient_id: newPatient?.id || null,
        patient: patientName,
        initials: newPatient?.initials || getInitials(patientName),
        amount: parsedAmount, date, method,
        note: note || null,
        color_idx: newPatient?.colorIdx || 0,
      }).eq("id", paymentId).eq("user_id", userId).select().single();

      if (error) {
        // Revert payment + both patient counters.
        setPayments(prev => prev.map(p => p.id === paymentId ? prevPayment : p));
        setPatients(prev => prev.map(p => {
          if (prevOldPatient && p.id === prevOldPatient.id) return prevOldPatient;
          if (prevNewPatient && p.id === prevNewPatient.id) return prevNewPatient;
          return p;
        }));
        setMutationError(error.message);
        return;
      }
      setPayments(prev => prev.map(p => p.id === paymentId ? { ...data, colorIdx: data.color_idx } : p));

      // Persist the same patient.paid targets we applied locally. Two
      // targets mean two parallel updates; whichever fails falls back
      // to the recalc helper.
      for (const [patientId, targetPaid] of patientUpdates.entries()) {
        const { error: pErr } = await supabase.from("patients")
          .update({ paid: targetPaid }).eq("id", patientId).eq("user_id", userId);
        if (pErr) {
          const fixed = await recalcPatientCounters(patientId);
          if (fixed) setPatients(prev => prev.map(p => p.id === patientId ? { ...p, ...fixed } : p));
        }
      }
    })();

    return true;
  }

  return { createPayment, deletePayment, updatePayment };
}
