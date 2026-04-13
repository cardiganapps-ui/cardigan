import { useState, useCallback, useMemo } from "react";
import { getClientColor, TODAY, DAY_ORDER } from "../data/seedData";
import { IconDollar, IconX, IconPlus, IconCalendar } from "../components/Icons";
import { formatShortDate, SHORT_MONTHS, parseShortDate } from "../utils/dates";
import { isTutorSession, tutorDisplayInitials, statusClass, statusLabel } from "../utils/sessions";
import { useEscape } from "../hooks/useEscape";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";

export function Home({ setScreen, userName }) {
  const { patients, upcomingSessions, notes, payments, openRecordPaymentModal, mutating } = useCardigan();
  const { t, strings } = useT();
  const todayStr     = formatShortDate(TODAY);
  const todayDayName = DAY_ORDER[(TODAY.getDay() + 6) % 7];

  const totalOwed     = patients.reduce((s,p) => s + p.amountDue, 0);
  const activeCount   = patients.filter(p=>p.status==="active").length;
  const todaySessions = upcomingSessions.filter(s => s.date === todayStr);

  // Find next upcoming session (scheduled, today or future)
  const nextSession = useMemo(() => {
    const now = new Date();
    const nowH = now.getHours(), nowM = now.getMinutes();
    return upcomingSessions
      .filter(s => s.status === "scheduled")
      .filter(s => {
        const d = parseShortDate(s.date);
        if (!d) return false;
        if (d > TODAY) return true;
        if (d.toDateString() === TODAY.toDateString()) {
          const [h, m] = (s.time || "00:00").split(":").map(Number);
          return h > nowH || (h === nowH && m > nowM);
        }
        return false;
      })
      .sort((a, b) => {
        const da = parseShortDate(a.date), db = parseShortDate(b.date);
        if (!da || !db) return 0;
        const diff = da - db;
        return diff !== 0 ? diff : (a.time || "").localeCompare(b.time || "");
      })[0] || null;
  }, [upcomingSessions]);

  // Last note for the next session's patient
  const nextSessionNote = useMemo(() => {
    if (!nextSession) return null;
    return (notes || [])
      .filter(n => n.patient_id === nextSession.patient_id && n.content)
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))[0] || null;
  }, [nextSession, notes]);

  const currentMonthPayments = payments.filter(p => {
    if (p.created_at) {
      const d = new Date(p.created_at);
      return d.getFullYear() === TODAY.getFullYear() && d.getMonth() === TODAY.getMonth();
    }
    const parts = p.date.split(" ");
    return parts[1] === SHORT_MONTHS[TODAY.getMonth()];
  });
  const cobradoMes = currentMonthPayments.reduce((s,p) => s+p.amount, 0);

  const totalCobrado = payments.reduce((s, p) => s + p.amount, 0);

  const sessionStats = useMemo(() => {
    return {
      completed: upcomingSessions.filter(s => s.status === "completed").length,
      cancelled: upcomingSessions.filter(s => s.status === "cancelled").length,
      charged: upcomingSessions.filter(s => s.status === "charged").length,
      scheduled: upcomingSessions.filter(s => s.status === "scheduled").length,
      total: upcomingSessions.length,
    };
  }, [upcomingSessions]);

  const [selected, setSelected] = useState(null);
  const closeSelected = useCallback(() => setSelected(null), []);
  useEscape(selected ? closeSelected : null);
  const owingPatients = patients.filter(p => p.amountDue > 0);

  const openPatient = (name) => {
    const p = patients.find(p => p.name === name);
    if (p) setSelected(p);
  };

  const emptyHint = (text, action) => (
    <div className="empty-hint">
      {text}
      {action && <div style={{ marginTop:8 }}>{action}</div>}
    </div>
  );

  return (
    <div className="page">
      {patients.length === 0 && (
        <div style={{ padding:"18px 16px 2px", textAlign:"center" }}>
          <div style={{ fontFamily:"var(--font-d)", fontSize:17, fontWeight:800, color:"var(--charcoal)", marginBottom:4 }}>
            {userName ? `${t("home.welcome")}, ${userName.split(" ")[0]}` : t("home.welcome")}
          </div>
          <div style={{ fontSize:12, color:"var(--charcoal-xl)", lineHeight:1.5, marginBottom:10 }}>
            {t("patients.addFirst")}
          </div>
          <div style={{ display:"inline-flex", alignItems:"center", gap:6, background:"var(--teal-pale)", color:"var(--teal-dark)", padding:"6px 14px", borderRadius:"var(--radius-pill)", fontSize:12, fontWeight:700 }}>
            <IconPlus size={14} /> {t("fab.patient")}
          </div>
        </div>
      )}

      <div className="kpi-grid-desktop" data-tour="kpis" style={{ padding:"16px 16px 4px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
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
        <div className="kpi-card" role="button" tabIndex={0} onClick={() => setScreen("finances")} style={{ cursor:"pointer", gridColumn:"1 / -1" }}>
          <div className="kpi-label">{t("home.totalCollectedAllTime")}</div>
          <div className="kpi-value" style={{ color:"var(--green)" }}>${totalCobrado.toLocaleString()}</div>
          <div className="kpi-meta">{t("home.allTime")}</div>
        </div>
      </div>

      {nextSession && (
        <div className="section" style={{ paddingBottom:0 }}>
          <div className="card" style={{ padding:"14px 16px", cursor:"pointer", background:"var(--teal-mist)", border:"1.5px solid var(--teal-pale)" }}
            onClick={() => setScreen("agenda")}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:40, height:40, borderRadius:"50%", background: isTutorSession(nextSession) ? "var(--purple)" : getClientColor(nextSession.colorIdx), display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"var(--font-d)", fontSize:13, fontWeight:800, color:"white", flexShrink:0 }}>
                {isTutorSession(nextSession) ? tutorDisplayInitials(nextSession) : nextSession.initials}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em", color:"var(--teal-dark)", marginBottom:2 }}>{t("home.nextSession")}</div>
                <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:800, color:"var(--charcoal)" }}>{nextSession.patient}</div>
                <div style={{ fontSize:12, color:"var(--charcoal-md)", marginTop:1 }}>{nextSession.time} · {nextSession.date} · {nextSession.day}</div>
                {nextSessionNote && (
                  <div style={{ fontSize:11, color:"var(--charcoal-lt)", marginTop:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {nextSessionNote.title || nextSessionNote.content.slice(0, 60)}
                  </div>
                )}
              </div>
              <IconCalendar size={18} style={{ color:"var(--teal)", flexShrink:0 }} />
            </div>
          </div>
        </div>
      )}

      <div className="home-columns">
      <div className="section home-col-main">
        <div className="section-header">
          <span className="section-title">{t("sessions.today")} — {todayDayName} {todayStr}</span>
          <button className="see-all" onClick={() => setScreen("agenda")}>{t("home.seeWeek")}</button>
        </div>
        <div className="card">
          {todaySessions.length === 0
            ? emptyHint(t("home.emptyToday"),
                <button className="btn btn-ghost" style={{ fontSize:12 }} onClick={() => setScreen("agenda")}>{t("home.seeWeek")}</button>
              )
            : todaySessions.map(s => {
              const tutor = isTutorSession(s);
              return (
              <div className="row-item" key={s.id} onClick={() => openPatient(s.patient)}>
                <div className="row-avatar" style={{ background: tutor ? "var(--purple)" : getClientColor(s.colorIdx), border: tutor ? "2px dashed var(--purple-bg)" : undefined }}>
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

        {upcomingSessions.length > 0 && (
        <div className="section" style={{ paddingTop:20 }}>
          <div className="section-header">
            <span className="section-title">{t("home.sessionStats")}</span>
          </div>
          <div className="card" style={{ padding:"12px 14px" }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
              <div style={{ background:"var(--green-bg)", borderRadius:"var(--radius)", padding:"8px 6px", textAlign:"center" }}>
                <div style={{ fontFamily:"var(--font-d)", fontSize:20, fontWeight:800, color:"var(--green)" }}>{sessionStats.completed}</div>
                <div style={{ fontSize:9, color:"var(--charcoal-xl)", marginTop:1 }}>{t("home.completedSessions")}</div>
              </div>
              <div style={{ background:"var(--red-bg)", borderRadius:"var(--radius)", padding:"8px 6px", textAlign:"center" }}>
                <div style={{ fontFamily:"var(--font-d)", fontSize:20, fontWeight:800, color:"var(--red)" }}>{sessionStats.cancelled}</div>
                <div style={{ fontSize:9, color:"var(--charcoal-xl)", marginTop:1 }}>{t("home.cancelledSessions")}</div>
              </div>
              <div style={{ background:"var(--amber-bg)", borderRadius:"var(--radius)", padding:"8px 6px", textAlign:"center" }}>
                <div style={{ fontFamily:"var(--font-d)", fontSize:20, fontWeight:800, color:"var(--amber)" }}>{sessionStats.charged}</div>
                <div style={{ fontSize:9, color:"var(--charcoal-xl)", marginTop:1 }}>{t("home.chargedCancelled")}</div>
              </div>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", marginTop:8, padding:"6px 4px 0", borderTop:"1px solid var(--border-lt)", fontSize:12, color:"var(--charcoal-xl)" }}>
              <span>{t("home.totalSessions")}: <strong style={{ color:"var(--charcoal)" }}>{sessionStats.total}</strong></span>
              <span>{t("home.scheduledSessions")}: <strong style={{ color:"var(--charcoal)" }}>{sessionStats.scheduled}</strong></span>
            </div>
          </div>
        </div>
        )}
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
                  <div className="row-avatar" style={{ background: getClientColor(p.colorIdx ?? i) }}>{p.initials}</div>
                  <div className="row-content">
                    <div className="row-title">{p.name}</div>
                    <div className="balance-bar"><div className="balance-fill" style={{ width:`${pct}%` }} /></div>
                    <div className="row-sub" style={{ marginTop:3 }}>${p.paid.toLocaleString()} {t("home.paidOf")} ${totalDue.toLocaleString()}</div>
                  </div>
                  <div className="row-right" style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
                    <div className="row-amount amount-owe">-${owed.toLocaleString()}</div>
                    <button className="btn btn-ghost" style={{ fontSize:11, height:26, padding:"0 8px", minHeight:26 }}
                      onClick={(e) => { e.stopPropagation(); openRecordPaymentModal(p); }}>
                      {t("finances.collect")}
                    </button>
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
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:20 }}>
                {[
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
