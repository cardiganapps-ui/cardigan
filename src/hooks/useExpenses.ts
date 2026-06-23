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

import type { Dispatch, SetStateAction } from "react";
import { supabase } from "../supabaseClient";
import type { TablesInsert, TablesUpdate } from "../types/db";
import { computeRecurringExpenseRows } from "../utils/recurrence";
import { shortDateToISO } from "../utils/dates";
import { enqueue, registerHandler, onReplay } from "../lib/mutationQueue";

// ── Domain row types ────────────────────────────────────────────────
interface Expense {
  id: string;
  user_id?: string;
  amount: number;
  category?: string;
  date?: string;
  description?: string | null;
  payment_method?: string | null;
  tax_treatment?: string;
  cfdi_uuid?: string | null;
  cfdi_url?: string | null;
  recurring_id?: string | null;
  period_year?: number | null;
  period_month?: number | null;
  receipt_document_id?: string | null;
  note?: string | null;
  color_idx?: number | null;
  _optimistic?: boolean;
  [key: string]: unknown;
}

interface RecurringTemplate {
  id: string;
  user_id?: string;
  amount: number;
  category?: string;
  description?: string | null;
  day_of_month: number;
  payment_method?: string | null;
  tax_treatment?: string;
  active?: boolean;
  start_year?: number;
  start_month?: number;
  paused_at?: string | null;
  [key: string]: unknown;
}

interface PendingSlot { recurring_id: string; year: number; month: number }

type Num = number | string | null | undefined;

interface ExpenseFields {
  amount?: Num;
  category?: string;
  date?: string;
  description?: string | null;
  paymentMethod?: string | null;
  taxTreatment?: string;
  cfdiUuid?: string | null;
  cfdiUrl?: string | null;
  receiptDocumentId?: string | null;
  note?: string | null;
}

interface TemplateFields {
  amount?: Num;
  category?: string;
  description?: string | null;
  dayOfMonth?: Num;
  paymentMethod?: string | null;
  taxTreatment?: string;
  active?: boolean;
}

type SetExpenses = Dispatch<SetStateAction<Expense[]>>;
type SetRecurring = Dispatch<SetStateAction<RecurringTemplate[]>>;
type SetFlag = Dispatch<SetStateAction<boolean>>;
type SetError = Dispatch<SetStateAction<string>>;

interface ExpenseActionsArgs {
  userId: string;
  expenses: Expense[];
  setExpenses: SetExpenses;
  recurringExpenses: RecurringTemplate[];
  setRecurringExpenses: SetRecurring;
  deleteDocument?: (id: string) => Promise<unknown>;
  setMutating: SetFlag;
  setMutationError: SetError;
}

// Offline queue handlers (Phase 4 of offline support — covers
// createExpense, updateExpense, deleteExpense). Recurring-template
// CRUD is admin-rare so stays online-only for now.
registerHandler("expenses.insert", async ({ row }: { row: Record<string, unknown> }) => {
  return await supabase.from("expenses").insert(row as TablesInsert<"expenses">).select().single();
});
registerHandler("expenses.update", async ({ id, userId, patch }: { id: string; userId: string; patch: Record<string, unknown> }) => {
  return await supabase.from("expenses").update(patch as TablesUpdate<"expenses">).eq("id", id).eq("user_id", userId);
});
registerHandler("expenses.delete", async ({ id, userId }: { id: string; userId: string }) => {
  return await supabase.from("expenses").delete().eq("id", id).eq("user_id", userId);
});

