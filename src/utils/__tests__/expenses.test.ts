import { describe, it, expect } from "vitest";
import {
  computeRecurringExpenseRows,
  expectedSlotsForTemplate,
  daysInMonth,
  RECURRING_EXPENSE_AUTO_BACKFILL_MONTHS,
} from "../recurrence";

// These tests lock the recurring-expense generation invariants. The DB
// has the partial unique index uniq_expenses_recurring_period as the
// final word, but the helper is what decides which slots to attempt
// AND which to surface as a backfill prompt — getting that boundary
// wrong (auto-inserting a quarter of "Renta $18,000" rows the user
// already paid in cash) silently distorts the P&L. CLAUDE.md prime
// directive: never insert money rows the user didn't approve.

const TEMPLATE = {
  id: "tpl-1",
  active: true,
  amount: 18000,
  category: "consultorio",
  description: "Renta WeWork",
  day_of_month: 1,
  payment_method: "Transferencia",
  tax_treatment: "deductible",
  start_year: 2026,
  start_month: 1,
};

describe("daysInMonth", () => {
  it("returns 28 for non-leap February", () => {
    expect(daysInMonth(2025, 2)).toBe(28);
  });
  it("returns 29 for leap February", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2028, 2)).toBe(29);
  });
  it("returns 30 for short months", () => {
    [4, 6, 9, 11].forEach(m => expect(daysInMonth(2026, m)).toBe(30));
  });
  it("returns 31 for long months", () => {
    [1, 3, 5, 7, 8, 10, 12].forEach(m => expect(daysInMonth(2026, m)).toBe(31));
  });
});

describe("expectedSlotsForTemplate", () => {
  it("returns slots from start through current month inclusive", () => {
    const slots = expectedSlotsForTemplate(TEMPLATE, new Date("2026-05-15"));
    expect(slots).toEqual([
      { year: 2026, month: 1 }, { year: 2026, month: 2 },
      { year: 2026, month: 3 }, { year: 2026, month: 4 },
      { year: 2026, month: 5 },
    ]);
  });
  it("crosses year boundaries", () => {
    const t = { ...TEMPLATE, start_year: 2025, start_month: 11 };
    const slots = expectedSlotsForTemplate(t, new Date("2026-02-15"));
    expect(slots).toEqual([
      { year: 2025, month: 11 }, { year: 2025, month: 12 },
      { year: 2026, month: 1 }, { year: 2026, month: 2 },
    ]);
  });
  it("returns [] for inactive templates", () => {
    expect(expectedSlotsForTemplate({ ...TEMPLATE, active: false }, new Date("2026-05-15"))).toEqual([]);
  });
  it("returns just the start month if start === now", () => {
    const slots = expectedSlotsForTemplate(TEMPLATE, new Date("2026-01-10"));
    expect(slots).toEqual([{ year: 2026, month: 1 }]);
  });
});

