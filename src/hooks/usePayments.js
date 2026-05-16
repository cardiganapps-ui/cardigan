import { supabase } from "../supabaseClient";
import { PAYMENT_METHOD } from "../data/constants";
import { formatShortDate, getInitials } from "../utils/dates";
import { recalcPatientCounters } from "../utils/patients";
import { enqueue, registerHandler, onReplay } from "../lib/mutationQueue.js";

// Mirrors the session-side strings from useSessions.js. Keep the wording
// uniform — users see the same message whether they conflict on a
// session edit or a payment edit.
const CONFLICT_MSG = "Este pago se editó en otro lugar. Volvimos a cargarlo — intenta de nuevo.";
const MISSING_MSG = "Este pago ya no existe.";

// Offline queue handlers, registered once at module load time
// (idempotent — registerHandler is a Map.set). Each handler runs the
// supabase call with the persisted args; the result shape mirrors a
// normal supabase response so the replay listener can reconcile state.
//
// Important: replay handlers DO NOT carry the F-tier version filter
// for locked updates (e.g. payments.update). The queue's last-write-
// wins semantics is intentional for offline writes — the user already
// saw their offline state and expects it to persist. See migration 066
// and the queue lib docblock for the full tradeoff.
registerHandler("payments.insert", async ({ row }) => {
  return await supabase.from("payments").insert(row).select().single();
});

registerHandler("payments.delete", async ({ id, userId }) => {
  return await supabase.from("payments").delete().eq("id", id).eq("user_id", userId);
});

registerHandler("payments.update", async ({ id, userId, patch }) => {
  // No .eq("version") — offline replay is last-write-wins by design.
  return await supabase.from("payments").update(patch).eq("id", id).eq("user_id", userId).select().maybeSingle();
});

// createPaymentActions is invoked on every render of useCardiganData,
// so subscribing inside the factory would leak listeners. We register
// the replay reconciler ONCE at module load and route to the latest
// setPayments via a module-level ref that the factory updates.
let _setPaymentsRef = null;
onReplay((entry, result) => {
  if (entry.op !== "payments.insert") return;
  if (!result || result.error || !result.data) return;
  const tempId = entry.optimisticMeta?.tempId;
  if (!tempId || !_setPaymentsRef) return;
  _setPaymentsRef(prev => prev.map(p => p.id === tempId
    ? { ...result.data, colorIdx: result.data.color_idx }
    : p));
});

