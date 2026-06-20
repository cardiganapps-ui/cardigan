import { useState, useMemo, useEffect, useRef } from "react";
import { IconPlus, IconRepeat, IconPaperclip } from "../../components/Icons";
import { shortDateToISO, todayISO } from "../../utils/dates";
import { formatMXN } from "../../utils/format";
import { useCardigan } from "../../context/CardiganContext";
import { SegmentedControl } from "../../components/SegmentedControl";
import { SwipeableRow } from "../../components/SwipeableRow";
import { AnimatedNumber } from "../../components/AnimatedNumber";
import { EmptyState } from "../../components/EmptyState";
import { DocumentViewer } from "../../components/DocumentViewer";
import { useT } from "../../i18n/index";
import { EXPENSE_CATEGORIES, TAX_TREATMENT } from "../../data/constants";
import { computeRecurringExpenseRows, RECURRING_EXPENSE_AUTO_BACKFILL_MONTHS } from "../../utils/recurrence";
import { getDateFrom } from "./financesShared";

// ── Gastos / Expenses ─────────────────────────────────────────────────
//
// Mirror of PagosTab but for the money-out side. No grouping by patient
// (expenses are pure overhead) and no per-patient filter — instead the
// secondary axis is category. Visual semantics: amounts render in
// `--charcoal` with a `−` prefix and a downward chevron, never in red.
// Red is reserved for unpaid/destructive — using it here would make
// "high expenses" read as "alarm" indiscriminately. An amber "Recibo
// pendiente" pill on deductible rows without a receipt is the only
// status color in this tab and uses --amber per its "needs attention"
// convention.

const EXPENSE_INITIAL_WINDOW = 60;
const EXPENSE_WINDOW_INCREMENT = 40;

