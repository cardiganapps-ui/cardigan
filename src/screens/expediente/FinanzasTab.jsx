import { useState, useMemo } from "react";
import { shortDateToISO, todayISO } from "../../utils/dates";
import { exportPayments } from "../../utils/export";
import { useT } from "../../i18n/index";

export function FinanzasTab({ patient, pPayments, onRecordPayment, deletePayment, mutating }) {
  const { t } = useT();
  const [payPeriod, setPayPeriod] = useState("all");
  const [confirmDeletePayId, setConfirmDeletePayId] = useState(null);

  const { payFiltered, payTotal } = useMemo(() => {
    const getPayDateFrom = (p) => {
      if (p === "all") return null;
      const months = { "1m": 1, "3m": 3, "6m": 6, "1y": 12 };
      const d = new Date(); d.setMonth(d.getMonth() - (months[p] || 0));
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    };
    const payDateFrom = getPayDateFrom(payPeriod);
    const payToday = todayISO();
    let filtered = [...pPayments];
    if (payDateFrom) filtered = filtered.filter(p => {
      const iso = shortDateToISO(p.date);
      return iso >= payDateFrom && iso <= payToday;
    });
    filtered.sort((a, b) => shortDateToISO(b.date).localeCompare(shortDateToISO(a.date)));
    const total = filtered.reduce((s, p) => s + p.amount, 0);
    return { payFiltered: filtered, payTotal: total };
  }, [pPayments, payPeriod]);

  return (
    <div style={{ padding:16 }}>
      {/* Record payment + export */}
      <div style={{ display:"flex", gap:10, marginBottom:14 }}>
        <button className="btn btn-primary" style={{ flex:1 }} onClick={() => onRecordPayment(patient)} disabled={mutating}>
          {mutating ? t("saving") : t("finances.registerPayment")}
        </button>
        {payFiltered.length > 0 && (
          <button className="btn" onClick={() => exportPayments(payFiltered)}
            style={{ fontSize:11, fontWeight:600, padding:"0 14px", background:"var(--cream)", color:"var(--charcoal-md)", boxShadow:"none" }}>
            {t("finances.export")}
          </button>
        )}
      </div>

      {/* Period filter */}
      <div className="card" style={{ padding:"8px 12px", marginBottom:10 }}>
        <div style={{ display:"flex", gap:4 }}>
          {[
            { k: "all", l: t("periods.all") },
            { k: "1m",  l: t("periods.1m") },
            { k: "3m",  l: t("periods.3m") },
            { k: "6m",  l: t("periods.6m") },
            { k: "1y",  l: t("periods.1y") },
          ].map(o => (
            <button key={o.k} onClick={() => setPayPeriod(o.k)}
              style={{ padding:"5px 10px", fontSize:11, fontWeight:600, borderRadius:"var(--radius-pill)", border:"none", cursor:"pointer", fontFamily:"var(--font)", background: payPeriod===o.k ? "var(--teal)" : "var(--cream)", color: payPeriod===o.k ? "white" : "var(--charcoal-md)" }}>
              {o.l}
            </button>
          ))}
        </div>
      </div>

      {/* Count + total */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <span style={{ fontSize:12, color:"var(--charcoal-xl)", fontWeight:600 }}>{t("finances.paymentCount", { count: payFiltered.length })}</span>
        <span style={{ fontFamily:"var(--font-d)", fontSize:14, fontWeight:800, color:"var(--green)" }}>+${payTotal.toLocaleString()}</span>
      </div>

      {/* Payment list */}
      {payFiltered.length === 0
        ? <div className="card empty-hint">{t("finances.noPaymentsInPeriod")}</div>
        : <div className="card">
            {payFiltered.map((p) => {
              const isDeleting = confirmDeletePayId === p.id;
              return (
                <div key={p.id}>
                  <div className="bal-row" role="button" tabIndex={0} onClick={() => setConfirmDeletePayId(isDeleting ? null : p.id)} style={{ cursor:"pointer" }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div className="bal-sub" style={{ display:"flex", alignItems:"center", gap:6 }}>
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
                        disabled={mutating} onClick={async (e) => { e.stopPropagation(); await deletePayment(p.id); setConfirmDeletePayId(null); }}>
                        {mutating ? "..." : t("finances.deletePayment")}
                      </button>
                      <button style={{ fontSize:12, fontWeight:600, color:"var(--charcoal-lt)", background:"var(--cream)", border:"none", borderRadius:"var(--radius-pill)", padding:"8px 16px", cursor:"pointer", fontFamily:"var(--font)", minHeight:36 }}
                        onClick={(e) => { e.stopPropagation(); setConfirmDeletePayId(null); }}>
                        {t("cancel")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
      }
    </div>
  );
}
