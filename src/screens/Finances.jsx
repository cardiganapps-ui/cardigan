import { useState } from "react";
import { getClientColor } from "../data/seedData";
import { IconCheck } from "../components/Icons";
import { Toggle } from "../components/Toggle";
import { exportPayments } from "../utils/export";
import { shortDateToISO, todayISO } from "../utils/dates";
import { useCardigan } from "../context/CardiganContext";
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
          <div className="row-avatar" style={{ background: getClientColor(p.colorIdx ?? i), width:36, height:36, fontSize:11, flexShrink:0 }}>
            {patient ? patient.initials : p.patient.slice(0,2).toUpperCase()}
          </div>
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
            <button style={{ fontSize:12, fontWeight:600, color:"var(--teal-dark)", background:"var(--teal-pale)", border:"none", borderRadius:"var(--radius-pill)", padding:"8px 16px", cursor:"pointer", fontFamily:"var(--font)", minHeight:36 }}
              onClick={(e) => { e.stopPropagation(); setExpandedId(null); onEditPayment(p); }}>
              {t("edit")}
            </button>
            <button style={{ fontSize:12, fontWeight:600, color:"var(--red)", background:"var(--red-bg)", border:"none", borderRadius:"var(--radius-pill)", padding:"8px 16px", cursor:"pointer", fontFamily:"var(--font)", minHeight:36 }}
              disabled={mutating} onClick={async (e) => { e.stopPropagation(); await onDeletePayment(p.id); setExpandedId(null); }}>
              {mutating ? "..." : t("finances.deletePayment")}
            </button>
            <button style={{ fontSize:12, fontWeight:600, color:"var(--charcoal-lt)", background:"var(--cream)", border:"none", borderRadius:"var(--radius-pill)", padding:"8px 16px", cursor:"pointer", fontFamily:"var(--font)", minHeight:36 }}
              onClick={(e) => { e.stopPropagation(); setExpandedId(null); }}>
              {t("cancel")}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding:"0 16px" }}>
      <div style={{ display:"flex", gap:10, marginBottom:14 }}>
        <button className="btn btn-primary" style={{ flex:1 }} onClick={() => onRecordPayment(null)} disabled={mutating}>
          {mutating ? t("saving") : t("finances.registerPayment")}
        </button>
        {filtered.length > 0 && (
          <button className="btn" onClick={() => exportPayments(filtered)}
            style={{ fontSize:11, fontWeight:600, padding:"0 14px", background:"var(--cream)", color:"var(--charcoal-md)", boxShadow:"none" }}>
            {t("finances.export")}
          </button>
        )}
      </div>

      <div style={{ marginBottom:12 }}>
        <div style={{ display:"flex", gap:4, marginBottom:8 }}>
          {[
            { k: "all", l: t("periods.all") },
            { k: "1m",  l: t("periods.1m") },
            { k: "3m",  l: t("periods.3m") },
            { k: "6m",  l: t("periods.6m") },
            { k: "1y",  l: t("periods.1y") },
          ].map(o => (
            <button key={o.k} onClick={() => setPeriod(o.k)}
              style={{ flex:1, padding:"5px 0", fontSize:11, fontWeight:600, borderRadius:"var(--radius-pill)", border:"none", cursor:"pointer", fontFamily:"var(--font)", background: period===o.k ? "var(--teal)" : "var(--cream)", color: period===o.k ? "white" : "var(--charcoal-md)", textAlign:"center" }}>
              {o.l}
            </button>
          ))}
        </div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", gap:8 }}>
          <span style={{ fontSize:11, fontWeight:600, color:"var(--charcoal-md)" }}>{t("finances.groupByClient")}</span>
          <Toggle on={groupByClient} onToggle={() => setGroupByClient(g => !g)} />
        </div>
      </div>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <span style={{ fontSize:12, color:"var(--charcoal-xl)", fontWeight:600 }}>{t("finances.paymentCount", { count: filtered.length })}</span>
        <span style={{ fontFamily:"var(--font-d)", fontSize:14, fontWeight:800, color:"var(--green)" }}>+${totalFiltered.toLocaleString()}</span>
      </div>

      {filtered.length === 0
        ? <div className="card empty-hint">{t("finances.noPaymentsInPeriod")}</div>
        : groupByClient
          ? Object.entries(grouped).map(([name, pList], gi) => {
              const total = pList.reduce((s,p)=>s+p.amount,0);
              return (
                <div key={name} style={{ marginBottom:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6, paddingLeft:2 }}>
                    <span className="section-title" style={{ fontSize:13 }}>{name}</span>
                    <span style={{ fontFamily:"var(--font-d)", fontSize:13, fontWeight:800, color:"var(--green)" }}>+${total.toLocaleString()}</span>
                  </div>
                  <div className="card">
                    {pList.map((p,i) => renderRow(p, gi*10+i))}
                  </div>
                </div>
              );
            })
          : <div className="card">{filtered.map((p,i) => renderRow(p,i))}</div>
      }

    </div>
  );
}

