import { useState } from "react";
import { getClientColor } from "../data/seedData";
import { PAYMENT_METHOD } from "../data/constants";
import { IconCheck } from "../components/Icons";
import { exportPayments } from "../utils/export";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";

function PagosTab({ payments, patients, onRecordPayment, onDeletePayment, mutating }) {
  const { t, strings } = useT();
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [groupByClient, setGroupByClient] = useState(false);
  const [sortOrder, setSortOrder]         = useState("desc");
  const [filterMethod, setFilterMethod]   = useState("all");
  const [dateRange, setDateRange]         = useState("all");

  const monthAbbrevs = strings.monthsShort;
  const monthOrder = {};
  monthAbbrevs.forEach((m, i) => { monthOrder[m] = i + 1; });
  const parseDateKey = (dateStr) => {
    const [day, mon] = dateStr.split(" ");
    return (monthOrder[mon] || 0) * 100 + parseInt(day);
  };

  const availableMonths = monthAbbrevs.filter(m => payments.some(p => p.date.split(" ")[1] === m));
  const periodOptions = [{k:"all",l:t("finances.periodAll")}, ...availableMonths.map(m => ({k:m, l:m}))];

  let filtered = [...payments];
  if (filterMethod !== "all") filtered = filtered.filter(p => p.method === filterMethod);
  if (dateRange !== "all") filtered = filtered.filter(p => p.date.split(" ")[1] === dateRange);
  filtered.sort((a,b) => sortOrder === "desc" ? parseDateKey(b.date)-parseDateKey(a.date) : parseDateKey(a.date)-parseDateKey(b.date));

  const totalFiltered = filtered.reduce((s,p) => s+p.amount, 0);

  const grouped = {};
  filtered.forEach(p => {
    if (!grouped[p.patient]) grouped[p.patient] = [];
    grouped[p.patient].push(p);
  });

  const renderRow = (p, i) => {
    const patient = patients.find(pt => pt.name === p.patient);
    const isDeleting = confirmDeleteId === p.id;
    return (
      <div key={p.id}>
        <div className="bal-row" role="button" tabIndex={0} onClick={() => setConfirmDeleteId(isDeleting ? null : p.id)} style={{ cursor:"pointer" }}>
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
        {isDeleting && (
          <div style={{ display:"flex", justifyContent:"flex-end", gap:8, padding:"8px 12px 12px", borderBottom:"1px solid var(--border-lt)" }}>
            <button style={{ fontSize:12, fontWeight:600, color:"var(--red)", background:"var(--red-bg)", border:"none", borderRadius:"var(--radius-pill)", padding:"8px 16px", cursor:"pointer", fontFamily:"var(--font)", minHeight:36 }}
              disabled={mutating} onClick={async (e) => { e.stopPropagation(); await onDeletePayment(p.id); setConfirmDeleteId(null); }}>
              {mutating ? "..." : t("finances.deletePayment")}
            </button>
            <button style={{ fontSize:12, fontWeight:600, color:"var(--charcoal-lt)", background:"var(--cream)", border:"none", borderRadius:"var(--radius-pill)", padding:"8px 16px", cursor:"pointer", fontFamily:"var(--font)", minHeight:36 }}
              onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}>
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

      <div className="card" style={{ padding:"8px 12px", marginBottom:10 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <span style={{ fontSize:11, fontWeight:600, color:"var(--charcoal-md)" }}>{t("finances.groupByClient")}</span>
            <button
              onClick={() => setGroupByClient(g => !g)}
              style={{ width:34, height:18, minHeight:18, borderRadius:9, border:"none", cursor:"pointer", padding:2, background: groupByClient ? "var(--teal)" : "var(--cream-deeper)", transition:"background 0.2s", position:"relative", flexShrink:0 }}
            >
              <div style={{ width:14, height:14, borderRadius:"50%", background:"white", boxShadow:"0 1px 2px rgba(0,0,0,0.2)", transform: groupByClient ? "translateX(16px)" : "translateX(0)", transition:"transform 0.2s" }} />
            </button>
          </div>
          <div style={{ display:"flex", background:"var(--cream-dark)", borderRadius:"var(--radius-pill)", padding:2, gap:1 }}>
            {[{k:"desc",l:t("finances.newest")},{k:"asc",l:t("finances.oldest")}].map(o => (
              <button key={o.k} onClick={() => setSortOrder(o.k)}
                style={{ padding:"6px 10px", fontSize:11, fontWeight:600, borderRadius:"var(--radius-pill)", border:"none", cursor:"pointer", fontFamily:"var(--font)", background: sortOrder===o.k ? "var(--white)" : "transparent", color: sortOrder===o.k ? "var(--teal-dark)" : "var(--charcoal-lt)", boxShadow: sortOrder===o.k ? "var(--shadow-sm)" : "none", minHeight:32 }}>
                {o.l}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, flexWrap:"wrap" }}>
          <div style={{ display:"flex", background:"var(--cream-dark)", borderRadius:"var(--radius-pill)", padding:2, gap:1 }}>
            {[
              { k: "all", l: t("finances.allMethods") },
              { k: PAYMENT_METHOD.TRANSFER, l: t("finances.transferShort") },
              { k: PAYMENT_METHOD.CASH,     l: t("finances.cashShort") },
            ].map(o => (
              <button key={o.k} onClick={() => setFilterMethod(o.k)}
                style={{ padding:"6px 10px", fontSize:11, fontWeight:600, borderRadius:"var(--radius-pill)", border:"none", cursor:"pointer", fontFamily:"var(--font)", background: filterMethod===o.k ? "var(--white)" : "transparent", color: filterMethod===o.k ? "var(--teal-dark)" : "var(--charcoal-lt)", boxShadow: filterMethod===o.k ? "var(--shadow-sm)" : "none", minHeight:32 }}>
                {o.l}
              </button>
            ))}
          </div>
          <div style={{ display:"flex", background:"var(--cream-dark)", borderRadius:"var(--radius-pill)", padding:2, gap:1, overflowX:"auto" }}>
            {periodOptions.map(o => (
              <button key={o.k} onClick={() => setDateRange(o.k)}
                style={{ padding:"6px 10px", fontSize:11, fontWeight:600, borderRadius:"var(--radius-pill)", border:"none", cursor:"pointer", fontFamily:"var(--font)", background: dateRange===o.k ? "var(--white)" : "transparent", color: dateRange===o.k ? "var(--teal-dark)" : "var(--charcoal-lt)", boxShadow: dateRange===o.k ? "var(--shadow-sm)" : "none", whiteSpace:"nowrap", flexShrink:0, minHeight:32 }}>
                {o.l}
              </button>
            ))}
          </div>
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

      <div style={{ marginTop:16 }}>
        <div className="section-title" style={{ marginBottom:10 }}>{t("finances.pendingCollection")}</div>
        <div className="card">
          {patients.filter(p=>p.amountDue>0).sort((a,b)=>b.amountDue-a.amountDue).map((p,i) => {
            const owed = p.amountDue;
            return (
              <div className="bal-row" key={p.id}>
                <div className="row-avatar" style={{ background: getClientColor(i), width:36, height:36, fontSize:11, flexShrink:0 }}>{p.initials}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div className="bal-name">{p.name}</div>
                  <div className="bal-sub">{p.day} · ${p.rate}/{t("finances.perSession")}</div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div className="bal-amt amount-owe">-${owed.toLocaleString()}</div>
                  <button
                    style={{ padding:"8px 16px", fontSize:12, fontWeight:700, borderRadius:"var(--radius-pill)", border:"none", background:"var(--teal)", color:"white", cursor:"pointer", fontFamily:"var(--font)", whiteSpace:"nowrap", minHeight:36 }}
                    onClick={() => onRecordPayment(p)}
                    disabled={mutating}
                  >
                    {mutating ? "..." : t("finances.collect")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function Finances() {
  const { patients, payments, openRecordPaymentModal, deletePayment, mutating } = useCardigan();
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
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, padding:"0 16px 16px" }}>
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
                <div className="bal-row" key={p.id}>
                  <div className="row-avatar" style={{ background: getClientColor(i), width:36, height:36, fontSize:11, flexShrink:0 }}>{p.initials}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div className="bal-name">{p.name}</div>
                    <div className="bal-sub">{p.day} · ${p.rate.toLocaleString()}/{t("finances.perSession")}</div>
                  </div>
                  <div className="bal-amt amount-owe">-${p.amountDue.toLocaleString()}</div>
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
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
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

      {tab==="pagos" && <PagosTab payments={payments} patients={patients} onRecordPayment={openRecordPaymentModal} onDeletePayment={deletePayment} mutating={mutating} />}

    </div>
  );
}
