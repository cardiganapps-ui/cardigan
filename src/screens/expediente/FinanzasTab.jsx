import { useState, useMemo } from "react";
import { shortDateToISO, todayISO } from "../../utils/dates";
import { exportPayments } from "../../utils/export";
import { SegmentedControl } from "../../components/SegmentedControl";
import { SwipeableRow } from "../../components/SwipeableRow";
import { useCardigan } from "../../context/CardiganContext";
import { useT } from "../../i18n/index";

export function FinanzasTab({ patient, pPayments, onRecordPayment, deletePayment, mutating }) {
  const { t } = useT();
  const { loadOlderPayments } = useCardigan();
  const [payPeriod, setPayPeriod] = useState("all");
  const [confirmDeletePayId, setConfirmDeletePayId] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [noMoreOlder, setNoMoreOlder] = useState(false);

  const handleLoadOlder = async () => {
    if (loadingOlder || noMoreOlder) return;
    setLoadingOlder(true);
    const added = await loadOlderPayments(patient.id);
    setLoadingOlder(false);
    if (!added) setNoMoreOlder(true);
  };

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

  const inlineBtnStyle = { height:36, padding:"0 14px", fontSize:"var(--text-sm)", width:"auto", minHeight:0 };

  return (
    <div style={{ padding:"16px" }}>
      {/* Record payment + export */}
      <div style={{ display:"flex", gap:10, marginBottom:14 }}>
        <button className="btn btn-primary" style={{ flex:1 }} onClick={() => onRecordPayment(patient)} disabled={mutating}>
          {mutating ? t("saving") : t("finances.registerPayment")}
        </button>
        {payFiltered.length > 0 && (
          <button className="btn btn-secondary" onClick={() => exportPayments(payFiltered)}
            style={{ height:48, padding:"0 16px", fontSize:"var(--text-sm)", width:"auto" }}>
            {t("finances.export")}
          </button>
        )}
      </div>

      {/* Period filter */}
      <div style={{ marginBottom:10 }}>
        <SegmentedControl
          value={payPeriod}
          onChange={setPayPeriod}
          ariaLabel={t("finances.period")}
          items={[
            { k: "all", l: t("periods.all") },
            { k: "1m",  l: t("periods.1m") },
            { k: "3m",  l: t("periods.3m") },
            { k: "6m",  l: t("periods.6m") },
            { k: "1y",  l: t("periods.1y") },
          ]}
        />
      </div>

      {/* Count + total */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <span style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)", fontWeight:600 }}>{t("finances.paymentCount", { count: payFiltered.length })}</span>
        <span style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:800, color:"var(--green)" }}>+${payTotal.toLocaleString()}</span>
      </div>

      {/* Payment list */}
      {payFiltered.length === 0
        ? <div className="card empty-hint">{t("finances.noPaymentsInPeriod")}</div>
        : <div className="card">
            {payFiltered.map((p) => {
              const isDeleting = confirmDeletePayId === p.id;
              const row = (
                <div className="bal-row" role="button" tabIndex={0} onClick={() => setConfirmDeletePayId(isDeleting ? null : p.id)} style={{ cursor:"pointer", background:"var(--white)" }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div className="bal-sub" style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <span>{p.date}</span>
                      <span style={{ width:3, height:3, borderRadius:"50%", background:"var(--charcoal-xl)", display:"inline-block" }} />
                      <span>{p.method}</span>
                    </div>
                  </div>
                  <div className="bal-amt amount-paid">+${p.amount.toLocaleString()}</div>
                </div>
              );
              return (
                <div key={p.id}>
                  <SwipeableRow
                    onAction={async () => { if (!mutating) await deletePayment(p.id); }}
                    actionLabel={t("delete")}
                    actionTone="danger">
                    {row}
                  </SwipeableRow>
                  {isDeleting && (
                    <div style={{ display:"flex", justifyContent:"flex-end", gap:8, padding:"8px 12px 12px", borderBottom:"1px solid var(--border-lt)" }}>
                      <button className="btn btn-secondary" style={inlineBtnStyle}
                        onClick={(e) => { e.stopPropagation(); setConfirmDeletePayId(null); }}>
                        {t("cancel")}
                      </button>
                      <button className="btn btn-danger" style={inlineBtnStyle}
                        disabled={mutating} onClick={async (e) => { e.stopPropagation(); await deletePayment(p.id); setConfirmDeletePayId(null); }}>
                        {mutating ? t("patients.deleting") : t("finances.deletePayment")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
      }

      {/* Load older payments — the initial fetch windows to 12 months, so
          this pulls the remaining history for this patient on demand. */}
      {!noMoreOlder ? (
        <div style={{ marginTop:12, display:"flex", justifyContent:"center" }}>
          <button type="button" className="btn btn-secondary"
            onClick={handleLoadOlder} disabled={loadingOlder}
            style={{ height:36, padding:"0 16px", fontSize:"var(--text-sm)", width:"auto", minHeight:0 }}>
            {loadingOlder ? t("finances.loadingOlderPayments") : t("finances.loadOlderPayments")}
          </button>
        </div>
      ) : (
        <div style={{ marginTop:12, textAlign:"center", fontSize:"var(--text-sm)", color:"var(--charcoal-xl)" }}>
          {t("finances.noOlderPayments")}
        </div>
      )}
    </div>
  );
}
