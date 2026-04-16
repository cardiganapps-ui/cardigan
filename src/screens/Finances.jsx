import { useState, useMemo } from "react";
import { getClientColor } from "../data/seedData";
import { IconCheck, IconTrendingUp } from "../components/Icons";
import { Toggle } from "../components/Toggle";
import { shortDateToISO, todayISO } from "../utils/dates";
import { useCardigan } from "../context/CardiganContext";
import { SegmentedControl } from "../components/SegmentedControl";
import { Avatar } from "../components/Avatar";
import { useT } from "../i18n/index";

function PagosTab({ payments, patients, onRecordPayment, onEditPayment, onDeletePayment, mutating }) {
  const { t, strings } = useT();
  const [expandedId, setExpandedId] = useState(null);
  const [groupByClient, setGroupByClient] = useState(false);
  const [period, setPeriod] = useState("all");

  // Compute date-from based on period selection
  const getDateFrom = (p) => {
    if (p === "all") return null;
    const months = { "1m": 1, "3m": 3, "6m": 6, "1y": 12 };
    const d = new Date();
    d.setMonth(d.getMonth() - (months[p] || 0));
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  };

  const dateFrom = getDateFrom(period);
  const today = todayISO();

  let filtered = [...payments];
  if (dateFrom) filtered = filtered.filter(p => {
    const iso = shortDateToISO(p.date);
    return iso >= dateFrom && iso <= today;
  });
  // Always sort newest first
  filtered.sort((a, b) => shortDateToISO(b.date).localeCompare(shortDateToISO(a.date)));

  const totalFiltered = filtered.reduce((s,p) => s+p.amount, 0);

  const grouped = {};
  filtered.forEach(p => {
    if (!grouped[p.patient]) grouped[p.patient] = [];
    grouped[p.patient].push(p);
  });

  const renderRow = (p, i) => {
    const patient = patients.find(pt => pt.name === p.patient);
    const isExpanded = expandedId === p.id;
    return (
      <div key={p.id}>
        <div className="bal-row" role="button" tabIndex={0} onClick={() => setExpandedId(isExpanded ? null : p.id)} style={{ cursor:"pointer" }}>
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
          <div className="bal-amt amount-paid">+${p.amount.toLocaleString()}</div>
        </div>
        {isExpanded && (
          <div style={{ display:"flex", justifyContent:"flex-end", gap:8, padding:"8px 12px 12px", borderBottom:"1px solid var(--border-lt)" }}>
            <button className="btn btn-ghost" style={{ background:"var(--teal-pale)", color:"var(--teal-dark)", height:36, padding:"0 16px" }}
              onClick={(e) => { e.stopPropagation(); setExpandedId(null); onEditPayment(p); }}>
              {t("edit")}
            </button>
            <button className="btn" style={{ background:"var(--red-bg)", color:"var(--red)", height:36, padding:"0 16px", fontSize:"var(--text-sm)", boxShadow:"none" }}
              disabled={mutating} onClick={async (e) => { e.stopPropagation(); await onDeletePayment(p.id); setExpandedId(null); }}>
              {mutating ? "..." : t("finances.deletePayment")}
            </button>
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
            { k: "1m",  l: t("periods.1m") },
            { k: "3m",  l: t("periods.3m") },
            { k: "6m",  l: t("periods.6m") },
            { k: "1y",  l: t("periods.1y") },
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
        <span style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:800, color:"var(--green)" }}>+${totalFiltered.toLocaleString()}</span>
      </div>

      {filtered.length === 0
        ? <div className="card empty-hint">{t("finances.noPaymentsInPeriod")}</div>
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
                    <div className="bal-amt amount-paid">+${total.toLocaleString()}</div>
                  </div>
                );
              })}
            </div>
          : <div className="card">{filtered.map((p,i) => renderRow(p,i))}</div>
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

  const cancelRate = customCancel !== null ? customCancel / 100 : histRate;

  // Gross and net
  const gross = futureSessions.reduce((sum, s) => sum + (s.rate || 0), 0);
  const net = Math.round(gross * (1 - cancelRate));

  // Weeks in period for weekly average (matches fixed day counts: 7, 30, 90)
  const weeksInPeriod = (PERIOD_DAYS[period] || 30) / 7;
  const perWeek = weeksInPeriod > 0 ? Math.round(net / weeksInPeriod) : 0;

  // Average session rate
  const avgRate = futureSessions.length > 0
    ? Math.round(futureSessions.reduce((s, x) => s + (x.rate || 0), 0) / futureSessions.length)
    : 0;

  // Breakdown by patient
  const byPatient = useMemo(() => {
    const map = {};
    for (const s of futureSessions) {
      if (!map[s.patient]) map[s.patient] = { count: 0, total: 0, colorIdx: s.colorIdx ?? s.color_idx, initials: s.initials };
      map[s.patient].count++;
      map[s.patient].total += (s.rate || 0);
    }
    return Object.entries(map)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [futureSessions]);

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
          <div className="stat-tile-val">${gross.toLocaleString()}</div>
          <div className="stat-tile-sub">{t("finances.forecastScheduled", { count: futureSessions.length, plural: futureSessions.length !== 1 ? "es" : "" })}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-label">{t("finances.forecastNet")}</div>
          <div className="stat-tile-val" style={{ color:"var(--green)" }}>${net.toLocaleString()}</div>
          <div className="stat-tile-sub">-{Math.round(cancelRate * 100)}% {t("finances.forecastCancelRate").toLowerCase()}</div>
        </div>
      </div>

      <div className="fin-stats-grid" style={{ padding:0, marginBottom:16 }}>
        <div className="stat-tile">
          <div className="stat-tile-label">{t("finances.forecastPerWeek")}</div>
          <div className="stat-tile-val">${perWeek.toLocaleString()}</div>
          <div className="stat-tile-sub">{t("finances.forecastActivePatients", { count: activeContributing, plural: activeContributing !== 1 ? "s" : "" })}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-label">{t("finances.forecastAvgSession")}</div>
          <div className="stat-tile-val">${avgRate.toLocaleString()}</div>
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
              style={{ fontSize:11, padding:"2px 10px", height:"auto", minHeight:0 }}
              onClick={() => setCustomCancel(null)}
            >
              Usar histórico
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
                    <div className="bal-sub">{p.count} sesión{p.count !== 1 ? "es" : ""}</div>
                  </div>
                  <div className="bal-amt" style={{ color:"var(--charcoal)", fontWeight:700 }}>${p.total.toLocaleString()}</div>
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
  const { patients, payments, upcomingSessions, openRecordPaymentModal, openEditPaymentModal, deletePayment, mutating, openExpediente } = useCardigan();
  const { t } = useT();
  const [tab, setTab] = useState("balances");
  const [balanceFilter, setBalanceFilter] = useState(null); // null | "owing" | "paid"
  const totalOwed     = patients.reduce((s,p) => s+p.amountDue, 0);
  const owingPatients = patients.filter(p => p.amountDue>0);

  return (
    <div className="page">
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
      </div>

      {tab==="balances" && (
        <div>
          <div className="fin-stats-grid">
            <div role="button" tabIndex={0}
              onClick={() => setBalanceFilter(balanceFilter === "owing" ? null : "owing")}
              className={`stat-tile stat-tile-clickable ${balanceFilter === "owing" ? "stat-tile-selected" : ""}`}
              style={{ cursor:"pointer" }}>
              <div className="stat-tile-label">{t("finances.outstanding")}</div>
              <div className="stat-tile-val" style={{ color:"var(--red)" }}>${totalOwed.toLocaleString()}</div>
              <div className="stat-tile-sub">{t("finances.patientCount", { count: owingPatients.length })}</div>
            </div>
            <div role="button" tabIndex={0}
              onClick={() => setBalanceFilter(balanceFilter === "paid" ? null : "paid")}
              className={`stat-tile stat-tile-clickable ${balanceFilter === "paid" ? "stat-tile-selected" : ""}`}
              style={{ cursor:"pointer" }}>
              <div className="stat-tile-label">{t("patients.upToDate")}</div>
              <div className="stat-tile-val" style={{ color:"var(--green)" }}>{patients.filter(p=>p.amountDue<=0).length}</div>
              <div className="stat-tile-sub">{t("finances.patientsLabel")}</div>
            </div>
          </div>
          {balanceFilter !== "paid" && (
            <div style={{ padding:"0 16px 8px" }}>
              <div className="section-title" style={{ marginBottom:10 }}>{t("finances.patientBalance")}</div>
              <div className="card">
                {patients.filter(p=>p.amountDue>0).sort((a,b)=>b.amountDue-a.amountDue).map((p,i) => (
                  <div className="bal-row" key={p.id} role="button" tabIndex={0}
                    onClick={() => openRecordPaymentModal(p)}
                    style={{ cursor:"pointer" }}>
                    <Avatar initials={p.initials} color={getClientColor(i)} size="sm" />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div className="bal-name">{p.name}</div>
                    </div>
                    <div className="bal-amt amount-owe">${p.amountDue.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {balanceFilter !== "owing" && (
            <div style={{ padding: balanceFilter === "paid" ? "0 16px 8px" : "16px 16px 0" }}>
              <div className="section-title" style={{ marginBottom:10 }}>{t("patients.upToDate")}</div>
              <div className="card">
                {patients.filter(p=>p.amountDue<=0).map((p,i) => (
                  <div className="bal-row" key={p.id} role="button" tabIndex={0}
                    onClick={() => openExpediente(p)}
                    style={{ cursor:"pointer" }}>
                    <Avatar initials={p.initials} color={getClientColor(i + 4)} size="sm" />
                    <div style={{ flex:1 }}>
                      <div className="bal-name">{p.name}</div>
                      <div className="bal-sub">${p.paid.toLocaleString()} {t("finances.paidAmount")}</div>
                    </div>
                    <div className="bal-amt amount-paid"><IconCheck size={16} /></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab==="pagos" && <PagosTab payments={payments} patients={patients} onRecordPayment={openRecordPaymentModal} onEditPayment={openEditPaymentModal} onDeletePayment={deletePayment} mutating={mutating} />}

      {tab==="proyeccion" && <ProyeccionTab sessions={upcomingSessions} patients={patients} />}

    </div>
  );
}
