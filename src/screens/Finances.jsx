import { useState } from "react";
import { clientColors, monthlyData } from "../data/seedData";
import { IconBank, IconCash, IconCheck } from "../components/Icons";

function FinancesMiniChart({ data, valueKey, color }) {
  const max = Math.max(...data.map(d => d[valueKey]), 1);
  return (
    <div className="bar-chart">
      {data.map((d, i) => {
        const pct    = Math.round((d[valueKey] / max) * 100);
        const isLast = i === data.length - 1;
        return (
          <div className="bar-col" key={d.mes}>
            <div className="bar-val" style={{ color: isLast ? color : "var(--charcoal-xl)", fontSize: isLast ? 9 : 8 }}>
              {valueKey==="sesiones" ? d[valueKey] : `$${(d[valueKey]/1000).toFixed(1)}k`}
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ height:`${pct}%`, background: isLast ? color : "var(--cream-deeper)" }} />
            </div>
            <div className="bar-label" style={{ color: isLast ? color : undefined }}>{d.mes}</div>
          </div>
        );
      })}
    </div>
  );
}

function PagosTab({ payments, patients, onRecordPayment, mutating }) {
  const [groupByClient, setGroupByClient] = useState(false);
  const [sortOrder, setSortOrder]         = useState("desc");
  const [filterMethod, setFilterMethod]   = useState("all");
  const [dateRange, setDateRange]         = useState("all");

  const monthOrder = { "Ene":1, "Feb":2, "Mar":3, "Abr":4, "May":5, "Jun":6, "Jul":7, "Ago":8, "Sep":9, "Oct":10, "Nov":11, "Dic":12 };
  const parseDateKey = (dateStr) => {
    const [day, mon] = dateStr.split(" ");
    return (monthOrder[mon] || 0) * 100 + parseInt(day);
  };

  let filtered = [...payments];
  if (filterMethod !== "all") filtered = filtered.filter(p => p.method === filterMethod);
  if (dateRange === "jan")    filtered = filtered.filter(p => p.date.includes("Ene"));
  if (dateRange === "feb")    filtered = filtered.filter(p => p.date.includes("Feb"));
  filtered.sort((a,b) => sortOrder === "desc" ? parseDateKey(b.date)-parseDateKey(a.date) : parseDateKey(a.date)-parseDateKey(b.date));

  const totalFiltered = filtered.reduce((s,p) => s+p.amount, 0);

  const grouped = {};
  filtered.forEach(p => {
    if (!grouped[p.patient]) grouped[p.patient] = [];
    grouped[p.patient].push(p);
  });

  const renderRow = (p, i) => {
    const patient = patients.find(pt => pt.name === p.patient);
    return (
      <div className="bal-row" key={p.id}>
        <div className="row-avatar" style={{ background: clientColors[(p.colorIdx||i)%clientColors.length], width:36, height:36, fontSize:11, flexShrink:0 }}>
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
    );
  };

  return (
    <div style={{ padding:"0 16px" }}>
      <button className="btn btn-primary" style={{ marginBottom:14 }} onClick={() => onRecordPayment(null)} disabled={mutating}>
        {mutating ? "Guardando..." : "+ Registrar pago"}
      </button>

      <div className="card" style={{ padding:"12px 14px", marginBottom:14 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
          <span style={{ fontSize:12, fontWeight:700, color:"var(--charcoal-md)" }}>Agrupar por cliente</span>
          <button
            onClick={() => setGroupByClient(g => !g)}
            style={{ width:40, height:22, borderRadius:11, border:"none", cursor:"pointer", padding:2, background: groupByClient ? "var(--teal)" : "var(--cream-deeper)", transition:"background 0.2s", position:"relative" }}
          >
            <div style={{ width:18, height:18, borderRadius:"50%", background:"white", boxShadow:"0 1px 3px rgba(0,0,0,0.2)", transform: groupByClient ? "translateX(18px)" : "translateX(0)", transition:"transform 0.2s" }} />
          </button>
        </div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
          <span style={{ fontSize:12, fontWeight:700, color:"var(--charcoal-md)" }}>Orden</span>
          <div style={{ display:"flex", background:"var(--cream-dark)", borderRadius:"var(--radius-pill)", padding:2, gap:2 }}>
            {[{k:"desc",l:"Más reciente"},{k:"asc",l:"Más antiguo"}].map(o => (
              <button key={o.k} onClick={() => setSortOrder(o.k)}
                style={{ padding:"4px 10px", fontSize:11, fontWeight:600, borderRadius:"var(--radius-pill)", border:"none", cursor:"pointer", fontFamily:"var(--font)", background: sortOrder===o.k ? "var(--white)" : "transparent", color: sortOrder===o.k ? "var(--teal-dark)" : "var(--charcoal-lt)", boxShadow: sortOrder===o.k ? "var(--shadow-sm)" : "none" }}>
                {o.l}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
          <span style={{ fontSize:12, fontWeight:700, color:"var(--charcoal-md)" }}>Método</span>
          <div style={{ display:"flex", background:"var(--cream-dark)", borderRadius:"var(--radius-pill)", padding:2, gap:2 }}>
            {[{k:"all",l:"Todos"},{k:"Transferencia",l:"Transf."},{k:"Efectivo",l:"Efect."}].map(o => (
              <button key={o.k} onClick={() => setFilterMethod(o.k)}
                style={{ padding:"4px 10px", fontSize:11, fontWeight:600, borderRadius:"var(--radius-pill)", border:"none", cursor:"pointer", fontFamily:"var(--font)", background: filterMethod===o.k ? "var(--white)" : "transparent", color: filterMethod===o.k ? "var(--teal-dark)" : "var(--charcoal-lt)", boxShadow: filterMethod===o.k ? "var(--shadow-sm)" : "none" }}>
                {o.l}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:12, fontWeight:700, color:"var(--charcoal-md)" }}>Período</span>
          <div style={{ display:"flex", background:"var(--cream-dark)", borderRadius:"var(--radius-pill)", padding:2, gap:2 }}>
            {[{k:"all",l:"Todo"},{k:"jan",l:"Ene"},{k:"feb",l:"Feb"}].map(o => (
              <button key={o.k} onClick={() => setDateRange(o.k)}
                style={{ padding:"4px 10px", fontSize:11, fontWeight:600, borderRadius:"var(--radius-pill)", border:"none", cursor:"pointer", fontFamily:"var(--font)", background: dateRange===o.k ? "var(--white)" : "transparent", color: dateRange===o.k ? "var(--teal-dark)" : "var(--charcoal-lt)", boxShadow: dateRange===o.k ? "var(--shadow-sm)" : "none" }}>
                {o.l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <span style={{ fontSize:12, color:"var(--charcoal-xl)", fontWeight:600 }}>{filtered.length} pago{filtered.length!==1?"s":""}</span>
        <span style={{ fontFamily:"var(--font-d)", fontSize:14, fontWeight:800, color:"var(--green)" }}>+${totalFiltered.toLocaleString()}</span>
      </div>

      {filtered.length === 0
        ? <div className="card" style={{ padding:"28px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>Sin pagos en este período</div>
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
        <div className="section-title" style={{ marginBottom:10 }}>Pendientes de cobro</div>
        <div className="card">
          {patients.filter(p=>p.billed>p.paid).sort((a,b)=>(b.billed-b.paid)-(a.billed-a.paid)).map((p,i) => {
            const owed = p.billed-p.paid;
            return (
              <div className="bal-row" key={p.id}>
                <div className="row-avatar" style={{ background:clientColors[i%clientColors.length], width:36, height:36, fontSize:11, flexShrink:0 }}>{p.initials}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div className="bal-name">{p.name}</div>
                  <div className="bal-sub">{p.day} · ${p.rate}/sesión</div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div className="bal-amt amount-owe">-${owed.toLocaleString()}</div>
                  <button
                    style={{ padding:"5px 12px", fontSize:11, fontWeight:700, borderRadius:"var(--radius-pill)", border:"none", background:"var(--teal)", color:"white", cursor:"pointer", fontFamily:"var(--font)", whiteSpace:"nowrap" }}
                    onClick={() => onRecordPayment(p)}
                    disabled={mutating}
                  >
                    {mutating ? "..." : "Cobrar"}
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

export function Finances({ patients, payments, onRecordPayment, mutating }) {
  const [tab, setTab] = useState("balances");
  const totalOwed     = patients.reduce((s,p) => s+Math.max(0,p.billed-p.paid), 0);
  const owingPatients = patients.filter(p => p.billed>p.paid);
  const currentMonth  = monthlyData[monthlyData.length-1];

  return (
    <div className="page">
      <div style={{ paddingTop:16 }}>
        <div className="fin-tab-row">
          {[{k:"balances",l:"Saldos"},{k:"pagos",l:"Pagos"},{k:"ingresos",l:"Ingresos"}].map(t => (
            <button key={t.k} className={`fin-tab ${tab===t.k?"active":""}`} onClick={() => setTab(t.k)}>{t.l}</button>
          ))}
        </div>
      </div>

      {tab==="balances" && (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, padding:"0 16px 16px" }}>
            <div className="stat-tile">
              <div className="stat-tile-label">Por cobrar</div>
              <div className="stat-tile-val" style={{ color:"var(--red)" }}>${totalOwed.toLocaleString()}</div>
              <div className="stat-tile-sub">{owingPatients.length} pacientes</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile-label">Al corriente</div>
              <div className="stat-tile-val" style={{ color:"var(--green)" }}>{patients.filter(p=>p.billed<=p.paid).length}</div>
              <div className="stat-tile-sub">pacientes</div>
            </div>
          </div>
          <div style={{ padding:"0 16px 8px" }}>
            <div className="section-title" style={{ marginBottom:10 }}>Saldo por paciente</div>
            <div className="card">
              {patients.filter(p=>p.billed>p.paid).sort((a,b)=>(b.billed-b.paid)-(a.billed-a.paid)).map((p,i) => {
                const owed = p.billed-p.paid;
                const pct  = Math.round((p.paid/p.billed)*100);
                return (
                  <div className="bal-row" key={p.id}>
                    <div className="row-avatar" style={{ background:clientColors[i%clientColors.length], width:36, height:36, fontSize:11, flexShrink:0 }}>{p.initials}</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div className="bal-name">{p.name}</div>
                      <div className="balance-bar" style={{ marginTop:5 }}><div className="balance-fill" style={{ width:`${pct}%`, background:"var(--teal)" }} /></div>
                      <div className="bal-sub" style={{ marginTop:3 }}>${p.paid.toLocaleString()} de ${p.billed.toLocaleString()} · {pct}%</div>
                    </div>
                    <div className="bal-amt amount-owe">-${owed.toLocaleString()}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ padding:"16px 16px 0" }}>
            <div className="section-title" style={{ marginBottom:10 }}>Al corriente</div>
            <div className="card">
              {patients.filter(p=>p.billed<=p.paid).map((p,i) => (
                <div className="bal-row" key={p.id}>
                  <div className="row-avatar" style={{ background:clientColors[(i+4)%clientColors.length], width:36, height:36, fontSize:11, flexShrink:0 }}>{p.initials}</div>
                  <div style={{ flex:1 }}>
                    <div className="bal-name">{p.name}</div>
                    <div className="bal-sub">${p.paid.toLocaleString()} pagado</div>
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
          <div className="card" style={{ padding:"16px 16px 12px", marginBottom:14 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
              <div>
                <div className="stat-tile-label">Cobrado este mes</div>
                <div style={{ fontFamily:"var(--font-d)", fontSize:26, fontWeight:800, color:"var(--charcoal)", letterSpacing:"-0.5px" }}>${currentMonth.cobrado.toLocaleString()}</div>
                <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginTop:2 }}>Febrero 2026</div>
              </div>
              <span className="badge badge-green">+{Math.round(((currentMonth.cobrado-monthlyData[monthlyData.length-2].cobrado)/monthlyData[monthlyData.length-2].cobrado)*100)}% vs Ene</span>
            </div>
            <FinancesMiniChart data={monthlyData} valueKey="cobrado" color="var(--teal)" />
          </div>
          <div className="section-title" style={{ marginBottom:10 }}>Historial mensual</div>
          <div className="card">
            {[...monthlyData].reverse().map((m) => (
              <div className="bal-row" key={m.mes}>
                <div style={{ width:36, height:36, background:"var(--teal-pale)", borderRadius:"var(--radius-sm)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <span style={{ fontSize:10, fontWeight:800, color:"var(--teal-dark)" }}>{m.mes}</span>
                </div>
                <div style={{ flex:1 }}>
                  <div className="bal-name">{m.mes} {m.year}</div>
                  <div className="bal-sub">{m.sesiones} sesiones · ${m.pendiente.toLocaleString()} pendiente</div>
                </div>
                <div className="bal-amt" style={{ color:"var(--charcoal)" }}>${m.cobrado.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab==="pagos" && <PagosTab payments={payments} patients={patients} onRecordPayment={onRecordPayment} mutating={mutating} />}

    </div>
  );
}
