import { useState, useCallback } from "react";
import { clientColors, TODAY, DAY_ORDER } from "../data/seedData";
import { IconDollar, IconX, IconPlus } from "../components/Icons";
import { formatShortDate, SHORT_MONTHS } from "../utils/dates";
import { isTutorSession, tutorDisplayInitials, statusClass, statusLabel } from "../utils/sessions";
import { useEscape } from "../hooks/useEscape";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";

export function Home({ setScreen, userName }) {
  const { patients, upcomingSessions, payments, openRecordPaymentModal, mutating } = useCardigan();
  const { t, strings } = useT();
  const todayStr     = formatShortDate(TODAY);
  const todayDayName = DAY_ORDER[(TODAY.getDay() + 6) % 7];

  const totalOwed     = patients.reduce((s,p) => s + p.amountDue, 0);
  const activeCount   = patients.filter(p=>p.status==="active").length;
  const todaySessions = upcomingSessions.filter(s => s.date === todayStr);

  const currentMonthPayments = payments.filter(p => {
    const parts = p.date.split(" ");
    return parts[1] === SHORT_MONTHS[TODAY.getMonth()];
  });
  const cobradoMes = currentMonthPayments.reduce((s,p) => s+p.amount, 0);

  const [selected, setSelected] = useState(null);
  const closeSelected = useCallback(() => setSelected(null), []);
  useEscape(selected ? closeSelected : null);
  const owingPatients = patients.filter(p => p.amountDue > 0);

  const openPatient = (name) => {
    const p = patients.find(p => p.name === name);
    if (p) setSelected(p);
  };

  const emptyHint = (text) => (
    <div style={{ padding:"20px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:12, lineHeight:1.5 }}>{text}</div>
  );

  return (
    <div className="page">
      {patients.length === 0 && (
        <div style={{ padding:"18px 16px 2px", textAlign:"center" }}>
          <div style={{ fontFamily:"var(--font-d)", fontSize:17, fontWeight:800, color:"var(--charcoal)", marginBottom:4 }}>
            {userName ? `${t("home.welcome")}, ${userName.split(" ")[0]}` : t("home.welcome")}
          </div>
          <div style={{ fontSize:12, color:"var(--charcoal-xl)", lineHeight:1.5 }}>
            {t("patients.addFirst")}
          </div>
        </div>
      )}

      <div className="kpi-grid-desktop" style={{ padding:"16px 16px 4px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        <div className="kpi-card" role="button" tabIndex={0} onClick={() => setScreen("agenda")} style={{ cursor:"pointer" }}>
          <div className="kpi-label">{t("home.sessionsToday")}</div>
          <div className="kpi-value">{todaySessions.length}</div>
          <div className="kpi-meta">{todayDayName} {todayStr}</div>
        </div>
        <div className="kpi-card" role="button" tabIndex={0} onClick={() => setScreen("patients")} style={{ cursor:"pointer" }}>
          <div className="kpi-label">{t("patients.title")}</div>
          <div className="kpi-value">{activeCount}</div>
          <div className="kpi-meta">{activeCount === 0 ? t("patients.noPatients").toLowerCase() : t("patients.active").toLowerCase()}</div>
        </div>
        <div className="kpi-card" role="button" tabIndex={0} onClick={() => setScreen("finances")} style={{ cursor:"pointer" }}>
          <div className="kpi-label">{t("finances.monthlyCollected")}</div>
          <div className="kpi-value">${cobradoMes.toLocaleString()}</div>
          <div className="kpi-meta">{strings.months[TODAY.getMonth()]}</div>
        </div>
        <div className="kpi-card" role="button" tabIndex={0} onClick={() => setScreen("finances")} style={{ cursor:"pointer" }}>
          <div className="kpi-label">{t("finances.outstanding")}</div>
          <div className="kpi-value" style={{ color: totalOwed > 0 ? "var(--red)" : undefined }}>${totalOwed.toLocaleString()}</div>
          <div className="kpi-meta">{owingPatients.length} {t("home.patientCount", { count: owingPatients.length })}</div>
        </div>
      </div>

      <div className="home-columns">
      <div className="section home-col-main">
        <div className="section-header">
          <span className="section-title">{t("sessions.today")} — {todayDayName} {todayStr}</span>
          <button className="see-all" onClick={() => setScreen("agenda")}>{t("home.seeWeek")}</button>
        </div>
        <div className="card">
          {todaySessions.length === 0
            ? emptyHint(t("home.emptyToday"))
            : todaySessions.map(s => {
              const tutor = isTutorSession(s);
              return (
              <div className="row-item" key={s.id} onClick={() => openPatient(s.patient)}>
                <div className="row-avatar" style={{ background: tutor ? "var(--purple)" : clientColors[s.colorIdx % clientColors.length], border: tutor ? "2px dashed var(--purple-bg)" : undefined }}>
                  {tutor ? tutorDisplayInitials(s) : s.initials}
                </div>
                <div className="row-content">
                  <div className="row-title">{s.patient}{tutor && <span style={{ fontSize:10, fontWeight:700, color:"var(--purple)", marginLeft:6 }}>{t("sessions.tutor").toUpperCase()}</span>}</div>
                  <div className="row-sub">{s.time} · {s.day}</div>
                </div>
                <div className="row-right">
                  <span className={`session-status ${statusClass(s.status)}`}>{statusLabel(s.status)}</span>
                </div>
              </div>
              );
            })
          }
        </div>
      </div>

      <div className="home-col-side">
      <div className="section">
        <div className="section-header">
          <span className="section-title">{t("home.pendingBalances")}</span>
          <button className="see-all" onClick={() => setScreen("finances")}>{t("home.seeAll")}</button>
        </div>
        <div className="card">
          {owingPatients.length === 0
            ? emptyHint(t("home.emptyBalances"))
            : owingPatients.slice(0,4).map((p,i) => {
              const owed = p.amountDue;
              const totalDue = owed + p.paid;
              const pct  = totalDue > 0 ? (p.paid / totalDue) * 100 : 0;
              return (
                <div className="row-item" key={p.id} onClick={() => setSelected(p)}>
                  <div className="row-avatar" style={{ background: clientColors[(p.colorIdx || i) % clientColors.length] }}>{p.initials}</div>
                  <div className="row-content">
                    <div className="row-title">{p.name}</div>
                    <div className="balance-bar"><div className="balance-fill" style={{ width:`${pct}%` }} /></div>
                    <div className="row-sub" style={{ marginTop:3 }}>${p.paid.toLocaleString()} {t("home.paidOf")} ${totalDue.toLocaleString()}</div>
                  </div>
                  <div className="row-right">
                    <div className="row-amount amount-owe">-${owed.toLocaleString()}</div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      <div className="section" style={{ paddingTop:20, paddingBottom:12 }}>
        <div className="section-header">
          <span className="section-title">{t("home.recentPayments")}</span>
          <button className="see-all" onClick={() => setScreen("finances")}>{t("home.seeAll")}</button>
        </div>
        <div className="card">
          {payments.length === 0
            ? emptyHint(t("home.emptyPayments"))
            : payments.slice(0,3).map(p => (
              <div className="row-item" key={p.id} onClick={() => openPatient(p.patient)}>
                <div className="row-icon" style={{ background:"var(--green-bg)", color:"var(--green)" }}><IconDollar size={18} /></div>
                <div className="row-content">
                  <div className="row-title">{p.patient}</div>
                  <div className="row-sub">{p.date} · {p.method}</div>
                </div>
                <div className="row-right">
                  <div className="row-amount amount-paid">+${p.amount.toLocaleString()}</div>
                </div>
              </div>
            ))}
        </div>
      </div>
      </div>
      </div>

      {selected && (
        <div className="sheet-overlay" onClick={() => setSelected(null)}>
          <div className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{selected.name}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => setSelected(null)}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 24px" }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:20 }}>
                {[
                  { label: t("finances.billed"), value:`$${selected.billed.toLocaleString()}` },
                  { label: t("finances.collected"), value:`$${selected.paid.toLocaleString()}`, color:"var(--green)" },
                  { label: t("finances.balance"), value:`$${selected.amountDue.toLocaleString()}`, color: selected.amountDue>0?"var(--red)":"var(--charcoal-xl)" },
                ].map((s,i) => (
                  <div key={i} style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 10px", textAlign:"center" }}>
                    <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:4 }}>{s.label}</div>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:800, color:s.color||"var(--charcoal)" }}>{s.value}</div>
                  </div>
                ))}
              </div>
              {[
                { label: t("patients.tutor"),           value: selected.parent || "—" },
                { label: t("sessions.regular"),         value:`${selected.day} ${t("home.atTime")} ${selected.time}` },
                { label: t("patients.rate"),            value:`$${selected.rate} ${t("expediente.perSession")}` },
                { label: t("home.totalSessions"),       value: t("sessions.sessionsCount", { count: selected.sessions }) },
                { label: t("patients.status"),          value: selected.status==="active" ? t("patients.statusActive") : t("patients.statusEnded") },
              ].map((row,i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 0", borderBottom:"1px solid var(--border-lt)" }}>
                  <span style={{ fontSize:13, color:"var(--charcoal-xl)" }}>{row.label}</span>
                  <span style={{ fontSize:13, fontWeight:600, color:"var(--charcoal)" }}>{row.value}</span>
                </div>
              ))}
              <div style={{ marginTop:20 }}>
                <button className="btn btn-primary" style={{ height:48 }} onClick={() => openRecordPaymentModal(selected)} disabled={mutating}>
                  {mutating ? t("saving") : t("finances.recordPayment")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
