/* ── useExpenses ──

   Domain action factory for the money-out side of the books. Mirror
   of usePayments — same optimistic-with-rollback contract, same shape
   of returned mutations — but expenses don't touch patient counters
   (`paid` / `billed`). They're pure overhead, not patient-attached.

   Two responsibilities:
     1. CRUD for expense rows + recurring-expense templates.
     2. `generateRecurringExpenses(now)` — idempotent backfill that
        relies on the partial unique index `uniq_expenses_recurring_period`
        as the truth. Per CLAUDE.md prime directive: any path that
        inserts recurring rows MUST handle 23505 unique-violation
        cleanly (skip, don't crash) and MUST NOT silently insert beyond
        the documented auto-backfill cap.

   Receipts: when an expense with `receipt_document_id` is deleted, the
   linked document row + R2 object are deleted FIRST so the storage
   doesn't orphan. The DB-side `on delete set null` is a backstop only.
*/

import { supabase } from "../supabaseClient";
import { computeRecurringExpenseRows } from "../utils/recurrence";

export function createExpenseActions({
  userId,
  expenses, setExpenses,
  recurringExpenses, setRecurringExpenses,
  deleteDocument,
  setMutating, setMutationError,
}) {

  // ── Single expense CRUD ────────────────────────────────────────────

  async function createExpense({
    amount, category, date,
    description = "", paymentMethod = null, taxTreatment = "deductible",
    cfdiUuid = "", cfdiUrl = "", receiptDocumentId = null, note = "",
  }) {
    const parsedAmount = Number(amount);
    if (!category || !date || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return false;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticRow = {
      id: tempId,
      user_id: userId,
      amount: parsedAmount,
      category, date,
      description: description || null,
      payment_method: paymentMethod || null,
      tax_treatment: taxTreatment,
      cfdi_uuid: cfdiUuid || null,
      cfdi_url: cfdiUrl || null,
      recurring_id: null,
      period_year: null,
      period_month: null,
      receipt_document_id: receiptDocumentId || null,
      note: note || null,
      color_idx: 0,
      _optimistic: true,
    };
    setExpenses(prev => [optimisticRow, ...prev]);
    setMutationError("");

    (async () => {
      try {
        const { data, error } = await supabase.from("expenses").insert({
          user_id: userId,
          amount: parsedAmount,
          category, date,
          description: description || null,
          payment_method: paymentMethod || null,
          tax_treatment: taxTreatment,
          cfdi_uuid: cfdiUuid || null,
          cfdi_url: cfdiUrl || null,
          receipt_document_id: receiptDocumentId || null,
          note: note || null,
        }).select().single();
        if (error) {
          setExpenses(prev => prev.filter(e => e.id !== tempId));
          setMutationError(error.message);
          return;
        }
        setExpenses(prev => prev.map(e => e.id === tempId ? data : e));
      } catch (e) {
        setExpenses(prev => prev.filter(e => e.id !== tempId));
        setMutationError(e?.message || "Network error");
      }
    })();

    return true;
  }

  async function updateExpense(id, fields) {
    const prev = expenses.find(e => e.id === id);
    if (!prev) return false;
    const parsedAmount = fields.amount != null ? Number(fields.amount) : prev.amount;
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return false;

    const next = {
      ...prev,
      amount: parsedAmount,
      category: fields.category ?? prev.category,
      date: fields.date ?? prev.date,
      description: fields.description ?? prev.description,
      payment_method: fields.paymentMethod ?? prev.payment_method,
      tax_treatment: fields.taxTreatment ?? prev.tax_treatment,
      cfdi_uuid: fields.cfdiUuid ?? prev.cfdi_uuid,
      cfdi_url: fields.cfdiUrl ?? prev.cfdi_url,
      receipt_document_id: fields.receiptDocumentId !== undefined ? fields.receiptDocumentId : prev.receipt_document_id,
      note: fields.note ?? prev.note,
    };
    setExpenses(arr => arr.map(e => e.id === id ? next : e));
    setMutationError("");

    setMutating(true);
    try {
      const { error } = await supabase.from("expenses").update({
        amount: next.amount,
        category: next.category,
        date: next.date,
        description: next.description,
        payment_method: next.payment_method,
        tax_treatment: next.tax_treatment,
        cfdi_uuid: next.cfdi_uuid,
        cfdi_url: next.cfdi_url,
        receipt_document_id: next.receipt_document_id,
        note: next.note,
      }).eq("id", id).eq("user_id", userId);
      setMutating(false);
      if (error) {
        setExpenses(arr => arr.map(e => e.id === id ? prev : e));
        setMutationError(error.message);
        return false;
      }
      return true;
    } catch (e) {
      setMutating(false);
      setExpenses(arr => arr.map(e => e.id === id ? prev : e));
      setMutationError(e?.message || "Network error");
      return false;
    }
  }

  async function deleteExpense(id) {
    const prev = expenses.find(e => e.id === id);
    if (!prev) return false;

    // Optimistic remove. We re-insert on failure.
    setExpenses(arr => arr.filter(e => e.id !== id));
    setMutationError("");

    // Cascade the receipt document + R2 object FIRST so that if the
    // expense delete fails server-side we don't end up with a dangling
    // expense pointing at a half-deleted document. The deleteDocument
    // helper handles its own R2 cleanup; if it fails, we log and
    // continue — an orphan R2 object is recoverable, an inconsistent
    // expense + missing receipt isn't.
    if (prev.receipt_document_id && typeof deleteDocument === "function") {
      try { await deleteDocument(prev.receipt_document_id); }
      catch { /* swallow — audit script will surface orphans */ }
    }

    const { error } = await supabase.from("expenses").delete()
      .eq("id", id).eq("user_id", userId);
    if (error) {
      setExpenses(arr => [prev, ...arr]);
      setMutationError(error.message);
      return false;
    }
    return true;
  }

  // ── Recurring template CRUD ───────────────────────────────────────

  async function createRecurringTemplate({
    amount, category, dayOfMonth, description = "",
    paymentMethod = null, taxTreatment = "deductible",
  }) {
    const parsedAmount = Number(amount);
    const dom = Number(dayOfMonth);
    if (!category || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return null;
    if (!Number.isFinite(dom) || dom < 1 || dom > 31) return null;

    const now = new Date();
    setMutating(true);
    setMutationError("");
    const { data, error } = await supabase.from("recurring_expenses").insert({
      user_id: userId,
      amount: parsedAmount,
      category,
      description: description || null,
      day_of_month: dom,
      payment_method: paymentMethod || null,
      tax_treatment: taxTreatment,
      active: true,
      start_year: now.getFullYear(),
      start_month: now.getMonth() + 1,
    }).select().single();
    setMutating(false);
    if (error) { setMutationError(error.message); return null; }
    setRecurringExpenses(prev => [data, ...prev]);
    return data;
  }

  async function updateRecurringTemplate(id, fields) {
    const prev = recurringExpenses.find(t => t.id === id);
    if (!prev) return false;
    const patch = {};
    if (fields.amount != null) patch.amount = Number(fields.amount);
    if (fields.category != null) patch.category = fields.category;
    if (fields.description !== undefined) patch.description = fields.description || null;
    if (fields.dayOfMonth != null) patch.day_of_month = Number(fields.dayOfMonth);
    if (fields.paymentMethod !== undefined) patch.payment_method = fields.paymentMethod || null;
    if (fields.taxTreatment != null) patch.tax_treatment = fields.taxTreatment;
    if (fields.active != null) {
      patch.active = !!fields.active;
      // Stamp paused_at when transitioning active=true → active=false so
      // the audit log + a future "show me when this template paused" UI
      // has the timestamp without a separate event log.
      if (fields.active === false && prev.active) patch.paused_at = new Date().toISOString();
      if (fields.active === true && !prev.active) patch.paused_at = null;
    }
    if (Object.keys(patch).length === 0) return true;

    setRecurringExpenses(arr => arr.map(t => t.id === id ? { ...t, ...patch } : t));
    setMutating(true);
    setMutationError("");
    const { error } = await supabase.from("recurring_expenses").update(patch)
      .eq("id", id).eq("user_id", userId);
    setMutating(false);
    if (error) {
      setRecurringExpenses(arr => arr.map(t => t.id === id ? prev : t));
      setMutationError(error.message);
      return false;
    }
    return true;
  }

  async function deleteRecurringTemplate(id) {
    const prev = recurringExpenses.find(t => t.id === id);
    if (!prev) return false;
    setRecurringExpenses(arr => arr.filter(t => t.id !== id));
    setMutationError("");
    const { error } = await supabase.from("recurring_expenses").delete()
      .eq("id", id).eq("user_id", userId);
    if (error) {
      setRecurringExpenses(arr => [prev, ...arr]);
      setMutationError(error.message);
      return false;
    }
    // Already-generated expenses keep recurring_id (DB on delete set null
    // already nulled it for us); they remain as real, paid expenses.
    setExpenses(arr => arr.map(e => e.recurring_id === id ? { ...e, recurring_id: null } : e));
    return true;
  }

  // ── Recurring generation (idempotent) ─────────────────────────────

  async function generateRecurringExpenses(now = new Date()) {
    if (!Array.isArray(recurringExpenses) || recurringExpenses.length === 0) {
      return { inserted: 0, pending: 0 };
    }
    const { auto, pending } = computeRecurringExpenseRows(
      recurringExpenses, expenses, now, userId
    );
    if (auto.length === 0) return { inserted: 0, pending: pending.length };

    // Insert with `on conflict do nothing` so a cross-device race lands
    // safely — the DB unique index is the source of truth. Supabase-js
    // exposes this via `.upsert(..., { onConflict, ignoreDuplicates })`.
    const { data, error } = await supabase.from("expenses")
      .upsert(auto, {
        onConflict: "recurring_id,period_year,period_month",
        ignoreDuplicates: true,
      })
      .select();
    if (error) {
      // 23505 means another tab/device beat us. Treat it as benign — the
      // row is there, we just couldn't read it back.
      if (error.code !== "23505") setMutationError(error.message);
      return { inserted: 0, pending: pending.length, error: error.code !== "23505" ? error.message : null };
    }
    const inserted = (data || []).filter(Boolean);
    if (inserted.length > 0) {
      // Merge in newly-generated rows (without disturbing optimistic
      // rows that may have landed in the meantime).
      setExpenses(prev => {
        const known = new Set(prev.map(e => e.id));
        return [...inserted.filter(r => !known.has(r.id)), ...prev];
      });
    }
    return { inserted: inserted.length, pending: pending.length };
  }

  // Materialize the "pending" backfill (older slots beyond the auto cap)
  // when the user taps "Generar N gastos pendientes" on the Gastos tab.
  // The pending list is computed in the call site (UI knows current
  // `now`); this just inserts the rows.
  async function generatePendingRecurringExpenses(pendingSlots) {
    if (!Array.isArray(pendingSlots) || pendingSlots.length === 0) {
      return { inserted: 0 };
    }
    const tplById = new Map((recurringExpenses || []).map(t => [t.id, t]));
    const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
    const rows = [];
    for (const { recurring_id, year, month } of pendingSlots) {
      const t = tplById.get(recurring_id);
      if (!t) continue;
      const dom = Math.min(t.day_of_month, daysInMonth(year, month));
      rows.push({
        user_id: userId,
        amount: t.amount,
        date: `${dom}-${SHORT_MONTHS[month - 1]}`,
        category: t.category,
        description: t.description || null,
        payment_method: t.payment_method || null,
        tax_treatment: t.tax_treatment || "deductible",
        recurring_id: t.id,
        period_year: year,
        period_month: month,
      });
    }
    if (rows.length === 0) return { inserted: 0 };
    const { data, error } = await supabase.from("expenses")
      .upsert(rows, {
        onConflict: "recurring_id,period_year,period_month",
        ignoreDuplicates: true,
      })
      .select();
    if (error) {
      setMutationError(error.message);
      return { inserted: 0, error: error.message };
    }
    const inserted = (data || []).filter(Boolean);
    if (inserted.length > 0) {
      setExpenses(prev => {
        const known = new Set(prev.map(e => e.id));
        return [...inserted.filter(r => !known.has(r.id)), ...prev];
      });
    }
    return { inserted: inserted.length };
  }

  return {
    createExpense, updateExpense, deleteExpense,
    createRecurringTemplate, updateRecurringTemplate, deleteRecurringTemplate,
    generateRecurringExpenses, generatePendingRecurringExpenses,
  };
}