export function GastosTab({
  expenses, recurringExpenses, onRecord, onEdit, onDelete,
  generatePending, onManageRecurring, mutating,
}) {
  const { t } = useT();
  // Documents + presign helper come from context — receipt rows in
  // this list need a document lookup-by-id to get the file_path
  // before we can mint a presigned URL for the viewer.
  const { documents = [], getDocumentUrl } = useCardigan();
  const [period, setPeriod] = useState("1m");
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [visibleCount, setVisibleCount] = useState(EXPENSE_INITIAL_WINDOW);
  const [viewingReceipt, setViewingReceipt] = useState(null);
  const sentinelRef = useRef(null);

  // Tap a receipt indicator on a row → presign GET URL → open lightbox.
  // Mirrors PatientExpediente's openDocViewer pattern verbatim.
  const openReceipt = async (expense) => {
    if (!expense?.receipt_document_id) return;
    const doc = documents.find(d => d.id === expense.receipt_document_id);
    if (!doc?.file_path) return;
    const url = await getDocumentUrl(doc.file_path);
    if (!url) return;
    setViewingReceipt({ doc, url });
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setVisibleCount(EXPENSE_INITIAL_WINDOW); }, [period, categoryFilter, pendingOnly, expenses.length]);

  // Count of deductible-without-receipt rows across ALL expenses (not
  // period-filtered) — drives the "Recibo pendiente" toggle's badge so
  // a therapist can see at a glance how much cleanup is left before
  // the contador deadline.
  const totalReceiptsPending = useMemo(() => (
    (expenses || []).filter(
      e => e.tax_treatment === TAX_TREATMENT.DEDUCTIBLE && !e.receipt_document_id
    ).length
  ), [expenses]);

  const { filtered, totalFiltered, totalThisMonth, totalYTD } = useMemo(() => {
    const dateFrom = getDateFrom(period);
    const today = todayISO();
    let list = [...(expenses || [])];
    if (dateFrom) list = list.filter(e => {
      const iso = shortDateToISO(e.date);
      return iso >= dateFrom && iso <= today;
    });
    // Re-derive the effective filter inside the memo so the deps stay
    // primitive (categoryFilter + expenses) and the lint passes.
    const presentCats = new Set((expenses || []).map(e => e.category));
    const eff = (categoryFilter && presentCats.has(categoryFilter)) ? categoryFilter : null;
    if (eff) list = list.filter(e => e.category === eff);
    if (pendingOnly) {
      list = list.filter(e => e.tax_treatment === TAX_TREATMENT.DEDUCTIBLE && !e.receipt_document_id);
    }
    list.sort((a, b) => shortDateToISO(b.date).localeCompare(shortDateToISO(a.date)));
    const total = list.reduce((s, e) => s + e.amount, 0);

    // KPI sums computed from full expense set (not the filtered view).
    const now = new Date();
    const ymThisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    const ymYearStart = `${now.getFullYear()}-01-01`;
    let monthSum = 0, yearSum = 0;
    for (const e of (expenses || [])) {
      if (e.tax_treatment === TAX_TREATMENT.PERSONAL) continue;
      const iso = shortDateToISO(e.date);
      if (iso?.startsWith(ymThisMonth)) monthSum += e.amount;
      if (iso >= ymYearStart) yearSum += e.amount;
    }
    return { filtered: list, totalFiltered: total, totalThisMonth: monthSum, totalYTD: yearSum };
  }, [expenses, period, categoryFilter, pendingOnly]);

  // Compute pending recurring backfill slots for the prompt at the top.
  const pendingCount = useMemo(() => {
    if (!recurringExpenses || recurringExpenses.length === 0) return 0;
    const { pending } = computeRecurringExpenseRows(recurringExpenses, expenses, new Date(), null);
    return pending.length;
  }, [recurringExpenses, expenses]);

  // Show chips ONLY for categories the user has actually used. The full
  // 11-category list is enum-noise on a fresh account; once they've
  // entered a few expenses the relevant 2-4 chips surface organically.
  // Identity is the full expense set (not period-filtered) — chips
  // shouldn't pop in and out as the user changes the date window.
  const visibleCategories = useMemo(() => {
    const present = new Set((expenses || []).map(e => e.category));
    return EXPENSE_CATEGORIES.filter(c => present.has(c));
  }, [expenses]);

  // If the user had a category filter set and then deleted the last
  // expense in that category, fall back to "all" without touching the
  // stored filter — that way if they re-add an expense in the same
  // category the chip + their selection both come back. Done as a
  // derived value rather than a useEffect+setState (project lint rule).
  const effectiveCategoryFilter = (categoryFilter && visibleCategories.includes(categoryFilter))
    ? categoryFilter
    : null;

  // IntersectionObserver lazy-load sentinel. Same pattern as PagosTab.
  useEffect(() => {
    if (visibleCount >= filtered.length) return;
    const node = sentinelRef.current;
    if (!node) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        setVisibleCount(c => Math.min(c + EXPENSE_WINDOW_INCREMENT, filtered.length));
      }
    }, { rootMargin: "240px" });
    obs.observe(node);
    return () => obs.disconnect();
  }, [filtered.length, visibleCount]);

  const visibleRows = filtered.slice(0, visibleCount);

  const handleGeneratePending = async () => {
    const { pending } = computeRecurringExpenseRows(recurringExpenses, expenses, new Date(), null);
    if (pending.length === 0) return;
    await generatePending(pending);
  };

  return (
    <div style={{ padding: "0 16px 24px" }}>
      {/* KPI band */}
      <div className="fin-stats-grid">
        <div className="stat-tile">
          <div className="stat-tile-label">{t("gastos.thisMonth")}</div>
          <div className="stat-tile-val" style={{ color: "var(--charcoal)", fontVariantNumeric: "tabular-nums" }}>
            −<AnimatedNumber value={totalThisMonth} format={formatMXN} />
          </div>
          <div className="stat-tile-sub">{t("gastos.expensesKpi")}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-label">{t("gastos.thisYear")}</div>
          <div className="stat-tile-val" style={{ color: "var(--charcoal)", fontVariantNumeric: "tabular-nums" }}>
            −<AnimatedNumber value={totalYTD} format={formatMXN} />
          </div>
          <div className="stat-tile-sub">{t("gastos.expensesKpi")}</div>
        </div>
      </div>

      {/* Pending recurring backfill prompt. Per CLAUDE.md prime
          directive: anything beyond the auto-cap (RECURRING_EXPENSE_AUTO_BACKFILL_MONTHS)
          requires explicit user confirmation. */}
      {pendingCount > 0 && (
        <div style={{
          marginTop: 14, padding: "12px 14px",
          background: "var(--cream)",
          border: "1px solid var(--border-lt)",
          borderRadius: "var(--radius)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 13, color: "var(--charcoal)" }}>
              {t("gastos.backfillTitle")}
            </div>
            <div style={{ fontSize: 12, color: "var(--charcoal-md)", marginTop: 2 }}>
              {t("gastos.backfillBody", { count: pendingCount, plural: pendingCount === 1 ? "" : "s" })}
            </div>
          </div>
          <button type="button" className="btn btn-primary-teal btn-tap" onClick={handleGeneratePending}
            disabled={mutating} style={{ height: 36, fontSize: 12, padding: "0 14px" }}>
            {t("gastos.backfillCta", { count: pendingCount, plural: pendingCount === 1 ? "" : "s" })}
          </button>
        </div>
      )}

      {/* Period filter + recurring-templates link + record CTA */}
      <div style={{ marginTop: 14, marginBottom: 10 }}>
        <SegmentedControl
          value={period}
          onChange={setPeriod}
          items={[
            { k: "1m", l: "1M" },
            { k: "3m", l: "3M" },
            { k: "6m", l: "6M" },
            { k: "1y", l: "1A" },
            { k: "all", l: t("finances.periodAll") },
          ]}
        />
      </div>

      {/* "Recibo pendiente" toggle — surfaces only when the user has
          deductible-without-receipt rows somewhere. Single-tap pre-tax-
          season cleanup affordance: tap → list filters to just the
          stragglers, swipe through them, attach receipts, done. */}
      {totalReceiptsPending > 0 && (
        <button
          type="button"
          className="btn-tap"
          onClick={() => setPendingOnly((p) => !p)}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            width: "100%",
            background: pendingOnly ? "var(--amber-bg)" : "var(--white)",
            border: `1px solid ${pendingOnly ? "var(--amber)" : "var(--border-lt)"}`,
            borderRadius: "var(--radius)",
            padding: "10px 14px",
            cursor: "pointer",
            marginBottom: 10,
            color: "var(--charcoal)",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <IconPaperclip size={14} style={{ color: "var(--amber)" }} />
          <span style={{ flex: 1, textAlign: "left" }}>
            {t("gastos.receiptPending")} · {totalReceiptsPending}
          </span>
          <span style={{ fontSize: 11, color: pendingOnly ? "var(--amber)" : "var(--charcoal-md)", fontWeight: 700 }}>
            {pendingOnly ? t("gastos.pendingFilterOn") : t("gastos.pendingFilterOff")}
          </span>
        </button>
      )}

      {/* Category chip row — only categories the user has actually
          recorded show up, in canonical order. We don't render the row
          at all until there are at least 2 distinct categories worth
          choosing between (a "Todo" + single-category pair is just
          noise). The full 11-category enum is the universe of choices,
          but the chip set is the *user's* subset of it. */}
      {visibleCategories.length >= 2 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          <button type="button"
            className="btn-tap"
            onClick={() => setCategoryFilter(null)}
            style={{
              border: "1px solid var(--border-lt)",
              background: effectiveCategoryFilter == null ? "var(--teal-pale)" : "var(--white)",
              color: effectiveCategoryFilter == null ? "var(--teal-dark)" : "var(--charcoal-md)",
              borderRadius: "var(--radius-pill)",
              padding: "4px 12px", fontSize: 11, fontWeight: 700,
              cursor: "pointer",
            }}>
            {t("finances.periodAll")}
          </button>
          {visibleCategories.map(c => (
            <button key={c} type="button"
              className="btn-tap"
              onClick={() => setCategoryFilter(effectiveCategoryFilter === c ? null : c)}
              style={{
                border: "1px solid var(--border-lt)",
                background: effectiveCategoryFilter === c ? "var(--teal-pale)" : "var(--white)",
                color: effectiveCategoryFilter === c ? "var(--teal-dark)" : "var(--charcoal-md)",
                borderRadius: "var(--radius-pill)",
                padding: "4px 12px", fontSize: 11, fontWeight: 700,
                cursor: "pointer",
              }}>
              {t(`gastos.cat.${c}`)}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button type="button" className="btn btn-primary btn-tap"
          onClick={onRecord} style={{ flex: 1, height: 40, fontSize: 13 }}>
          + {t("gastos.record")}
        </button>
        <button type="button" className="btn btn-secondary btn-tap"
          onClick={onManageRecurring}
          aria-label={t("gastos.recurringTitle")}
          style={{ width: 40, padding: 0 }}>
          <IconRepeat size={14} />
        </button>
      </div>

      {/* Filtered total banner */}
      {filtered.length > 0 && (
        <div style={{
          fontSize: 12, color: "var(--charcoal-xl)", marginBottom: 10,
          fontVariantNumeric: "tabular-nums",
        }}>
          {filtered.length} · −{formatMXN(totalFiltered)}
        </div>
      )}

      {/* List — uses the canonical EmptyState illustration for visual
          consistency with the rest of the app's empty surfaces. */}
      {filtered.length === 0 && (
        <EmptyState
          kind="finances"
          title={t("gastos.none")}
          body={t("gastos.emptyBody")}
        />
      )}

      {visibleRows.map((e, i) => {
        const isExpanded = confirmDeleteId === e.id;
        const isReceiptPending = e.tax_treatment === TAX_TREATMENT.DEDUCTIBLE && !e.receipt_document_id;
        return (
          // Stagger wrapper mirrors PagosTab so Gastos reveals top-down too.
          <div key={e.id} className="list-entry-stagger" style={{ "--stagger-i": Math.min(i, 12) }}>
          <SwipeableRow
            onAction={() => setConfirmDeleteId(isExpanded ? null : e.id)}
            actionLabel={t("delete")}
            actionTone="danger"
            exitOnAction={false}
          >
            <div className="bal-row" role="button" tabIndex={0}
              onClick={() => onEdit(e)}
              onKeyDown={(ev) => { if (ev.key === "Enter") onEdit(e); }}
              style={{ cursor: "pointer", background: "var(--white)" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="bal-name" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {t(`gastos.cat.${e.category}`) || e.category}
                </div>
                <div className="bal-sub">
                  {e.date}
                  {e.description ? ` · ${e.description}` : ""}
                  {e.payment_method ? ` · ${e.payment_method}` : ""}
                  {e.recurring_id ? <> · <IconRepeat size={10} /></> : null}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <div style={{
                  fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 14,
                  color: "var(--charcoal)", fontVariantNumeric: "tabular-nums",
                  display: "inline-flex", alignItems: "center", gap: 4,
                }}>
                  −{formatMXN(e.amount)}
                  {e.receipt_document_id && (
                    <button
                      type="button"
                      onClick={(ev) => { ev.stopPropagation(); openReceipt(e); }}
                      aria-label={t("gastos.receiptAttached")}
                      className="btn-tap"
                      style={{
                        background: "var(--cream)",
                        border: "1px solid var(--border-lt)",
                        borderRadius: "var(--radius-pill)",
                        padding: "3px 7px",
                        cursor: "pointer",
                        color: "var(--charcoal-md)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                      }}
                    >
                      <IconPaperclip size={11} />
                    </button>
                  )}
                </div>
                {isReceiptPending && (
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    color: "var(--amber)", background: "var(--amber-bg)",
                    padding: "2px 6px", borderRadius: "var(--radius-pill)",
                    letterSpacing: "0.04em",
                  }}>
                    {t("gastos.receiptPending")}
                  </span>
                )}
              </div>
            </div>
            {isExpanded && (
              <div style={{
                padding: "12px 16px", display: "flex", gap: 8, alignItems: "center",
                background: "var(--cream)", borderTop: "1px solid var(--border-lt)",
              }}>
                <span style={{ flex: 1, fontSize: 12, color: "var(--charcoal-md)" }}>
                  {t("gastos.deleteConfirm")}
                </span>
                <button type="button" className="btn btn-ghost btn-tap"
                  onClick={() => setConfirmDeleteId(null)}
                  style={{ height: 32, fontSize: 12, padding: "0 12px" }}>
                  {t("cancel")}
                </button>
                <button type="button" className="btn btn-danger btn-tap"
                  onClick={async () => {
                    const ok = await onDelete(e.id);
                    if (ok) setConfirmDeleteId(null);
                  }}
                  disabled={mutating}
                  style={{ height: 32, fontSize: 12, padding: "0 12px" }}>
                  {t("delete")}
                </button>
              </div>
            )}
          </SwipeableRow>
          </div>
        );
      })}

      {visibleCount < filtered.length && (
        <div ref={sentinelRef} style={{ height: 1, marginTop: 4 }} aria-hidden="true" />
      )}

      {viewingReceipt && (
        <DocumentViewer
          doc={viewingReceipt.doc}
          url={viewingReceipt.url}
          onClose={() => setViewingReceipt(null)}
        />
      )}
    </div>
  );
}
