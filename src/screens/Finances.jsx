import { useState } from "react";
import { getClientColor } from "../data/seedData";
import { IconCheck } from "../components/Icons";
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

export function Finances() {
  const { patients, payments, openRecordPaymentModal, openEditPaymentModal, deletePayment, mutating, openExpediente } = useCardigan();
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

    </div>
  );
}