export function createPaymentActions(userId, patients, setPatients, payments, setPayments, setMutating, setMutationError) {
  // Refresh the module-level setPayments ref so the once-registered
  // onReplay listener writes into the live state holder. Cheap pointer
  // swap — re-running this per render is fine.
  _setPaymentsRef = setPayments;

  // Optimistic: the PaymentModal closes in the same frame the user
  // taps Save. We add a temporary row with a client-side id, apply
  // the patient.paid update locally, and fire the insert in the
  // background. If the browser reports offline, the insert is queued
  // to IndexedDB and replayed on reconnect (Phase 1 of offline support).
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

    const row = {
      user_id: userId,
      patient_id: patient?.id || null,
      patient: patientName,
      initials: patient?.initials || getInitials(patientName),
      amount: parsedAmount, date, method,
      note: note || null,
      color_idx: patient?.colorIdx || 0,
    };

    // Offline path: queue the insert and return success. The optimistic
    // row stays in payments state with its temp id; the replay listener
    // above swaps it on drain. patient.paid stays at the optimistic
    // value; the trigger reconciles on next refetch after drain.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      await enqueue("payments.insert", { row }, { tempId });
      return true;
    }

    (async () => {
      try {
        const { data, error } = await supabase.from("payments").insert(row).select().single();

        if (error) {
          setPayments(prev => prev.filter(p => p.id !== tempId));
          if (prevPatient) setPatients(prev => prev.map(p => p.id === prevPatient.id ? prevPatient : p));
          setMutationError(error.message);
          return;
        }
        // Swap the temp row for the server-assigned one so later edits
        // and deletes can reference a real DB id. patient.paid is now
        // maintained by the trg_payments_recalc_paid trigger
        // (migration 068) — the JS optimistic state already reflects the
        // expected value and will reconcile to the trigger's truth on
        // the next refetch.
        setPayments(prev => prev.map(p => p.id === tempId ? { ...data, colorIdx: data.color_idx } : p));
      } catch (e) {
        // Catch fires for transport-level failures (fetch threw, e.g.
        // network dropped mid-flight). Queue + return success so the
        // user doesn't lose their write — drain on reconnect.
        await enqueue("payments.insert", { row }, { tempId });
        setMutationError("");
      }
    })();

    return true;
  }

  async function deletePayment(paymentId) {
    const payment = payments.find(p => p.id === paymentId);
    setMutationError("");

    // Optimistic removal + patient.paid decrement (trigger reconciles
    // the persisted value on the next refetch).
    setPayments(prev => prev.filter(p => p.id !== paymentId));
    if (payment?.patient_id) {
      const patient = patients.find(p => p.id === payment.patient_id);
      if (patient) {
        const newPaid = Math.max(0, patient.paid - payment.amount);
        setPatients(prev => prev.map(p => p.id === patient.id ? { ...p, paid: newPaid } : p));
      }
    }

    // Skip the network call when we know we can't reach it. Deleting
    // a temp-id row (one that originated offline and hasn't drained
    // yet) is also a queue-only operation — no real row exists yet.
    const isOptimisticRow = typeof paymentId === "string" && paymentId.startsWith("temp-");
    if (isOptimisticRow || (typeof navigator !== "undefined" && navigator.onLine === false)) {
      if (!isOptimisticRow) {
        await enqueue("payments.delete", { id: paymentId, userId });
      }
      // For an unqueued temp row we just drop the optimistic insert
      // from the queue (Phase 3 — for now the entry replays harmlessly
      // and the resulting row gets deleted on next user action).
      return true;
    }

    setMutating(true);
    let error;
    try {
      const res = await supabase.from("payments").delete().eq("id", paymentId).eq("user_id", userId);
      error = res.error;
    } catch (e) {
      // Transport-level failure — queue for retry.
      await enqueue("payments.delete", { id: paymentId, userId });
      setMutating(false);
      return true;
    }
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
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

    const revertOptimistic = () => {
      setPayments(prev => prev.map(p => p.id === paymentId ? prevPayment : p));
      setPatients(prev => prev.map(p => {
        if (prevOldPatient && p.id === prevOldPatient.id) return prevOldPatient;
        if (prevNewPatient && p.id === prevNewPatient.id) return prevNewPatient;
        return p;
      }));
    };

    // Optimistic locking (migration 066). The version filter rejects
    // a write when another tab / device bumped the row under us — we
    // detect the empty-data shape via .maybeSingle() returning null,
    // refetch the row to learn server truth, and surface a friendly
    // conflict message. Falls back to the unguarded path when the
    // local row predates the column (version undefined).
    const expectedVersion = prevPayment.version ?? null;

    const reconcileConflict = async () => {
      const { data: fresh } = await supabase
        .from("payments")
        .select("*")
        .eq("id", paymentId)
        .eq("user_id", userId)
        .maybeSingle();
      if (fresh) {
        setPayments(prev => prev.map(p => p.id === paymentId
          ? { ...fresh, colorIdx: fresh.color_idx }
          : p));
        setMutationError(CONFLICT_MSG);
      } else {
        setPayments(prev => prev.filter(p => p.id !== paymentId));
        setMutationError(MISSING_MSG);
      }
      // Patient counters were mutated optimistically; restore the
      // pre-attempt snapshot and let recalc reconcile from truth.
      setPatients(prev => prev.map(p => {
        if (prevOldPatient && p.id === prevOldPatient.id) return prevOldPatient;
        if (prevNewPatient && p.id === prevNewPatient.id) return prevNewPatient;
        return p;
      }));
      for (const patientId of patientUpdates.keys()) {
        recalcPatientCounters(patientId).then((fixed) => {
          if (fixed) setPatients(prev => prev.map(p => p.id === patientId ? { ...p, ...fixed } : p));
        }).catch(() => {});
      }
    };

    const patch = {
      patient_id: newPatient?.id || null,
      patient: patientName,
      initials: newPatient?.initials || getInitials(patientName),
      amount: parsedAmount, date, method,
      note: note || null,
      color_idx: newPatient?.colorIdx || 0,
    };

    // Offline: queue without the version filter (last-write-wins on
    // replay) and return. Optimistic state already applied above.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      await enqueue("payments.update", { id: paymentId, userId, patch });
      return true;
    }

    (async () => {
      try {
        let q = supabase.from("payments").update(patch).eq("id", paymentId).eq("user_id", userId);
        if (expectedVersion != null) q = q.eq("version", expectedVersion);
        const { data, error } = await q.select().maybeSingle();

        if (error) {
          revertOptimistic();
          setMutationError(error.message);
          return;
        }
        if (expectedVersion != null && !data) {
          // Version filter rejected — another writer bumped the row.
          await reconcileConflict();
          return;
        }
        setPayments(prev => prev.map(p => p.id === paymentId ? { ...data, colorIdx: data.color_idx } : p));

        // patient.paid is maintained by trg_payments_recalc_paid
        // (migration 068). The trigger fires on the UPDATE we just
        // ran and recomputes paid for both sides when patient_id
        // changes — see the migration's UPDATE branch. Local React
        // state was already adjusted optimistically above.
      } catch {
        // Transport failure mid-flight — queue with last-write-wins
        // replay semantics. Optimistic state stays in place.
        await enqueue("payments.update", { id: paymentId, userId, patch });
      }
    })();

    return true;
  }

  return { createPayment, deletePayment, updatePayment };
}
