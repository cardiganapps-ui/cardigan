import { supabase } from "../supabaseClient";
import { PAYMENT_METHOD } from "../data/constants";
import { formatShortDate, getInitials, normalizeShortDate } from "../utils/dates";
import { recalcPatientCounters } from "../utils/patients";

export function createPaymentActions(userId, patients, setPatients, payments, setPayments, setMutating, setMutationError) {

  async function createPayment({ patientName, amount, method = PAYMENT_METHOD.TRANSFER, date = formatShortDate(), note = "" }) {
    const parsedAmount = Number(amount);
    if (!patientName || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return false;
    const patient = patients.find(p => p.name === patientName);

    setMutating(true);
    setMutationError("");
    const { data, error } = await supabase.from("payments").insert({
      user_id: userId,
      patient_id: patient?.id || null,
      patient: patientName,
      initials: patient?.initials || getInitials(patientName),
      amount: parsedAmount, date, method,
      note: note || null,
      color_idx: patient?.colorIdx || 0,
    }).select().single();
    if (error) { setMutating(false); setMutationError(error.message); return false; }

    if (patient) {
      const newPaid = patient.paid + parsedAmount;
      const { error: pErr } = await supabase.from("patients")
        .update({ paid: newPaid }).eq("id", patient.id).eq("user_id", userId);
      if (pErr) {
        const fixed = await recalcPatientCounters(patient.id);
        if (fixed) setPatients(prev => prev.map(p => p.id === patient.id ? { ...p, ...fixed } : p));
      } else {
        setPatients(prev => prev.map(p => p.id === patient.id ? { ...p, paid: newPaid } : p));
      }
    }

    setPayments(prev => [{ ...data, colorIdx: data.color_idx }, ...prev]);
    setMutating(false);
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

  async function updatePayment(paymentId, { patientName, amount, method, date, note }) {
    const oldPayment = payments.find(p => p.id === paymentId);
    if (!oldPayment) return false;
    const parsedAmount = Number(amount);
    if (!patientName || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return false;
    const newPatient = patients.find(p => p.name === patientName);

    setMutating(true);
    setMutationError("");

    // Update the payment row
    const { data, error } = await supabase.from("payments").update({
      patient_id: newPatient?.id || null,
      patient: patientName,
      initials: newPatient?.initials || getInitials(patientName),
      amount: parsedAmount, date, method,
      note: note || null,
      color_idx: newPatient?.colorIdx || 0,
    }).eq("id", paymentId).eq("user_id", userId).select().single();
    if (error) { setMutating(false); setMutationError(error.message); return false; }

    // Adjust old patient's paid counter (subtract old amount)
    if (oldPayment.patient_id) {
      const oldPatient = patients.find(p => p.id === oldPayment.patient_id);
      if (oldPatient) {
        const newPaid = Math.max(0, oldPatient.paid - oldPayment.amount);
        const { error: pErr } = await supabase.from("patients")
          .update({ paid: newPaid }).eq("id", oldPatient.id).eq("user_id", userId);
        if (pErr) {
          const fixed = await recalcPatientCounters(oldPatient.id);
          if (fixed) setPatients(prev => prev.map(p => p.id === oldPatient.id ? { ...p, ...fixed } : p));
        } else {
          setPatients(prev => prev.map(p => p.id === oldPatient.id ? { ...p, paid: newPaid } : p));
        }
      }
    }

    // Adjust new patient's paid counter (add new amount)
    if (newPatient) {
      // Re-read the patient in case it was the same and we just decremented
      const freshPatient = newPatient.id === oldPayment.patient_id
        ? { ...newPatient, paid: Math.max(0, newPatient.paid - oldPayment.amount) }
        : patients.find(p => p.id === newPatient.id) || newPatient;
      const newPaid = freshPatient.paid + parsedAmount;
      const { error: pErr } = await supabase.from("patients")
        .update({ paid: newPaid }).eq("id", newPatient.id).eq("user_id", userId);
      if (pErr) {
        const fixed = await recalcPatientCounters(newPatient.id);
        if (fixed) setPatients(prev => prev.map(p => p.id === newPatient.id ? { ...p, ...fixed } : p));
      } else {
        setPatients(prev => prev.map(p => p.id === newPatient.id ? { ...p, paid: newPaid } : p));
      }
    }

    setPayments(prev => prev.map(p => p.id === paymentId ? { ...data, colorIdx: data.color_idx } : p));
    setMutating(false);
    return true;
  }

  // The initial fetch in useCardiganData windows payments to the last 12
  // months. For a single patient's Finanzas tab the therapist may need
  // older history — this pulls every payment older than what's already
  // loaded for that patient and merges it into local state. Returns the
  // count of rows added (0 means there is nothing older in the DB).
  async function loadOlderPayments(patientId) {
    if (!patientId || !userId) return 0;
    setMutationError("");

    const oldestISO = payments.reduce((min, p) => {
      if (p.patient_id !== patientId || !p.created_at) return min;
      return (!min || p.created_at < min) ? p.created_at : min;
    }, null);

    let query = supabase.from("payments").select("*")
      .eq("user_id", userId)
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false });
    if (oldestISO) query = query.lt("created_at", oldestISO);

    const { data, error } = await query;
    if (error) { setMutationError(error.message); return 0; }

    const rows = (data || []).map(r => ({
      ...r,
      date: r.date ? normalizeShortDate(r.date) : r.date,
      colorIdx: r.color_idx,
    }));
    if (rows.length === 0) return 0;

    let added = 0;
    setPayments(prev => {
      const existing = new Set(prev.map(p => p.id));
      const fresh = rows.filter(r => !existing.has(r.id));
      added = fresh.length;
      return fresh.length === 0 ? prev : [...prev, ...fresh];
    });
    return added;
  }

  return { createPayment, deletePayment, updatePayment, loadOlderPayments };
}