export function Finances() {
  const { patients, payments, openRecordPaymentModal, openEditPaymentModal, deletePayment, mutating } = useCardigan();
  const { t } = useT();
  const [tab, setTab] = useState("balances");
  const totalOwed     = patients.reduce((s,p) => s+p.amountDue, 0);
  const owingPatients = patients.filter(p => p.amountDue>0);
  const totalCollected = payments.reduce((s,p) => s+p.amount, 0);

  return (
    <div className="page">
      <div style={{ paddingTop:16 }}>
        <div className="fin-tab-row" role="tablist" data-tour="finances-tabs">
          {[{k:"balances",l:t("finances.balances")},{k:"pagos",l:t("finances.payments")},{k:"ingresos",l:t("finances.income")}].map(tb => (
            <button key={tb.k} role="tab" aria-selected={tab===tb.k} className={`fin-tab ${tab===tb.k?"active":""}`} onClick={() => setTab(tb.k)}>{tb.l}</button>
          ))}
        </div>
      </div>

      {tab==="balances" && (
        <div>
          <div className="fin-stats-grid">
            <div className="stat-tile">
              <div className="stat-tile-label">{t("finances.outstanding")}</div>
              <div className="stat-tile-val" style={{ color:"var(--red)" }}>${totalOwed.toLocaleString()}</div>
              <div className="stat-tile-sub">{t("finances.patientCount", { count: owingPatients.length })}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile-label">{t("patients.upToDate")}</div>
              <div className="stat-tile-val" style={{ color:"var(--green)" }}>{patients.filter(p=>p.amountDue<=0).length}</div>
              <div className="stat-tile-sub">{t("finances.patientsLabel")}</div>
            </div>
          </div>
          <div style={{ padding:"0 16px 8px" }}>
            <div className="section-title" style={{ marginBottom:10 }}>{t("finances.patientBalance")}</div>
            <div className="card">
              {patients.filter(p=>p.amountDue>0).sort((a,b)=>b.amountDue-a.amountDue).map((p,i) => (
                <div className="bal-row" key={p.id} role="button" tabIndex={0}
                  onClick={() => openRecordPaymentModal(p)}
                  style={{ cursor:"pointer" }}>
                  <div className="row-avatar" style={{ background: getClientColor(i), width:36, height:36, fontSize:11, flexShrink:0 }}>{p.initials}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div className="bal-name">{p.name}</div>
                  </div>
                  <div className="bal-amt amount-owe">${p.amountDue.toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ padding:"16px 16px 0" }}>
            <div className="section-title" style={{ marginBottom:10 }}>{t("patients.upToDate")}</div>
            <div className="card">
              {patients.filter(p=>p.amountDue<=0).map((p,i) => (
                <div className="bal-row" key={p.id}>
                  <div className="row-avatar" style={{ background: getClientColor(i + 4), width:36, height:36, fontSize:11, flexShrink:0 }}>{p.initials}</div>
                  <div style={{ flex:1 }}>
                    <div className="bal-name">{p.name}</div>
                    <div className="bal-sub">${p.paid.toLocaleString()} {t("finances.paidAmount")}</div>
                  </div>
                  <div className="bal-amt amount-paid"><IconCheck size={16} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab==="ingresos" && (
        <div style={{ padding:"0 16px" }}>
          <div className="fin-stats-grid" style={{ marginBottom:14, paddingBottom:0 }}>
            <div className="stat-tile">
              <div className="stat-tile-label">{t("finances.totalCollected")}</div>
              <div className="stat-tile-val" style={{ color:"var(--green)" }}>${totalCollected.toLocaleString()}</div>
              <div className="stat-tile-sub">{t("finances.paymentCount", { count: payments.length })}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile-label">{t("finances.pending")}</div>
              <div className="stat-tile-val" style={{ color:"var(--red)" }}>${totalOwed.toLocaleString()}</div>
              <div className="stat-tile-sub">{t("finances.patientCount", { count: owingPatients.length })}</div>
            </div>
          </div>
          {payments.length === 0
            ? <div className="card empty-hint">
                {t("finances.noPayments")}
              </div>
            : <div>
                <div className="section-title" style={{ marginBottom:10 }}>{t("finances.recentPayments")}</div>
                <div className="card">
                  {[...payments].reverse().slice(0,10).map((p,i) => (
                    <div className="bal-row" key={p.id}>
                      <div className="row-avatar" style={{ background: getClientColor(p.colorIdx ?? i), width:36, height:36, fontSize:11, flexShrink:0 }}>
                        {p.initials || p.patient?.slice(0,2).toUpperCase()}
                      </div>
                      <div style={{ flex:1 }}>
                        <div className="bal-name">{p.patient}</div>
                        <div className="bal-sub">{p.date} · {p.method}</div>
                      </div>
                      <div className="bal-amt amount-paid">+${p.amount.toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>
          }
        </div>
      )}

      {tab==="pagos" && <PagosTab payments={payments} patients={patients} onRecordPayment={openRecordPaymentModal} onEditPayment={openEditPaymentModal} onDeletePayment={deletePayment} mutating={mutating} />}

    </div>
  );
}
