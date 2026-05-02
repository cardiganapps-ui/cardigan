import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { getClientColor } from "../data/seedData";
import { IconCheck, IconTrendingUp, IconUsers, IconPlus, IconDollar } from "../components/Icons";
import { Toggle } from "../components/Toggle";
import { shortDateToISO, todayISO } from "../utils/dates";
import { formatMXN } from "../utils/format";
import { useCardigan } from "../context/CardiganContext";
import { SegmentedControl } from "../components/SegmentedControl";
import { Avatar } from "../components/Avatar";
import { SwipeableRow } from "../components/SwipeableRow";
import { EmptyState } from "../components/EmptyState";
import { useT } from "../i18n/index";

const FINANCES_INITIAL_WINDOW = 60;
const FINANCES_WINDOW_INCREMENT = 40;

function PagosTab({ payments, patients, onRecordPayment, onEditPayment, onDeletePayment, mutating }) {
  const { t } = useT();
  const [expandedId, setExpandedId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [groupByClient, setGroupByClient] = useState(false);
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
        ? <div className="card" style={{ padding: 0 }}>
            <EmptyState
              kind="finances"
              compact
              title={t("finances.noPaymentsInPeriod")}
              body={t("finances.emptyBody")}
            />
          </div>
        : groupByClient
          ? <div className="card">
              {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([name, pList], gi) => {
                const total = pList.reduce((s,p)=>s+p.amount,0);
                const first = pList[0];
                const patient = patients.find(pt => pt.name === name);
                return (
                  <div className="bal-row" key={name}>
                    <Avatar initials={patient ? patient.initials : name.slice(0,2).toUpperCase()}
                      color={getClientColor(first?.colorIdx ?? gi)} size="sm" />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div className="bal-name">{name}</div>
                      <div className="bal-sub">{t("finances.paymentCount", { count: pList.length })}</div>
                    </div>
                    <div className="bal-amt amount-paid">+{formatMXN(total)}</div>
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

  // Scheduled sessions within the projection period (today through cutoff)
  const futureSessions = useMemo(() =>
    sessions.filter(s => {
      if (s.status !== "scheduled") return false;
      const iso = shortDateToISO(s.date);
      return iso >= today && iso <= cutoff;
    }),
    [sessions, today, cutoff]
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

export function Finances() {
  // `deletePayment` is already wrapped at the context level to surface
  // a success toast, so we use it directly here.
  const { patients, payments, upcomingSessions, openRecordPaymentModal, openEditPaymentModal, deletePayment, mutating, openExpediente, requestFabAction, readOnly, userName, subscription, requirePro } = useCardigan();
  const { t } = useT();
  const [tab, setTab] = useState("balances");
  const [balanceFilter, setBalanceFilter] = useState(null); // null | "owing" | "paid"
  const totalOwed     = patients.reduce((s,p) => s+p.amountDue, 0);
  const owingPatients = patients.filter(p => p.amountDue>0);
  const noPatients    = patients.length === 0;
  const [pdfBusy, setPdfBusy] = useState(false);
  const handleDownloadMonthlyPdf = useCallback(async () => {
    if (pdfBusy) return;
    // Pro-gated — the export is a clear "Pro feature" sell. Trial
    // and expired users get the upgrade sheet; admins/comp/active
    // pass through to the actual download.
    if (!subscription?.isPro) { requirePro?.("documents"); return; }
    setPdfBusy(true);
    try {
      const { downloadMonthlySummaryPdf } = await import("../lib/monthlySummaryPdf");
      const { track } = await import("../lib/analytics");
      downloadMonthlySummaryPdf({
        payments, sessions: upcomingSessions, patients,
        therapistName: userName,
      });
      track("pdf_summary_downloaded");
    } finally {
      setPdfBusy(false);
    }
  }, [pdfBusy, subscription?.isPro, requirePro, payments, upcomingSessions, patients, userName]);

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
            { k: "proyeccion", l: t("finances.forecast") },
          ]}
        />
        {!noPatients && (
          <button type="button"
            onClick={handleDownloadMonthlyPdf}
            disabled={pdfBusy}
            className="btn btn-ghost"
            style={{ width:"auto", display:"inline-flex", alignItems:"center", gap:6, marginTop:10, padding:"6px 12px", fontSize:"var(--text-sm)" }}>
            {pdfBusy ? t("loading") : t("finances.downloadMonthlyPdf")}
          </button>
        )}
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
              <div className="stat-tile-val" style={{ color:"var(--green)" }}>{patients.filter(p=>p.amountDue<=0).length}</div>
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
                {patients.filter(p=>p.amountDue>0).sort((a,b)=>b.amountDue-a.amountDue).map((p,i) => (
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
                {patients.filter(p=>p.amountDue<=0).map((p,i) => (
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

      {tab==="pagos" && <PagosTab payments={payments} patients={patients} onRecordPayment={openRecordPaymentModal} onEditPayment={openEditPaymentModal} onDeletePayment={deletePayment} mutating={mutating} />}

      {tab==="proyeccion" && <ProyeccionTab sessions={upcomingSessions} patients={patients} />}

    </div>
  );
}