// Module-level setExpenses ref so the once-registered onReplay
// listener swaps temp ids in the live state holder (same pattern as
// usePayments / useSessions / useNotes).
let _setExpensesRef: SetExpenses | null = null;
onReplay((entry: { op: string; optimisticMeta?: { tempId?: string } }, result: { error?: unknown; data?: Record<string, unknown> } | null) => {
  if (entry.op !== "expenses.insert") return;
  if (!result || result.error || !result.data) return;
  const data = result.data;
  const tempId = entry.optimisticMeta?.tempId;
  if (!tempId || !_setExpensesRef) return;
  _setExpensesRef(prev => prev.map(e => e.id === tempId ? (data as Expense) : e));
});

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function createExpenseActions({
  userId,
  expenses, setExpenses,
  recurringExpenses, setRecurringExpenses,
  deleteDocument,
  setMutating, setMutationError,
}: ExpenseActionsArgs) {
  // Refresh the module-level ref so the once-registered onReplay
  // listener writes into the live state holder.
  _setExpensesRef = setExpenses;

  // ── Single expense CRUD ────────────────────────────────────────────

  // recurringId + periodYear + periodMonth are optional and used by
  // the "Make this expense recurring" flow in ExpenseSheet: we
  // create the template first, then call createExpense with the new
  // template's id + the (year, month) of the user-picked date so the
  // expense claims the (template, year, month) slot. Without that
  // link, the next app-load auto-extension would generate a SECOND
  // expense for the same month — double billing. The DB partial
  // unique index on (recurring_id, period_year, period_month) is the
  // ultimate safety net.
  async function createExpense({
    amount, category, date,
    description = "", paymentMethod = null, taxTreatment = "deductible",
    cfdiUuid = "", cfdiUrl = "", receiptDocumentId = null, note = "",
    recurringId = null, periodYear = null, periodMonth = null,
  }: {
    amount?: Num;
    category?: string;
    date?: string;
    description?: string | null;
    paymentMethod?: string | null;
    taxTreatment?: string;
    cfdiUuid?: string | null;
    cfdiUrl?: string | null;
    receiptDocumentId?: string | null;
    note?: string | null;
    recurringId?: string | null;
    periodYear?: number | null;
    periodMonth?: number | null;
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
      recurring_id: recurringId,
      period_year: periodYear,
      period_month: periodMonth,
      receipt_document_id: receiptDocumentId || null,
      note: note || null,
      color_idx: 0,
      _optimistic: true,
    };
    setExpenses(prev => [optimisticRow, ...prev]);
    setMutationError("");

    const row = {
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
      recurring_id: recurringId,
      period_year: periodYear,
      period_month: periodMonth,
    };

    if (isOffline()) {
      await enqueue("expenses.insert", { row }, { tempId });
      return true;
    }

    (async () => {
      try {
        const { data, error } = await supabase.from("expenses").insert(row).select().single();
        if (error) {
          setExpenses(prev => prev.filter(e => e.id !== tempId));
          setMutationError(error.message);
          return;
        }
        setExpenses(prev => prev.map(e => e.id === tempId ? data : e));
      } catch {
        // Transport failure mid-flight — queue with the temp row for
        // the replay listener to reconcile on drain.
        await enqueue("expenses.insert", { row }, { tempId });
      }
    })();

    return true;
  }

  async function updateExpense(id: string, fields: ExpenseFields) {
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
    // If this is a recurring-linked row and the date moves to a
    // different (year, month), re-derive period_year/period_month
    // so the row claims the new month's slot. Without this, a user
    // who edits the date of an auto-generated June row to "5-Jul"
    // leaves June claimed but July free — auto-extension on next
    // app load generates a second July row, double-billing the
    // therapist. Date is canonical; period derives from it.
    if (prev.recurring_id && next.date !== prev.date) {
      const newIso = shortDateToISO(next.date);
      if (newIso) {
        const [y, m] = newIso.split("-").map(Number);
        if (y && m) { next.period_year = y; next.period_month = m; }
      }
    }
    setExpenses(arr => arr.map(e => e.id === id ? next : e));
    setMutationError("");

    const updatePayload: Record<string, unknown> = {
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
    };
    // Push the recalc through to the DB too. Only when recurring,
    // and only when the period actually changed — avoids needless
    // writes for the common in-month edit case.
    if (prev.recurring_id && (next.period_year !== prev.period_year || next.period_month !== prev.period_month)) {
      updatePayload.period_year = next.period_year;
      updatePayload.period_month = next.period_month;
    }

    // Temp-id row: insert hasn't drained yet; defer.
    if (typeof id === "string" && id.startsWith("temp-")) return true;
    if (isOffline()) {
      await enqueue("expenses.update", { id, userId, patch: updatePayload });
      return true;
    }

    setMutating(true);
    try {
      const { error } = await supabase.from("expenses").update(updatePayload as TablesUpdate<"expenses">)
        .eq("id", id).eq("user_id", userId);
      setMutating(false);
      if (error) {
        setExpenses(arr => arr.map(e => e.id === id ? prev : e));
        setMutationError(error.message);
        return false;
      }
      return true;
    } catch {
      // Transport failure — queue and keep optimistic state.
      setMutating(false);
      await enqueue("expenses.update", { id, userId, patch: updatePayload });
      return true;
    }
  }

  async function deleteExpense(id: string) {
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
    //
    // Note: receipt cleanup runs ONLINE only — R2 operations can't be
    // queued without further infrastructure (presigned URL TTL +
    // binary payload). Offline-deleted expenses with receipts will
    // leave an R2 orphan that the audit surfaces. Acceptable tradeoff
    // for an edge case (offline + receipt + delete).
    if (prev.receipt_document_id && typeof deleteDocument === "function" && !isOffline()) {
      try { await deleteDocument(prev.receipt_document_id); }
      catch { /* swallow — audit script will surface orphans */ }
    }

    // Temp-id rows haven't drained; no real row to delete.
    if (typeof id === "string" && id.startsWith("temp-")) return true;
    if (isOffline()) {
      await enqueue("expenses.delete", { id, userId });
      return true;
    }

    let error;
    try {
      const res = await supabase.from("expenses").delete().eq("id", id).eq("user_id", userId);
      error = res.error;
    } catch {
      await enqueue("expenses.delete", { id, userId });
      return true;
    }
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
  }: {
    amount?: Num;
    category?: string;
    dayOfMonth?: Num;
    description?: string | null;
    paymentMethod?: string | null;
    taxTreatment?: string;
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

  async function updateRecurringTemplate(id: string, fields: TemplateFields) {
    const prev = recurringExpenses.find(t => t.id === id);
    if (!prev) return false;
    const patch: Record<string, unknown> = {};
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
      // Resume from "now" rather than from the original start month —
      // a therapist who paused for 6 months and reactivates today
      // expects October's expense to be the first one generated, not
      // a 6-month backlog of pending rent rows. Without this, every
      // reactivation surfaces the entire pause window as a "Generar
      // N gastos pendientes" prompt — almost always undesirable
      // (the therapist wasn't paying that expense during the pause).
      if (fields.active === true && !prev.active) {
        const now = new Date();
        patch.paused_at = null;
        patch.start_year = now.getFullYear();
        patch.start_month = now.getMonth() + 1;
      }
    }
    if (Object.keys(patch).length === 0) return true;

    setRecurringExpenses(arr => arr.map(t => t.id === id ? { ...t, ...patch } : t));
    setMutating(true);
    setMutationError("");
    const { error } = await supabase.from("recurring_expenses").update(patch as TablesUpdate<"recurring_expenses">)
      .eq("id", id).eq("user_id", userId);
    setMutating(false);
    if (error) {
      setRecurringExpenses(arr => arr.map(t => t.id === id ? prev : t));
      setMutationError(error.message);
      return false;
    }
    return true;
  }

  async function deleteRecurringTemplate(id: string) {
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

  async function generateRecurringExpenses(now: Date = new Date()) {
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
      .upsert(auto as TablesInsert<"expenses">[], {
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
  async function generatePendingRecurringExpenses(pendingSlots: PendingSlot[]) {
    if (!Array.isArray(pendingSlots) || pendingSlots.length === 0) {
      return { inserted: 0 };
    }
    const tplById = new Map((recurringExpenses || []).map(t => [t.id, t] as [string, RecurringTemplate]));
    const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();
    const rows: Record<string, unknown>[] = [];
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
      .upsert(rows as TablesInsert<"expenses">[], {
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

  // Undo-aware expense delete. Mirrors softDeleteSession /
  // softDeletePayment. Note: the R2 receipt-document cascade in
  // deleteExpense runs at commit time, NOT at the optimistic
  // remove step — so an undone delete leaves the receipt intact.
  // If the commit fires (timer or visibility hidden) the receipt
  // is cleaned up just like a direct deleteExpense call.
  function softDeleteExpense(id: string) {
    const prev = expenses.find(e => e.id === id);
    if (!prev) return { commit: async () => true, undo: () => {} };

    setMutationError("");
    setExpenses(arr => arr.filter(e => e.id !== id));

    let done = false;
    return {
      async commit() {
        if (done) return true;
        done = true;
        const isOptimisticRow = typeof id === "string" && id.startsWith("temp-");
        if (isOptimisticRow) return true;
        // Cascade the receipt R2 object FIRST so we don't end up with
        // a dangling expense pointing at a half-deleted document. Same
        // guard as deleteExpense — only attempt online (R2 ops can't
        // be queued without further infrastructure).
        if (prev.receipt_document_id && typeof deleteDocument === "function" && !isOffline()) {
          try { await deleteDocument(prev.receipt_document_id); }
          catch { /* swallow — audit script surfaces orphans */ }
        }
        if (isOffline()) {
          await enqueue("expenses.delete", { id, userId });
          return true;
        }
        try {
          const res = await supabase.from("expenses").delete().eq("id", id).eq("user_id", userId);
          if (res.error) {
            setExpenses(arr => [prev, ...arr]);
            setMutationError(res.error.message);
            return false;
          }
        } catch {
          await enqueue("expenses.delete", { id, userId });
        }
        return true;
      },
      undo() {
        if (done) return;
        done = true;
        setExpenses(arr => [prev, ...arr]);
      },
    };
  }

  return {
    createExpense, updateExpense, deleteExpense, softDeleteExpense,
    createRecurringTemplate, updateRecurringTemplate, deleteRecurringTemplate,
    generateRecurringExpenses, generatePendingRecurringExpenses,
  };
}
