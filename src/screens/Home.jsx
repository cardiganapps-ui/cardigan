import { useState, useCallback } from "react";
import { getClientColor, TODAY, DAY_ORDER } from "../data/seedData";
import { IconClipboard, IconX, IconPlus } from "../components/Icons";
import { formatShortDate, SHORT_MONTHS } from "../utils/dates";
import { isTutorSession, tutorDisplayInitials, statusClass, statusLabel } from "../utils/sessions";
import { useEscape } from "../hooks/useEscape";
import { useCardigan } from "../context/CardiganContext";
import { SessionSheet } from "../components/SessionSheet";
import { useT } from "../i18n/index";

export function Home({ setScreen, userName }) {
  const { patients, upcomingSessions, payments, notes, tutorReminders, openRecordPaymentModal, onCancelSession, onMarkCompleted, deleteSession, rescheduleSession, updateSessionModality, mutating } = useCardigan();
  const { t, strings } = useT();
  const todayStr     = formatShortDate(TODAY);
  const todayDayName = DAY_ORDER[(TODAY.getDay() + 6) % 7];

  const totalOwed     = patients.reduce((s,p) => s + p.amountDue, 0);
  const activeCount   = patients.filter(p=>p.status==="active").length;
  const todaySessions = upcomingSessions.filter(s => s.date === todayStr);

  const currentMonthPayments = payments.filter(p => {
    if (p.created_at) {
      const d = new Date(p.created_at);
      return d.getFullYear() === TODAY.getFullYear() && d.getMonth() === TODAY.getMonth();
    }
    const parts = p.date.split(" ");
    return parts[1] === SHORT_MONTHS[TODAY.getMonth()];
  });
  const cobradoMes = currentMonthPayments.reduce((s,p) => s+p.amount, 0);

  const [selected, setSelected] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const closeSelected = useCallback(() => setSelected(null), []);
  useEscape(selected ? closeSelected : selectedSession ? () => setSelectedSession(null) : null);
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
      </div>

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
              const isVirtual = s.modality === "virtual";
              const avatarBg = tutor ? "var(--purple)" : isVirtual ? "var(--blue)" : getClientColor(s.colorIdx);
              return (
              <div className="row-item" key={s.id} onClick={() => setSelectedSession(s)}>
                <div className="row-avatar" style={{ background: avatarBg, border: tutor ? "2px dashed var(--purple-bg)" : undefined }}>
                  {tutor ? tutorDisplayInitials(s) : s.initials}
                </div>
                <div className="row-content">
                  <div className="row-title">
                    {s.patient}
                    {tutor && <span style={{ fontSize:10, fontWeight:700, color:"var(--purple)", marginLeft:6 }}>{t("sessions.tutor").toUpperCase()}</span>}
                  </div>
                  <div className="row-sub">
                    {s.time} - {(() => { const [h,m] = (s.time||"0:0").split(":"); const end = new Date(0,0,0,+h,+m); end.setMinutes(end.getMinutes()+(s.duration||60)); return `${String(end.getHours()).padStart(2,"0")}:${String(end.getMinutes()).padStart(2,"0")}`; })()}
                    <span style={{ fontSize:10, fontWeight:700, color: isVirtual ? "var(--blue)" : "var(--teal-dark)", marginLeft:6 }}>
                      {isVirtual ? t("sessions.virtual").toUpperCase() : t("sessions.presencial").toUpperCase()}
                    </span>
                  </div>
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
            : owingPatients.slice(0,4).map((p,i) => (
                <div className="row-item" key={p.id} onClick={() => setSelected(p)}>
                  <div className="row-avatar" style={{ background: getClientColor(p.colorIdx ?? i) }}>{p.initials}</div>
                  <div className="row-content">
                    <div className="row-title">{p.name}</div>
                  </div>
                  <div className="row-right">
                    <div className="row-amount amount-owe">${p.amountDue.toLocaleString()}</div>
                  </div>
                </div>
              ))}
        </div>
      </div>

      {/* Tutor reminders — only shown when at least one minor has tutor_frequency set */}
      {patients.some(p => p.tutor_frequency) && (
      <div className="section" style={{ paddingTop:20, paddingBottom:0 }}>
        <div className="section-header">
          <span className="section-title">{t("home.tutorReminders")}</span>
          {tutorReminders.length > 3 && <button className="see-all" onClick={() => setScreen("patients")}>{t("home.seeAll")}</button>}
        </div>
        <div className="card">
          {tutorReminders.length === 0
            ? emptyHint(t("home.tutorRemindersEmpty"))
            : tutorReminders.slice(0, 3).map(r => {
              const overdue = r.daysUntilDue < 0;
              const dueSoon = r.daysUntilDue >= 0 && r.daysUntilDue <= 7;
              return (
                <div className="row-item" key={r.patient.id} onClick={() => openPatient(r.patient.name)}>
                  <div className="row-avatar" style={{ background:"var(--purple)", border:"2px dashed var(--purple-bg)" }}>
                    {r.patient.initials}
                  </div>
                  <div className="row-content">
                    <div className="row-title">{r.patient.name}</div>
                    <div className="row-sub">
                      {r.lastTutorSession
                        ? `${t("home.lastTutorSession")}: ${r.lastTutorSession.date}`
                        : t("home.noTutorSession")}
                    </div>
                  </div>
                  <div className="row-right">
                    {overdue && (
                      <span className="badge badge-red" style={{ fontSize:10, whiteSpace:"nowrap" }}>
                        {r.daysSince != null ? t("home.overdueDays", { count: Math.abs(r.daysUntilDue) }) : t("home.noTutorSession")}
                      </span>
                    )}
                    {dueSoon && (
                      <span className="badge badge-amber" style={{ fontSize:10, whiteSpace:"nowrap" }}>
                        {t("home.dueThisWeek")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          }
        </div>
      </div>
      )}

      <div className="section" style={{ paddingTop:20, paddingBottom:12 }}>
        <div className="section-header">
          <span className="section-title">{t("home.recentNotes")}</span>
          <button className="see-all" onClick={() => setScreen("notes")}>{t("home.seeAll")}</button>
        </div>
        <div className="card">
          {(notes || []).length === 0
            ? emptyHint(t("home.emptyNotes"))
            : (notes || []).slice(0,3).map(n => {
              const pat = n.patient_id ? patients.find(p => p.id === n.patient_id) : null;
              const preview = n.content?.replace(/[*~#\[\]]/g, "").replace(/\n/g, " ").slice(0, 60) || "";
              return (
                <div className="row-item" key={n.id} onClick={() => pat && openPatient(pat.name)}>
                  <div className="row-icon" style={{ background:"var(--teal-pale)", color:"var(--teal-dark)" }}><IconClipboard size={18} /></div>
                  <div className="row-content">
                    <div className="row-title">{n.title || t("notes.noTitle")}</div>
                    <div className="row-sub">{pat ? pat.name : t("notes.generalNote")}{preview ? ` · ${preview}` : ""}</div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
      </div>
      </div>

      <SessionSheet
        session={selectedSession}
        patients={patients}
        notes={notes}
        onClose={() => setSelectedSession(null)}
        onCancelSession={onCancelSession}
        onMarkCompleted={onMarkCompleted}
        onDelete={deleteSession}
        onReschedule={rescheduleSession}
        onUpdateModality={updateSessionModality}
        mutating={mutating}
      />

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
                { label: t("sessions.regular"),         value:`${selected.day} ${t("home.atTime")} ${selected.time}` },
                { label: t("patients.rate"),            value:`$${selected.rate} ${t("expediente.perSession")}` },
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
