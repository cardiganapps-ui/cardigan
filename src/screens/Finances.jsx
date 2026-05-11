import { useState, useMemo, useEffect, useRef } from "react";
import { getClientColor } from "../data/seedData";
import { IconCheck, IconTrendingUp, IconTrendingDown, IconUsers, IconPlus, IconDollar, IconRepeat, IconPaperclip, IconArrowDown, IconDownload, IconChevron } from "../components/Icons";
import { Toggle } from "../components/Toggle";
import { shortDateToISO, todayISO } from "../utils/dates";
import { formatMXN } from "../utils/format";
import { useCardigan } from "../context/CardiganContext";
import { SegmentedControl } from "../components/SegmentedControl";
import { Avatar } from "../components/Avatar";
import { SwipeableRow } from "../components/SwipeableRow";
import { EmptyState } from "../components/EmptyState";
import { DocumentViewer } from "../components/DocumentViewer";
import { useT } from "../i18n/index";
import { isPotentialOrDiscarded, SESSION_TYPE, EXPENSE_CATEGORIES, TAX_TREATMENT } from "../data/constants";
import { computeRecurringExpenseRows, RECURRING_EXPENSE_AUTO_BACKFILL_MONTHS } from "../utils/recurrence";
import { buildExpensesCsv, downloadExpensesCsv } from "../utils/expensesExport";

const FINANCES_INITIAL_WINDOW = 60;
const FINANCES_WINDOW_INCREMENT = 40;