describe("computeRecurringExpenseRows", () => {
  it("returns auto rows for the last N months and pending for older slots", () => {
    const now = new Date("2026-05-15");
    const { auto, pending } = computeRecurringExpenseRows([TEMPLATE], [], now, "user-1");
    // RECURRING_EXPENSE_AUTO_BACKFILL_MONTHS = 2 → auto includes (Mar, Apr, May).
    // Older slots (Jan, Feb) become pending.
    expect(auto.map(r => `${r.period_year}-${r.period_month}`)).toEqual(["2026-3", "2026-4", "2026-5"]);
    expect(pending.map(p => `${p.year}-${p.month}`)).toEqual(["2026-1", "2026-2"]);
    expect(RECURRING_EXPENSE_AUTO_BACKFILL_MONTHS).toBe(2);
  });

  it("idempotency — already-generated slots are skipped", () => {
    const existing = [
      { recurring_id: "tpl-1", period_year: 2026, period_month: 4 },
      { recurring_id: "tpl-1", period_year: 2026, period_month: 5 },
    ];
    const now = new Date("2026-05-15");
    const { auto } = computeRecurringExpenseRows([TEMPLATE], existing, now, "user-1");
    // March is the only auto slot left after filtering existing.
    expect(auto.map(r => `${r.period_year}-${r.period_month}`)).toEqual(["2026-3"]);
  });

  it("re-running with the same inputs as the previous generation yields zero auto rows", () => {
    const now = new Date("2026-05-15");
    const first = computeRecurringExpenseRows([TEMPLATE], [], now, "user-1");
    // Pretend the 'auto' rows persisted with the same shape they'd have
    // after an insert (recurring_id + period_year + period_month).
    const persisted = first.auto.map(r => ({
      recurring_id: r.recurring_id, period_year: r.period_year, period_month: r.period_month,
    }));
    const second = computeRecurringExpenseRows([TEMPLATE], persisted, now, "user-1");
    expect(second.auto).toEqual([]);
    // Pending stays the same — it doesn't auto-resolve, the user has to act.
    expect(second.pending).toEqual(first.pending);
  });

  it("REGRESSION: a manually-created expense linked to its template prevents auto-extension from double-billing", () => {
    // Reproduces the bug where toggling "Make recurring" in
    // ExpenseSheet inserted a manual expense with recurring_id=null
    // alongside a template, and the next app-load auto-extension
    // generated a SECOND expense for the same month. The fix links
    // the manual expense to (template, year, month) at creation
    // time so its slot is taken when computeRecurringExpenseRows
    // runs.
    const now = new Date("2026-05-15");
    // The template was created today and the user also created a
    // manual expense on 2026-05-15 linked to it.
    const userManual = {
      recurring_id: TEMPLATE.id,
      period_year: 2026,
      period_month: 5,
    };
    const { auto } = computeRecurringExpenseRows([TEMPLATE], [userManual], now, "user-1");
    // May should NOT be in auto — the user already has it.
    expect(auto.some(r => r.period_year === 2026 && r.period_month === 5)).toBe(false);
  });

  it("ANTI-REGRESSION: unlinked manual expense does NOT block auto-extension (proves the fix is in linkage, not date-equality)", () => {
    // Inverse of the regression test: if the fix accidentally
    // hand-rolled a date-equality check (e.g. "skip slot if any
    // expense exists on that month") instead of a recurring_id link
    // check, an unlinked expense (recurring_id=null) would
    // incorrectly suppress auto-extension. This test fails if the
    // fix took that wrong path.
    const now = new Date("2026-05-15");
    const unlinkedManual = {
      recurring_id: null,        // ← the bug condition
      period_year: null,
      period_month: null,
      date: "15-May",
    };
    const { auto } = computeRecurringExpenseRows([TEMPLATE], [unlinkedManual], now, "user-1");
    // May SHOULD still be in auto because the unlinked expense
    // doesn't claim the (template, 2026, 5) slot.
    expect(auto.some(r => r.period_year === 2026 && r.period_month === 5)).toBe(true);
  });

  it("clamps day-of-month 31 to last day of short months", () => {
    const t = { ...TEMPLATE, day_of_month: 31, start_year: 2026, start_month: 1 };
    const now = new Date("2026-05-15");
    const { auto } = computeRecurringExpenseRows([t], [], now, "user-1");
    // March 2026 = 31 (no clamp), April = 30 (clamped), May = 31 (no clamp).
    const byMonth = Object.fromEntries(auto.map(r => [r.period_month, r.date]));
    expect(byMonth[3]).toBe("31-Mar");
    expect(byMonth[4]).toBe("30-Abr");
    expect(byMonth[5]).toBe("31-May");
  });

  it("clamps day-of-month for February correctly (leap and non-leap)", () => {
    const tLeap = { ...TEMPLATE, day_of_month: 31, start_year: 2024, start_month: 2 };
    const { auto: aLeap } = computeRecurringExpenseRows(
      [tLeap], [], new Date("2024-02-15"), "user-1"
    );
    expect(aLeap[0].date).toBe("29-Feb");

    const tCommon = { ...TEMPLATE, day_of_month: 31, start_year: 2025, start_month: 2 };
    const { auto: aCommon } = computeRecurringExpenseRows(
      [tCommon], [], new Date("2025-02-15"), "user-1"
    );
    expect(aCommon[0].date).toBe("28-Feb");
  });

  it("paused templates produce no rows", () => {
    const t = { ...TEMPLATE, active: false };
    const { auto, pending } = computeRecurringExpenseRows([t], [], new Date("2026-05-15"), "user-1");
    expect(auto).toEqual([]);
    expect(pending).toEqual([]);
  });

  it("propagates template fields onto generated rows", () => {
    const now = new Date("2026-05-15");
    const { auto } = computeRecurringExpenseRows([TEMPLATE], [], now, "user-1");
    const sample = auto[0];
    expect(sample.user_id).toBe("user-1");
    expect(sample.amount).toBe(18000);
    expect(sample.category).toBe("consultorio");
    expect(sample.description).toBe("Renta WeWork");
    expect(sample.payment_method).toBe("Transferencia");
    expect(sample.tax_treatment).toBe("deductible");
    expect(sample.recurring_id).toBe("tpl-1");
  });

  it("multiple templates generate independent slot sets", () => {
    const t2 = {
      ...TEMPLATE, id: "tpl-2", category: "software", amount: 1200,
      description: "Cardigan + Zoom", day_of_month: 15,
    };
    const now = new Date("2026-05-20");
    const { auto } = computeRecurringExpenseRows([TEMPLATE, t2], [], now, "user-1");
    const byTpl: Record<string, number> = auto.reduce((acc: Record<string, number>, r) => {
      acc[r.recurring_id] = (acc[r.recurring_id] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    expect(byTpl["tpl-1"]).toBe(3);
    expect(byTpl["tpl-2"]).toBe(3);
  });

  it("returns empty when given no templates", () => {
    expect(computeRecurringExpenseRows([], [], new Date("2026-05-15"), "user-1"))
      .toEqual({ auto: [], pending: [] });
  });
});