function PagosTab({ payments, patients, onRecordPayment, onEditPayment, onDeletePayment, mutating, onAddFirstPatient }) {
  const { t } = useT();
  const [expandedId, setExpandedId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [groupByClient, setGroupByClient] = useState(false);
  // Patient-name keyed: which grouped row is expanded to show its
  // individual payments. Independent of `expandedId` (which controls
  // the per-payment edit/delete actions reveal) so the two expansion
  // levels nest cleanly.
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [period, setPeriod] = useState("all");
  // Lazy-load window. Rendering every payment row up-front was the
  // single worst scroll-jank source on iOS Safari — a therapist with
  // 1000+ payments paid ~500ms layout cost on tab open. With the
  // window, first paint renders 60 rows; an IntersectionObserver
  // sentinel pulls 40 more as the user scrolls toward the end.
  const [visibleCount, setVisibleCount] = useState(FINANCES_INITIAL_WINDOW);
  const sentinelRef = useRef(null);

  // Compute date-from based on period selection
  const getDateFrom = (p) => {
    if (p === "all") return null;
    const d = new Date();
    if (p === "1w") {
      d.setDate(d.getDate() - 7);
    } else {
      const months = { "1m": 1, "3m": 3, "6m": 6, "1y": 12 };
      d.setMonth(d.getMonth() - (months[p] || 0));
    }
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  };

  // Reset the visible window on filter change. The deps intentionally
  // don't include the full `filtered` array (changes on every render
  // due to identity); `period` + `groupByClient` capture the real
  // user-initiated reasons to re-anchor. Synchronous setState in the
  // effect is deliberate — the new window needs to be in place in the
  // same commit or the user sees a flash of the old row count.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleCount(FINANCES_INITIAL_WINDOW);
    // Collapse any open grouped-patient row when the filter set
    // changes — the previously-expanded patient may no longer match,
    // and re-anchoring scroll alongside a stale expansion looks broken.
    setExpandedGroup(null);
  }, [period, groupByClient, payments.length]);

  const { filtered, totalFiltered, grouped } = useMemo(() => {
    const dateFrom = getDateFrom(period);
    const today = todayISO();
    let list = [...payments];
    if (dateFrom) list = list.filter(p => {
      const iso = shortDateToISO(p.date);
      return iso >= dateFrom && iso <= today;
    });
    list.sort((a, b) => shortDateToISO(b.date).localeCompare(shortDateToISO(a.date)));
    const total = list.reduce((s, p) => s + p.amount, 0);
    const byPatient = {};
    for (const p of list) {
      if (!byPatient[p.patient]) byPatient[p.patient] = [];
      byPatient[p.patient].push(p);
    }
    return { filtered: list, totalFiltered: total, grouped: byPatient };
  }, [payments, period]);

  // Hook the sentinel to grow the window as the user scrolls. The
  // observer is (re)created whenever the filtered count changes so a
  // new sentinel (after the list shrinks below the previous window)
  // gets picked up. rootMargin preloads before the sentinel enters the
  // viewport — a therapist scrolling fast shouldn't feel the stall.
  useEffect(() => {
    if (visibleCount >= filtered.length) return;
    if (typeof IntersectionObserver === "undefined") return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) {
        setVisibleCount(n => Math.min(n + FINANCES_WINDOW_INCREMENT, filtered.length));
      }
    }, { rootMargin: "240px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleCount, filtered.length]);

  const renderRow = (p, i) => {
    const patient = patients.find(pt => pt.name === p.patient);
    const isExpanded = expandedId === p.id;
    const rowBody = (
      <div className="bal-row" role="button" tabIndex={0} onClick={() => setExpandedId(isExpanded ? null : p.id)} style={{ cursor:"pointer", background:"var(--white)" }}>
        <Avatar initials={patient ? patient.initials : p.patient.slice(0,2).toUpperCase()}
          color={getClientColor(p.colorIdx ?? i)} size="sm" />
        <div style={{ flex:1, minWidth:0 }}>
          {!groupByClient && <div className="bal-name">{p.patient}</div>}
          <div className="bal-sub" style={{ display:"flex", alignItems:"center", gap:6, marginTop: groupByClient ? 0 : 2 }}>
            <span>{p.date}</span>
            <span style={{ width:3, height:3, borderRadius:"50%", background:"var(--charcoal-xl)", display:"inline-block" }} />
            <span>{p.method}</span>
          </div>
        </div>
        <div className="bal-amt amount-paid">+{formatMXN(p.amount)}</div>
      </div>
    );
    return (
      <div
        key={p.id}
        className="list-entry-stagger"
        style={{ "--stagger-i": Math.min(i, 12) }}
      >
        <SwipeableRow
          onAction={async () => { if (!mutating) await onDeletePayment(p.id); }}
          actionLabel={t("delete")}
          actionTone="danger">
          {rowBody}
        </SwipeableRow>
        {isExpanded && (
          <div style={{ padding:"8px 12px 12px", borderBottom:"1px solid var(--border-lt)" }}>
            {confirmDeleteId === p.id ? (
              <div style={{ background:"var(--red-bg)", borderRadius:"var(--radius)", padding:"10px 12px" }}>
                <div style={{ fontSize:"var(--text-md)", fontWeight:700, color:"var(--red)", marginBottom:4 }}>
                  {t("finances.deleteConfirm")}
                </div>
                <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-md)", lineHeight:1.4, marginBottom:10 }}>
                  {t("finances.deleteWarning")}
                </div>
                <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
                  <button className="btn btn-secondary" style={{ height:36, padding:"0 14px", fontSize:"var(--text-sm)", width:"auto", minHeight:0 }}
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}>
                    {t("cancel")}
                  </button>
                  <button className="btn btn-danger" style={{ height:36, padding:"0 14px", fontSize:"var(--text-sm)", width:"auto", minHeight:0 }}
                    disabled={mutating}
                    onClick={async (e) => {
                      e.stopPropagation();
                      await onDeletePayment(p.id);
                      setConfirmDeleteId(null);
                      setExpandedId(null);
                    }}>
                    {mutating ? t("patients.deleting") : t("delete")}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
                <button className="btn btn-secondary" style={{ height:36, padding:"0 14px", fontSize:"var(--text-sm)", width:"auto", minHeight:0, background:"var(--teal-pale)", color:"var(--teal-dark)", borderColor:"var(--teal-pale)" }}
                  onClick={(e) => { e.stopPropagation(); setExpandedId(null); onEditPayment(p); }}>
                  {t("edit")}
                </button>
                <button className="btn btn-danger" style={{ height:36, padding:"0 14px", fontSize:"var(--text-sm)", width:"auto", minHeight:0 }}
                  disabled={mutating} onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(p.id); }}>
                  {t("finances.deletePayment")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding:"0 16px" }}>
      <div style={{ marginBottom:14 }}>
        <button className="btn btn-primary" style={{ width:"100%" }} onClick={() => onRecordPayment(null)} disabled={mutating}>
          {mutating ? t("saving") : t("finances.registerPayment")}
        </button>
      </div>

      <div style={{ marginBottom:12 }}>
        <SegmentedControl
          value={period}
          onChange={setPeriod}
          ariaLabel={t("periods.all")}
          style={{ marginBottom: 8 }}
          items={[
            { k: "all", l: t("periods.all") },
            { k: "1w",  l: t("periods.1w") },
            { k: "1m",  l: t("periods.1m") },
            { k: "3m",  l: t("periods.3m") },
          ]}
        />
        <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-start", gap:8 }}>
          <Toggle on={groupByClient} onToggle={() => setGroupByClient(g => !g)} />
          <span style={{ fontSize:"var(--text-xs)", fontWeight:600, color:"var(--charcoal-md)" }}>{t("finances.groupByClient")}</span>
        </div>
      </div>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <span style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)", fontWeight:600 }}>
          {groupByClient
            ? t("finances.patientCount", { count: Object.keys(grouped).length })
            : t("finances.paymentCount", { count: filtered.length })}
        </span>
        <span style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:800, color:"var(--green)" }}>+{formatMXN(totalFiltered)}</span>
      </div>

      {filtered.length === 0
        ? (() => {
            // Two sources of "no payments visible": the user has
            // never recorded a payment yet (first-time state — show
            // the CTA), or there's a filter applied that just doesn't
            // match anything (subsequent state — no CTA, the user
            // adjusts the filter). For brand-new users with zero
            // patients, the CTA points at patient creation instead.
            const noPatients = (patients || []).length === 0;
            const hasAnyPayments = (payments || []).length > 0;
            const action = !hasAnyPayments && !noPatients ? (
              <button
                type="button"
                onClick={() => onRecordPayment(null)}
                className="btn btn-primary"
                style={{ display:"inline-flex", alignItems:"center", gap:8, width:"auto", padding:"10px 22px", height:"auto", minHeight:0 }}>
                <IconPlus size={16} /> {t("finances.recordFirst")}
              </button>
            ) : noPatients ? (
              <button
                type="button"
                onClick={onAddFirstPatient}
                className="btn btn-primary"
                style={{ display:"inline-flex", alignItems:"center", gap:8, width:"auto", padding:"10px 22px", height:"auto", minHeight:0 }}>
                <IconPlus size={16} /> {t("patients.addFirstCta")}
              </button>
            ) : null;
            return (
              <div className="card" style={{ padding: 0 }}>
                <EmptyState
                  kind="finances"
                  compact={hasAnyPayments}
                  title={hasAnyPayments ? t("finances.noPaymentsInPeriod") : t("finances.noPayments")}
                  body={t("finances.emptyBody")}
                  cta={action}
                />
              </div>
            );
          })()
        : groupByClient
          ? <div className="card">
              {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([name, pList], gi) => {
                const total = pList.reduce((s,p)=>s+p.amount,0);
                const first = pList[0];
                const patient = patients.find(pt => pt.name === name);
                const isOpen = expandedGroup === name;
                return (
                  <div key={name}>
                    <div
                      className="bal-row"
                      role="button"
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onClick={() => setExpandedGroup(isOpen ? null : name)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          setExpandedGroup(isOpen ? null : name);
                        }
                      }}
                      style={{ cursor: "pointer", background: "var(--white)" }}
                    >
                      <Avatar initials={patient ? patient.initials : name.slice(0,2).toUpperCase()}
                        color={getClientColor(first?.colorIdx ?? gi)} size="sm" />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div className="bal-name">{name}</div>
                        <div className="bal-sub">{t("finances.paymentCount", { count: pList.length })}</div>
                      </div>
                      <div className="bal-amt amount-paid" style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
                        +{formatMXN(total)}
                        <span aria-hidden="true" style={{
                          display:"inline-flex",
                          color:"var(--charcoal-xl)",
                          transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                          transition: "transform var(--dur-fast) var(--ease-spring)",
                        }}>
                          <IconChevron size={14} />
                        </span>
                      </div>
                    </div>
                    {isOpen && (
                      // Nested chronological list — already filtered
                      // by the active period (via `grouped`) and sorted
                      // newest-first by the outer memo, matching the
                      // ungrouped view's reading order. Cream wrapper
                      // gives a subtle visual indent so the nested rows
                      // read as "belonging to" the patient above them.
                      <div style={{ background:"var(--cream)", borderTop:"1px solid var(--border-lt)" }}>
                        {pList.map((p, i) => renderRow(p, i))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          : (
            <div className="card">
              {filtered.slice(0, visibleCount).map((p, i) => renderRow(p, i))}
              {visibleCount < filtered.length && (
                // Sentinel + subtle hint so the blank band below the
                // last visible row doesn't read as "no more rows".
                <div ref={sentinelRef} style={{
                  padding: "14px 16px",
                  textAlign: "center",
                  fontSize: "var(--text-xs)",
                  color: "var(--charcoal-xl)",
                }}>
                  …
                </div>
              )}
            </div>
          )
      }

    </div>
  );
}

const PERIOD_DAYS = { "1w": 7, "1m": 30, "3m": 90 };

function ProyeccionTab({ sessions, patients }) {
  const { t } = useT();
  const [period, setPeriod] = useState("1m");
  const [customCancel, setCustomCancel] = useState(null); // null = use historical

  const today = todayISO();

  // Compute the cutoff date for the selected period (fixed day counts)
  const cutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + (PERIOD_DAYS[period] || 30));
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }, [period]);

  // Patients whose sessions count toward the active-revenue forecast.
  // Potentials and discarded leads are excluded — projecting "what will
  // I earn next month" must not bake in interview revenue from leads
  // who haven't converted yet (and whose interview sessions, even
  // future ones, are one-off rose-rail rows we deliberately styled
  // separately).
  const projectablePatientIds = useMemo(() => {
    const ids = new Set();
    for (const p of patients) if (!isPotentialOrDiscarded(p)) ids.add(p.id);
    return ids;
  }, [patients]);

  // Scheduled sessions within the projection period (today through cutoff)
  const futureSessions = useMemo(() =>
    sessions.filter(s => {
      if (s.status !== "scheduled") return false;
      // Interview sessions are one-offs by design and don't represent
      // recurring revenue; even on a converted patient they stay at
      // their original tariff and shouldn't contribute to the next
      // period's forecast. Excluding them upstream also keeps
      // activeContributing honest.
      if (s.session_type === SESSION_TYPE.INTERVIEW) return false;
      // Don't project sessions belonging to potentials/discarded — see
      // projectablePatientIds above.
      if (s.patient_id && !projectablePatientIds.has(s.patient_id)) return false;
      const iso = shortDateToISO(s.date);
      return iso >= today && iso <= cutoff;
    }),
    [sessions, today, cutoff, projectablePatientIds]
  );

  // Historical cancellation rate (cancelled without charge / total resolved)
  const { histRate, totalResolved, totalCancelled } = useMemo(() => {
    let resolved = 0, cancelled = 0;
    for (const s of sessions) {
      const iso = shortDateToISO(s.date);
      if (iso >= today) continue; // only past sessions
      if (s.status === "completed" || s.status === "charged") resolved++;
      else if (s.status === "cancelled") { resolved++; cancelled++; }
    }
    return {
      histRate: resolved > 0 ? cancelled / resolved : 0,
      totalResolved: resolved,
      totalCancelled: cancelled,
    };
  }, [sessions, today]);

  // Resolve the effective rate for a session: use session.rate if set,
  // otherwise fall back to the patient's current rate (handles legacy
  // sessions created before rate was tracked per-session).
  const patientMap = useMemo(() => {
    const m = new Map();
    for (const p of patients) m.set(p.id, p);
    return m;
  }, [patients]);
  const sessionRate = (s) => {
    if (s.rate != null && s.rate > 0) return s.rate;
    const p = patientMap.get(s.patient_id);
    return p ? p.rate : 0;
  };

  const cancelRate = customCancel !== null ? customCancel / 100 : histRate;

  // Gross and net
  const gross = futureSessions.reduce((sum, s) => sum + sessionRate(s), 0);
  const net = Math.round(gross * (1 - cancelRate));

  // Weeks in period for weekly average (matches fixed day counts: 7, 30, 90)
  const weeksInPeriod = (PERIOD_DAYS[period] || 30) / 7;
  const perWeek = weeksInPeriod > 0 ? Math.round(net / weeksInPeriod) : 0;

  // Average session rate
  const avgRate = futureSessions.length > 0
    ? Math.round(gross / futureSessions.length)
    : 0;

  // Breakdown by patient (plain computation — trivial cost, always fresh)
  const byPatientMap = {};
  for (const s of futureSessions) {
    const rate = sessionRate(s);
    if (!byPatientMap[s.patient]) byPatientMap[s.patient] = { count: 0, total: 0, colorIdx: s.colorIdx ?? s.color_idx, initials: s.initials };
    byPatientMap[s.patient].count++;
    byPatientMap[s.patient].total += rate;
  }
  const byPatient = Object.entries(byPatientMap)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.total - a.total);

  // Active patients contributing
  const activeContributing = new Set(futureSessions.map(s => s.patient_id)).size;

  const histPct = Math.round(histRate * 100);
  const displayPct = customCancel !== null ? customCancel : histPct;

  return (
    <div style={{ padding:"0 16px" }}>
      <div style={{ marginBottom:14 }}>
        <SegmentedControl
          value={period}
          onChange={setPeriod}
          items={[
            { k: "1w", l: t("periods.1w") },
            { k: "1m", l: t("periods.1m") },
            { k: "3m", l: t("periods.3m") },
          ]}
        />
      </div>

      {/* Main projection cards */}
      <div className="fin-stats-grid" style={{ padding:0, marginBottom:16 }}>
        <div className="stat-tile">
          <div className="stat-tile-label">{t("finances.forecastGross")}</div>
          <div className="stat-tile-val">{formatMXN(gross)}</div>
          <div className="stat-tile-sub">{t("finances.forecastScheduled", { count: futureSessions.length, plural: futureSessions.length !== 1 ? "es" : "" })}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-label">{t("finances.forecastNet")}</div>
          <div className="stat-tile-val" style={{ color:"var(--green)" }}>{formatMXN(net)}</div>
          <div className="stat-tile-sub">-{Math.round(cancelRate * 100)}% {t("finances.forecastCancelRateLower")}</div>
        </div>
      </div>

      <div className="fin-stats-grid" style={{ padding:0, marginBottom:16 }}>
        <div className="stat-tile">
          <div className="stat-tile-label">{t("finances.forecastPerWeek")}</div>
          <div className="stat-tile-val">{formatMXN(perWeek)}</div>
          <div className="stat-tile-sub">{t("finances.forecastActivePatients", { count: activeContributing, plural: activeContributing !== 1 ? "s" : "" })}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-label">{t("finances.forecastAvgSession")}</div>
          <div className="stat-tile-val">{formatMXN(avgRate)}</div>
          <div className="stat-tile-sub">{t("expediente.perSession")}</div>
        </div>
      </div>

      {/* Cancellation rate adjustment */}
      <div className="card" style={{ padding:"16px 18px", marginBottom:16 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
          <span style={{ fontSize:"var(--text-sm)", fontWeight:700, color:"var(--charcoal)" }}>{t("finances.forecastAssumption")}</span>
          <span style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:800, color:"var(--charcoal)" }}>{displayPct}%</span>
        </div>
        <input
          type="range"
          min={0} max={50} step={1}
          value={displayPct}
          onChange={e => setCustomCancel(Number(e.target.value))}
          style={{ width:"100%", accentColor:"var(--teal)", marginBottom:8 }}
        />
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:"var(--text-xs)", color:"var(--charcoal-xl)" }}>
            {t("finances.forecastHistorical")}: <strong>{histPct}%</strong>
            <span style={{ fontWeight:400 }}> ({totalCancelled}/{totalResolved})</span>
          </span>
          {customCancel !== null && customCancel !== histPct && (
            <button
              className="btn btn-ghost"
              style={{ fontSize:"var(--text-xs)", padding:"2px 10px", height:"auto", minHeight:0 }}
              onClick={() => setCustomCancel(null)}
            >
              {t("finances.useHistorical")}
            </button>
          )}
        </div>
      </div>

      {/* Breakdown by patient */}
      {byPatient.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <div className="section-title" style={{ marginBottom:10 }}>{t("finances.forecastByPatient")}</div>
          <div className="card">
            {byPatient.map((p, i) => {
              const patObj = patients.find(pt => pt.name === p.name);
              const initials = patObj ? patObj.initials : p.initials?.replace("T·", "") || p.name.slice(0,2).toUpperCase();
              return (
                <div className="bal-row" key={p.name}>
                  <Avatar initials={initials} color={getClientColor(p.colorIdx ?? i)} size="sm" />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div className="bal-name">{p.name}</div>
                    <div className="bal-sub">{t("finances.sessionCount", { count: p.count, plural: p.count !== 1 ? "es" : "" })}</div>
                  </div>
                  <div className="bal-amt" style={{ color:"var(--charcoal)", fontWeight:700 }}>{formatMXN(p.total)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {futureSessions.length === 0 && (
        <div className="card" style={{ padding:32, textAlign:"center" }}>
          <div style={{ marginBottom:10, color:"var(--teal-light)" }}><IconTrendingUp size={32} /></div>
          <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)" }}>{t("finances.forecastNoSessions")}</div>
        </div>
      )}
    </div>
  );
}

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

function GastosTab({
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

  const getDateFrom = (p) => {
    if (p === "all") return null;
    const d = new Date();
    if (p === "1w") d.setDate(d.getDate() - 7);
    else {
      const months = { "1m": 1, "3m": 3, "6m": 6, "1y": 12 };
      d.setMonth(d.getMonth() - (months[p] || 0));
    }
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
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
            −{formatMXN(totalThisMonth)}
          </div>
          <div className="stat-tile-sub">{t("gastos.expensesKpi")}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-label">{t("gastos.thisYear")}</div>
          <div className="stat-tile-val" style={{ color: "var(--charcoal)", fontVariantNumeric: "tabular-nums" }}>
            −{formatMXN(totalYTD)}
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

      {/* List */}
      {filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon"><IconArrowDown size={20} /></div>
          <div className="empty-state-title">{t("gastos.none")}</div>
          <div className="empty-state-body">{t("gastos.emptyBody")}</div>
        </div>
      )}

      {visibleRows.map(e => {
        const isExpanded = confirmDeleteId === e.id;
        const isReceiptPending = e.tax_treatment === TAX_TREATMENT.DEDUCTIBLE && !e.receipt_document_id;
        return (
          <SwipeableRow
            key={e.id}
            onDelete={() => setConfirmDeleteId(isExpanded ? null : e.id)}
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

// ── Resumen / P&L ─────────────────────────────────────────────────────
//
// Backward-looking profit-and-loss. KPIs (income · expenses · profit)
// + a simple horizontal-bar category breakdown + a CSV export for the
// contador. Personal-treatment expenses are excluded from "Egresos"
// per the docstring on TAX_TREATMENT — keeping a personal Uber off
// the business P&L while still letting the user keep one ledger.

function ResumenTab({ payments, expenses }) {
  const { t } = useT();
  const [period, setPeriod] = useState("thisMonth");

  const { from, to } = useMemo(() => {
    const now = new Date();
    if (period === "thisMonth") {
      const f = new Date(now.getFullYear(), now.getMonth(), 1);
      const tt = now;
      return { from: toIsoLocal(f), to: toIsoLocal(tt) };
    }
    if (period === "lastMonth") {
      const f = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const tt = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: toIsoLocal(f), to: toIsoLocal(tt) };
    }
    // thisYear
    return { from: `${now.getFullYear()}-01-01`, to: toIsoLocal(now) };
  }, [period]);

  const inRange = (shortDate) => {
    const iso = shortDateToISO(shortDate);
    return iso >= from && iso <= to;
  };

  const { income, egresos, profit, byCategory } = useMemo(() => {
    let inc = 0;
    for (const p of (payments || [])) if (inRange(p.date)) inc += p.amount;
    let exp = 0;
    const cat = {};
    for (const e of (expenses || [])) {
      if (e.tax_treatment === TAX_TREATMENT.PERSONAL) continue;
      if (!inRange(e.date)) continue;
      exp += e.amount;
      cat[e.category] = (cat[e.category] || 0) + e.amount;
    }
    const sortedCat = Object.entries(cat).sort((a, b) => b[1] - a[1]);
    return { income: inc, egresos: exp, profit: inc - exp, byCategory: sortedCat };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, expenses, from, to]);

  const handleExport = () => {
    const year = new Date().getFullYear();
    const csv = buildExpensesCsv(expenses || [], (k) => t(`gastos.cat.${k}`) || k);
    downloadExpensesCsv(csv, t("gastos.exportFilename", { year }));
  };

  return (
    <div style={{ padding: "0 16px 24px" }}>
      <div style={{ marginBottom: 14 }}>
        <SegmentedControl
          value={period}
          onChange={setPeriod}
          items={[
            { k: "thisMonth", l: t("gastos.thisMonth") },
            { k: "lastMonth", l: t("gastos.lastMonth") },
            { k: "thisYear",  l: t("gastos.thisYear") },
          ]}
        />
      </div>

      {/* KPI band — three tiles. Profit color mirrors the sign:
          positive profit is teal-dark (the "Cardigan good news" hue),
          negative profit is amber (a real signal but not destructive). */}
      <div style={{
        display: "grid", gap: 10,
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        marginBottom: 14,
      }}>
        <div className="stat-tile">
          <div className="stat-tile-label">
            <IconTrendingUp size={12} style={{ marginRight: 4, verticalAlign: "-2px" }} />
            {t("gastos.incomeKpi")}
          </div>
          <div className="stat-tile-val" style={{ color: "var(--green)", fontVariantNumeric: "tabular-nums" }}>
            +{formatMXN(income)}
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-label">
            <IconTrendingDown size={12} style={{ marginRight: 4, verticalAlign: "-2px" }} />
            {t("gastos.expensesKpi")}
          </div>
          <div className="stat-tile-val" style={{ color: "var(--charcoal)", fontVariantNumeric: "tabular-nums" }}>
            −{formatMXN(egresos)}
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-label">{profit >= 0 ? t("gastos.profitKpi") : t("gastos.profitNegative")}</div>
          <div className="stat-tile-val" style={{
            color: profit >= 0 ? "var(--teal-dark)" : "var(--amber)",
            fontVariantNumeric: "tabular-nums",
          }}>
            {profit >= 0 ? "+" : "−"}{formatMXN(Math.abs(profit))}
          </div>
        </div>
      </div>

      {/* Category breakdown — horizontal-bar chart from a div per row.
          Inline because the chart is dirt-simple (sorted % of total)
          and pulling in a chart lib would be overkill. */}
      {byCategory.length > 0 && (
        <div className="card" style={{ padding: "16px 16px", marginBottom: 14 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.07em", color: "var(--charcoal-xl)", marginBottom: 10,
          }}>
            {t("gastos.byCategory")}
          </div>
          {byCategory.map(([cat, amt]) => {
            const pct = egresos > 0 ? Math.round((amt / egresos) * 100) : 0;
            return (
              <div key={cat} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: "var(--charcoal)", fontWeight: 600 }}>
                    {t(`gastos.cat.${cat}`) || cat}
                  </span>
                  <span style={{ color: "var(--charcoal-md)", fontVariantNumeric: "tabular-nums" }}>
                    −{formatMXN(amt)} · {pct}%
                  </span>
                </div>
                <div style={{
                  height: 6, width: "100%",
                  background: "var(--cream)",
                  borderRadius: "var(--radius-pill)", overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%", width: `${pct}%`,
                    background: "var(--teal)",
                    transition: "width 300ms var(--ease-out)",
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button type="button" className="btn btn-secondary btn-tap"
        onClick={handleExport}
        disabled={(expenses || []).length === 0}
        style={{ width: "100%", height: 44, gap: 8 }}>
        <IconDownload size={14} />
        <span>{t("gastos.exportContador")}</span>
      </button>
    </div>
  );
}

function toIsoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export function Finances() {
  // `deletePayment` is already wrapped at the context level to surface
  // a success toast, so we use it directly here.
  const {
    patients, payments, upcomingSessions,
    openRecordPaymentModal, openEditPaymentModal, deletePayment,
    expenses, recurringExpenses,
    openRecordExpenseModal, openEditExpenseModal, openRecurringExpenseSheet,
    deleteExpense, generatePendingRecurringExpenses,
    mutating, openExpediente, requestFabAction, readOnly,
  } = useCardigan();
  const { t } = useT();
  const [tab, setTab] = useState("balances");
  const [balanceFilter, setBalanceFilter] = useState(null); // null | "owing" | "paid"
  // Balances and the Por-cobrar / Al-corriente lists belong to the
  // active-patient lane only. Potentials with a past-1h scheduled
  // interview auto-complete and otherwise inflate "Outstanding" before
  // the practitioner has decided to convert them. Surfacing them in
  // the Potenciales view is the right place; here they're noise.
  const regularPatients = useMemo(
    () => patients.filter(p => !isPotentialOrDiscarded(p)),
    [patients]
  );
  const totalOwed     = regularPatients.reduce((s,p) => s+p.amountDue, 0);
  const owingPatients = regularPatients.filter(p => p.amountDue>0);
  const noPatients    = regularPatients.length === 0;

  return (
    <div className="page" data-tour="finances-section">
      <div style={{ padding:"16px 16px 16px" }}>
        <SegmentedControl
          dataTour="finances-tabs"
          value={tab}
          onChange={setTab}
          items={[
            { k: "balances", l: t("finances.balances") },
            { k: "pagos",    l: t("finances.payments") },
            { k: "gastos",   l: t("finances.expenses") },
            { k: "resumen",  l: t("finances.summary") },
            // Shorter "Proy." instead of "Proyección" so the 5-tab row
            // fits on iPhone SE (360px) without ellipsis — the long
            // label was the only one busting the budget.
            { k: "proyeccion", l: t("finances.forecastShort") },
          ]}
        />
      </div>

      {tab==="balances" && (
        <div>
          <div className="fin-stats-grid">
            <button type="button"
              onClick={() => setBalanceFilter(balanceFilter === "owing" ? null : "owing")}
              className={`stat-tile stat-tile-clickable ${balanceFilter === "owing" ? "stat-tile-selected" : ""}`}>
              <div className="stat-tile-label">{t("finances.outstanding")}</div>
              <div className="stat-tile-val" style={{ color:"var(--red)" }}>{formatMXN(totalOwed)}</div>
              <div className="stat-tile-sub">{t("finances.patientCount", { count: owingPatients.length })}</div>
            </button>
            <button type="button"
              onClick={() => setBalanceFilter(balanceFilter === "paid" ? null : "paid")}
              className={`stat-tile stat-tile-clickable ${balanceFilter === "paid" ? "stat-tile-selected" : ""}`}>
              <div className="stat-tile-label">{t("patients.upToDate")}</div>
              <div className="stat-tile-val" style={{ color:"var(--green)" }}>{regularPatients.filter(p=>p.amountDue<=0).length}</div>
              <div className="stat-tile-sub">{t("finances.patientsLabel")}</div>
            </button>
          </div>
          {noPatients && (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", padding:"32px 24px" }}>
              <div style={{ width:56, height:56, background:"var(--teal-pale)", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:16, color:"var(--teal)" }}>
                <IconUsers size={26} />
              </div>
              <div style={{ fontFamily:"var(--font-d)", fontSize:17, fontWeight:800, color:"var(--charcoal)", marginBottom:6 }}>{t("patients.noPatients")}</div>
              <div style={{ fontSize:13, color:"var(--charcoal-xl)", lineHeight:1.5, marginBottom:18 }}>{t("patients.addFirst")}</div>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => requestFabAction?.("patient")}
                  className="btn btn-primary"
                  style={{ display:"inline-flex", alignItems:"center", gap:8, width:"auto", padding:"10px 22px", height:"auto", minHeight:0 }}>
                  <IconPlus size={16} /> {t("patients.addFirstCta")}
                </button>
              )}
            </div>
          )}
          {!noPatients && (
          <div className="finances-balances-cols">
          {balanceFilter !== "paid" && (
            <div className="finances-balances-col" style={{ padding:"0 16px 8px" }}>
              <div className="section-title" style={{ marginBottom:10 }}>{t("finances.patientBalance")}</div>
              <div className="card">
                {regularPatients.filter(p=>p.amountDue>0).sort((a,b)=>b.amountDue-a.amountDue).map((p,i) => (
                  <div className="bal-row" key={p.id} style={{ gap:8 }}>
                    <div
                      role="button" tabIndex={0}
                      onClick={() => openExpediente(p)}
                      style={{ display:"flex", alignItems:"center", gap:12, flex:1, minWidth:0, cursor:"pointer" }}>
                      <Avatar initials={p.initials} color={getClientColor(i)} size="sm" />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div className="bal-name">{p.name}</div>
                      </div>
                      <div className="bal-amt amount-owe">{formatMXN(p.amountDue)}</div>
                    </div>
                    <button type="button"
                      aria-label={t("finances.recordPayment")}
                      onClick={(e) => { e.stopPropagation(); openRecordPaymentModal(p); }}
                      style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:36, height:36, minWidth:36, minHeight:36, borderRadius:"50%", background:"var(--teal-pale)", color:"var(--teal-dark)", border:"none", cursor:"pointer", flexShrink:0, WebkitTapHighlightColor:"transparent", padding:0 }}>
                      <IconDollar size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {balanceFilter !== "owing" && (
            <div className="finances-balances-col" style={{ padding: balanceFilter === "paid" ? "0 16px 8px" : "16px 16px 0" }}>
              <div className="section-title" style={{ marginBottom:10 }}>{t("patients.upToDate")}</div>
              <div className="card">
                {regularPatients.filter(p=>p.amountDue<=0).map((p,i) => (
                  <div className="bal-row" key={p.id} role="button" tabIndex={0}
                    onClick={() => openExpediente(p)}
                    style={{ cursor:"pointer" }}>
                    <Avatar initials={p.initials} color={getClientColor(i + 4)} size="sm" />
                    <div style={{ flex:1 }}>
                      <div className="bal-name">{p.name}</div>
                      <div className="bal-sub">{formatMXN(p.paid)} {t("finances.paidAmount")}</div>
                    </div>
                    {p.credit > 0 ? (
                      // Prepaid patients still live in the "Al
                      // corriente" bucket but get a green pill showing
                      // how much they've paid ahead — otherwise there's
                      // no visible distinction from someone who paid
                      // exactly what they owed.
                      <span className="badge badge-green" style={{ fontSize: 11, fontWeight: 700 }}>
                        +{formatMXN(p.credit)} {t("finances.creditShort")}
                      </span>
                    ) : (
                      <div className="bal-amt amount-paid"><IconCheck size={16} /></div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          </div>
          )}
        </div>
      )}

      {tab==="pagos" && <PagosTab payments={payments} patients={patients} onRecordPayment={openRecordPaymentModal} onEditPayment={openEditPaymentModal} onDeletePayment={deletePayment} mutating={mutating} onAddFirstPatient={() => requestFabAction?.("patient")} />}

      {tab==="gastos" && (
        <GastosTab
          expenses={expenses || []}
          recurringExpenses={recurringExpenses || []}
          onRecord={openRecordExpenseModal}
          onEdit={openEditExpenseModal}
          onDelete={deleteExpense}
          generatePending={generatePendingRecurringExpenses}
          onManageRecurring={openRecurringExpenseSheet}
          mutating={mutating}
        />
      )}

      {tab==="resumen" && (
        <ResumenTab payments={payments || []} expenses={expenses || []} />
      )}

      {tab==="proyeccion" && <ProyeccionTab sessions={upcomingSessions} patients={patients} />}

    </div>
  );
}
