import { useState, useCallback, useRef, useMemo } from "react";
import { getClientColor, TODAY, DAY_ORDER } from "../data/seedData";
import { IconClipboard, IconX, IconPlus, IconSun } from "../components/Icons";
import { formatShortDate, SHORT_MONTHS } from "../utils/dates";
import { isTutorSession, tutorDisplayInitials, statusClass, statusLabel, railClass } from "../utils/sessions";
import { useEscape } from "../hooks/useEscape";
import { useSheetDrag } from "../hooks/useSheetDrag";
import { useCardigan } from "../context/CardiganContext";
import { SessionSheet } from "../components/SessionSheet";
import { NewSessionSheet } from "../components/sheets/NewSessionSheet";
import { NoteEditor } from "../components/NoteEditor";
import { Avatar } from "../components/Avatar";
import { useT } from "../i18n/index";

/* ── Compute next working day for the "Mañana" carousel panel ── */
function getNextDay(today, sessions) {
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // On Friday (day 5), check if Sat/Sun have sessions. If not, skip to Monday.
  if (today.getDay() === 5) {
    const sat = new Date(today); sat.setDate(sat.getDate() + 1);
    const sun = new Date(today); sun.setDate(sun.getDate() + 2);
    const satStr = formatShortDate(sat);
    const sunStr = formatShortDate(sun);
    const hasSatSessions = sessions.some(s => s.date === satStr);
    const hasSunSessions = sessions.some(s => s.date === sunStr);
    if (!hasSatSessions && !hasSunSessions) {
      const monday = new Date(today);
      monday.setDate(monday.getDate() + 3);
      return monday;
    }
  }
  // On Saturday (day 6), same idea: if Sunday has no sessions, skip to Monday.
  if (today.getDay() === 6) {
    const sun = new Date(today); sun.setDate(sun.getDate() + 1);
    const sunStr = formatShortDate(sun);
    const hasSunSessions = sessions.some(s => s.date === sunStr);
    if (!hasSunSessions) {
      const monday = new Date(today);
      monday.setDate(monday.getDate() + 2);
      return monday;
    }
  }
  return tomorrow;
}

export function Home({ setScreen, userName }) {
  const { patients, upcomingSessions, payments, notes, tutorReminders, openRecordPaymentModal, onCancelSession, onMarkCompleted, deleteSession, rescheduleSession, updateSessionModality, updateSessionRate, updateCancelReason, createSession, updateNote, deleteNote, readOnly, mutating, setAgendaView, requestFabAction, openExpediente } = useCardigan();
  const { t, strings } = useT();
  const todayStr     = formatShortDate(TODAY);
  const todayDayName = DAY_ORDER[(TODAY.getDay() + 6) % 7];

  const totalOwed     = patients.reduce((s,p) => s + p.amountDue, 0);
  const activeCount   = patients.filter(p=>p.status==="active").length;
  const todaySessions = upcomingSessions.filter(s => s.date === todayStr).sort((a, b) => (a.time || "").localeCompare(b.time || ""));

  // Next-day carousel data
  const nextDay = useMemo(() => getNextDay(TODAY, upcomingSessions), [upcomingSessions]);
  const nextDayStr = formatShortDate(nextDay);
  const nextDayName = DAY_ORDER[(nextDay.getDay() + 6) % 7];
  const nextDaySessions = useMemo(() =>
    upcomingSessions.filter(s => s.date === nextDayStr).sort((a, b) => (a.time || "").localeCompare(b.time || "")),
    [upcomingSessions, nextDayStr]
  );
  // Label: "Mañana" if it's actually tomorrow, otherwise the day name
  const diffDays = Math.round((nextDay - TODAY) / 86400000);
  const nextDayLabel = diffDays === 1 ? t("home.tomorrow") : nextDayName;

  // Carousel swipe state
  const [carouselPage, setCarouselPage] = useState(0); // 0 = today, 1 = next day
  const carouselRef = useRef(null);
  const [carouselOffset, setCarouselOffset] = useState(0);
  const [carouselSwiping, setCarouselSwiping] = useState(false);
  const [carouselSettling, setCarouselSettling] = useState(false);

  const onCarouselTouchStart = useCallback((e) => {
    // Keep a 50px dead zone so the left-edge drawer gesture wins — with
    // App.jsx's 20px drawer threshold, this gives a 30px gap where
    // neither fires, preventing the "drawer opens mid-swipe" bug.
    if (e.touches[0].clientX < 50) return;
    carouselRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, active: false };
  }, []);

  const onCarouselTouchMove = useCallback((e) => {
    if (!carouselRef.current) return;
    const dx = e.touches[0].clientX - carouselRef.current.x;
    const dy = e.touches[0].clientY - carouselRef.current.y;
    if (!carouselRef.current.active) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        carouselRef.current.active = true;
        setCarouselSwiping(true);
      } else if (Math.abs(dy) > 10) {
        carouselRef.current = null;
        return;
      } else return;
    }
    if (carouselRef.current.active) setCarouselOffset(dx);
  }, []);

  const onCarouselTouchEnd = useCallback((e) => {
    if (!carouselRef.current?.active) { carouselRef.current = null; return; }
    const dx = e.changedTouches[0].clientX - carouselRef.current.x;
    carouselRef.current = null;
    setCarouselSwiping(false);

    const triggered = Math.abs(dx) > 60;
    setCarouselSettling(true);
    if (triggered) {
      if (dx < -60 && carouselPage === 0) {
        setCarouselPage(1);
      } else if (dx > 60 && carouselPage === 1) {
        setCarouselPage(0);
      }
    }
    setCarouselOffset(0);
    setTimeout(() => setCarouselSettling(false), 380);
  }, [carouselPage]);

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
  const [tutorBooking, setTutorBooking] = useState(null);
  const [editingNote, setEditingNote] = useState(null);
  const closeSelected = useCallback(() => setSelected(null), []);
  useEscape(selected ? closeSelected : selectedSession ? () => setSelectedSession(null) : tutorBooking ? () => setTutorBooking(null) : editingNote ? () => setEditingNote(null) : null);
  const { scrollRef: selectedScrollRef, setPanelEl: setSelectedPanelEl, panelHandlers: selectedPanelHandlers } = useSheetDrag(closeSelected);
  const setSelectedPanel = (el) => { selectedScrollRef.current = el; setSelectedPanelEl(el); };

  // Mirrors Notes.jsx so the NoteEditor's handleClose always sees a stable
  // save/delete pair and always reaches its onClose() cleanup — critical in
  // demo mode where the underlying mutations are no-ops.
  const handleSaveNote = useCallback(async ({ title, content }) => {
    if (editingNote?.id) await updateNote(editingNote.id, { title, content });
  }, [editingNote, updateNote]);
  const handleDeleteNote = useCallback(async () => {
    if (editingNote?.id) await deleteNote(editingNote.id);
  }, [editingNote, deleteNote]);
  const handleCloseNote = useCallback(() => setEditingNote(null), []);
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

  const renderSessionRow = (s) => {
    const tutor = isTutorSession(s);
    const isVirtual = s.modality === "virtual";
    const avatarBg = tutor ? "var(--purple)" : isVirtual ? "var(--blue)" : getClientColor(s.colorIdx);
    return (
      <div className={`row-item session-row ${railClass(s.status)}`} key={s.id} onClick={() => setSelectedSession(s)}>
        <Avatar initials={tutor ? tutorDisplayInitials(s) : s.initials} color={avatarBg} size="md" />
        <div className="row-content">
          <div className="row-title">
            {s.patient}
            {tutor && <span style={{ fontSize:"var(--text-eyebrow)", fontWeight:700, color:"var(--purple)", marginLeft:6, textTransform:"uppercase" }}>{t("sessions.tutor")}</span>}
          </div>
          <div className="row-sub">
            {s.time} - {(() => { const [h,m] = (s.time||"0:0").split(":"); const end = new Date(0,0,0,+h,+m); end.setMinutes(end.getMinutes()+(s.duration||60)); return `${String(end.getHours()).padStart(2,"0")}:${String(end.getMinutes()).padStart(2,"0")}`; })()}
            <span style={{ fontSize:"var(--text-eyebrow)", fontWeight:700, color: isVirtual ? "var(--blue)" : "var(--teal-dark)", marginLeft:6, textTransform:"uppercase" }}>
              {isVirtual ? t("sessions.virtual") : t("sessions.presencial")}
            </span>
          </div>
        </div>
        <div className="row-right">
          <span className={`session-status ${statusClass(s.status)}`}>{statusLabel(s.status)}</span>
        </div>
      </div>
    );
  };

  // Carousel transform — 50% because translateX(%) is relative to the element's
  // own width (200% of parent), so 50% of element = 100% of parent = one panel.
  const baseShift = -carouselPage * 50;
  const dragPx = carouselSwiping ? carouselOffset : 0;
  const carouselTransform = `translateX(calc(${baseShift}% + ${dragPx}px))`;
  const carouselTransition = carouselSwiping
    ? "none"
    : carouselSettling
      ? "transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)"
      : "none";

  return (
    <div className="page">
      {patients.length === 0 && !readOnly && (
        <div style={{ padding:"24px 16px 8px", textAlign:"center" }}>
          <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-xl)", fontWeight:800, color:"var(--charcoal)", marginBottom:6 }}>
            {userName ? `${t("home.welcome")}, ${userName.split(" ")[0]}` : t("home.welcome")}
          </div>
          <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)", lineHeight:1.5, marginBottom:14 }}>
            {t("patients.addFirst")}
          </div>
          <button
            type="button"
            onClick={() => requestFabAction?.("patient")}
            className="btn btn-primary"
            style={{ display:"inline-flex", alignItems:"center", gap:8, width:"auto", padding:"10px 22px", height:"auto", minHeight:0 }}>
            <IconPlus size={16} /> {t("patients.addFirstCta")}
          </button>
        </div>
      )}

      <div className="kpi-grid-desktop" data-tour="kpis" style={{ padding:"16px 16px 4px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        <button type="button" className="kpi-card" onClick={() => setScreen("agenda")}>
          <div className="kpi-label">{t("home.sessionsToday")}</div>
          <div className="kpi-value">{todaySessions.length}</div>
          <div className="kpi-meta">{todayDayName} {todayStr}</div>
        </button>
        <button type="button" className="kpi-card" onClick={() => setScreen("patients")}>
          <div className="kpi-label">{t("patients.title")}</div>
          <div className="kpi-value">{activeCount}</div>
          <div className="kpi-meta">{activeCount === 0 ? t("patients.noPatients").toLowerCase() : t("patients.active").toLowerCase()}</div>
        </button>
        <button type="button" className="kpi-card" onClick={() => setScreen("finances")}>
          <div className="kpi-label">{t("finances.monthlyCollected")}</div>
          <div className="kpi-value">${cobradoMes.toLocaleString()}</div>
          <div className="kpi-meta">{strings.months[TODAY.getMonth()]}</div>
        </button>
        <button type="button" className="kpi-card" onClick={() => setScreen("finances")}>
          <div className="kpi-label">{t("finances.outstanding")}</div>
          <div className="kpi-value" style={{ color: totalOwed > 0 ? "var(--red)" : undefined }}>${totalOwed.toLocaleString()}</div>
          <div className="kpi-meta">{owingPatients.length} {t("home.patientCount", { count: owingPatients.length })}</div>
        </button>
      </div>

      <div className="home-columns">
      <div className="section home-col-main">
        <div className="section-header home-carousel">
          <span className="section-title" style={{ transition:"opacity 0.3s" }}>
            {carouselPage === 0
              ? <>{t("sessions.today")} — {todayDayName} {todayStr}</>
              : nextDayLabel === nextDayName
                ? <>{nextDayName} {nextDayStr}</>
                : <>{nextDayLabel} — {nextDayName} {nextDayStr}</>
            }
          </span>
          <button className="see-all" onClick={() => { setAgendaView("week"); setScreen("agenda"); }}>{t("home.seeWeek")}</button>
        </div>

        {/* Mobile/tablet: swipe carousel */}
        <div className="home-carousel">
        <div style={{ overflow: "hidden", borderRadius: "var(--radius-lg)", touchAction: "pan-y" }}
          onTouchStart={onCarouselTouchStart} onTouchMove={onCarouselTouchMove} onTouchEnd={onCarouselTouchEnd}>
          <div style={{
            display: "flex", width: "200%",
            transform: carouselTransform,
            transition: carouselTransition,
            willChange: carouselSwiping || carouselSettling ? "transform" : undefined,
          }}>
            {/* Panel 1: Today */}
            <div style={{ width: "50%", flexShrink: 0 }}>
              <div className="card">
                {todaySessions.length === 0
                  ? <div style={{ padding:"28px 20px", textAlign:"center" }}>
                      <div style={{ marginBottom:10, color:"var(--teal-light)" }}><IconSun size={32} /></div>
                      <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:700, color:"var(--charcoal)", marginBottom:4 }}>{t("sessions.freeDay")}</div>
                      <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)" }}>{t("sessions.freeDayMessage")}</div>
                    </div>
                  : todaySessions.map(renderSessionRow)
                }
              </div>
            </div>
            {/* Panel 2: Next day */}
            <div style={{ width: "50%", flexShrink: 0 }}>
              <div className="card">
                {nextDaySessions.length === 0
                  ? <div style={{ padding:"28px 20px", textAlign:"center" }}>
                      <div style={{ marginBottom:10, color:"var(--teal-light)" }}><IconSun size={32} /></div>
                      <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:700, color:"var(--charcoal)", marginBottom:4 }}>{t("sessions.freeDay")}</div>
                      <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)" }}>{t("sessions.freeDayMessage")}</div>
                    </div>
                  : nextDaySessions.map(renderSessionRow)
                }
              </div>
            </div>
          </div>
        </div>

        {/* Carousel dots + hint */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, padding:"8px 0 2px" }}>
          <button onClick={() => { if (carouselPage !== 0) { setCarouselSettling(true); setCarouselPage(0); setTimeout(() => setCarouselSettling(false), 380); } }} aria-label={t("sessions.today")}
            style={{ width:7, height:7, minHeight:0, minWidth:0, borderRadius:"50%", border:"none", padding:0, cursor:"pointer",
              background: carouselPage === 0 ? "var(--teal)" : "var(--cream-deeper)",
              transition:"all 0.3s ease",
              transform: carouselPage === 0 ? "scale(1)" : "scale(0.8)",
            }} />
          <button onClick={() => { if (carouselPage !== 1) { setCarouselSettling(true); setCarouselPage(1); setTimeout(() => setCarouselSettling(false), 380); } }} aria-label={nextDayLabel}
            style={{ width:7, height:7, minHeight:0, minWidth:0, borderRadius:"50%", border:"none", padding:0, cursor:"pointer",
              background: carouselPage === 1 ? "var(--teal)" : "var(--cream-deeper)",
              transition:"all 0.3s ease",
              transform: carouselPage === 1 ? "scale(1)" : "scale(0.8)",
            }} />
        </div>
        </div>

        {/* Desktop (≥1024px): side-by-side static panels, no carousel */}
        <div className="home-two-panel-desktop" style={{ position:"relative" }}>
          <button className="see-all home-two-panel-see-all" onClick={() => { setAgendaView("week"); setScreen("agenda"); }}>{t("home.seeWeek")}</button>
          <div>
            <div className="home-panel-meta">{t("sessions.today")} · {todayDayName} {todayStr}</div>
            <div className="card">
              {todaySessions.length === 0
                ? <div style={{ padding:"28px 20px", textAlign:"center" }}>
                    <div style={{ marginBottom:10, color:"var(--teal-light)" }}><IconSun size={32} /></div>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:700, color:"var(--charcoal)", marginBottom:4 }}>{t("sessions.freeDay")}</div>
                    <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)" }}>{t("sessions.freeDayMessage")}</div>
                  </div>
                : todaySessions.map(renderSessionRow)
              }
            </div>
          </div>
          <div>
            <div className="home-panel-meta">{nextDayLabel === nextDayName ? <>{nextDayName} {nextDayStr}</> : <>{nextDayLabel} · {nextDayName} {nextDayStr}</>}</div>
            <div className="card">
              {nextDaySessions.length === 0
                ? <div style={{ padding:"28px 20px", textAlign:"center" }}>
                    <div style={{ marginBottom:10, color:"var(--teal-light)" }}><IconSun size={32} /></div>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:700, color:"var(--charcoal)", marginBottom:4 }}>{t("sessions.freeDay")}</div>
                    <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)" }}>{t("sessions.freeDayMessage")}</div>
                  </div>
                : nextDaySessions.map(renderSessionRow)
              }
            </div>
          </div>
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
                  <Avatar initials={p.initials} color={getClientColor(p.colorIdx ?? i)} size="md" />
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
              const hasScheduled = !!r.nextTutorSession;
              const lastLine = r.lastTutorSession
                ? `${t("home.lastTutorSession")}: ${r.lastTutorSession.date}`
                : t("home.noTutorSession");
              const scheduledLine = hasScheduled
                ? `${t("home.nextTutorSession")}: ${r.nextTutorSession.date}`
                : null;
              const handleClick = () => {
                if (readOnly) return openPatient(r.patient.name);
                if (hasScheduled) return setSelectedSession(r.nextTutorSession);
                setTutorBooking(r.patient);
              };
              return (
                <div className="row-item" key={r.patient.id} onClick={handleClick}>
                  <Avatar initials={r.patient.initials} color="var(--purple)" size="md" />
                  <div className="row-content">
                    <div className="row-title">{r.patient.name}</div>
                    <div className="row-sub">
                      {scheduledLine
                        ? <>{scheduledLine}<span style={{ color:"var(--charcoal-xl)" }}> · {lastLine}</span></>
                        : lastLine}
                    </div>
                  </div>
                  <div className="row-right">
                    {hasScheduled && (
                      <span className="badge badge-teal" style={{ whiteSpace:"nowrap" }}>
                        {t("home.scheduledBadge")}
                      </span>
                    )}
                    {!hasScheduled && overdue && (
                      <span className="badge badge-red" style={{ whiteSpace:"nowrap" }}>
                        {r.daysSince != null ? t("home.overdueDays", { count: Math.abs(r.daysUntilDue) }) : t("home.noTutorSession")}
                      </span>
                    )}
                    {!hasScheduled && dueSoon && (
                      <span className="badge badge-amber" style={{ whiteSpace:"nowrap" }}>
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
          <button className="see-all" onClick={() => setScreen("archivo")}>{t("home.seeAll")}</button>
        </div>
        <div className="card">
          {(notes || []).length === 0
            ? emptyHint(t("home.emptyNotes"))
            : (notes || []).slice(0,3).map(n => {
              const pat = n.patient_id ? patients.find(p => p.id === n.patient_id) : null;
              const preview = n.content?.replace(/[*~#\[\]]/g, "").replace(/\n/g, " ").slice(0, 60) || "";
              return (
                <div className="row-item" key={n.id} onClick={() => setEditingNote(n)}>
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

      {tutorBooking && (
        <NewSessionSheet
          onClose={() => setTutorBooking(null)}
          onSubmit={createSession}
          patients={patients}
          sessions={upcomingSessions}
          mutating={mutating}
          initialPatientName={tutorBooking.name}
          initialSessionType="tutor"
        />
      )}

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
        onUpdateRate={updateSessionRate}
        onUpdateCancelReason={updateCancelReason}
        mutating={mutating}
      />

      {editingNote && (
        <NoteEditor
          note={editingNote}
          onSave={handleSaveNote}
          onDelete={editingNote.id ? handleDeleteNote : undefined}
          onClose={handleCloseNote}
        />
      )}

      {selected && (
        <div className="sheet-overlay" onClick={() => setSelected(null)}>
          <div ref={setSelectedPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...selectedPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("home.balanceDetail")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => setSelected(null)}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              {/* Tappable patient block — matches SessionSheet identity row */}
              <div className="flex items-center gap-3" style={{ marginBottom:20, cursor:"pointer", WebkitTapHighlightColor:"transparent" }}
                onClick={() => { const p = selected; setSelected(null); openExpediente(p); }}>
                <Avatar initials={selected.initials} color={getClientColor(selected.colorIdx ?? 0)} size="lg" />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-lg)", fontWeight:800, color:"var(--charcoal)" }}>
                    {selected.name}
                  </div>
                  <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)", marginTop:2 }}>
                    {selected.day} {t("home.atTime")} {selected.time}
                  </div>
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:20 }}>
                {[
                  { label: t("finances.collected"), value:`$${selected.paid.toLocaleString()}`, color:"var(--green)" },
                  { label: t("finances.balance"), value:`$${selected.amountDue.toLocaleString()}`, color: selected.amountDue>0?"var(--red)":"var(--charcoal-xl)" },
                ].map((s,i) => (
                  <div key={i} className="stat-tile" style={{ textAlign:"center" }}>
                    <div className="stat-tile-label">{s.label}</div>
                    <div className="stat-tile-val" style={{ color:s.color||"var(--charcoal)", fontSize:"var(--text-lg)" }}>{s.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 0", borderBottom:"1px solid var(--border-lt)" }}>
                <span style={{ fontSize:"var(--text-md)", color:"var(--charcoal-xl)" }}>{t("patients.rate")}</span>
                <span style={{ fontSize:"var(--text-md)", fontWeight:600, color:"var(--charcoal)" }}>${selected.rate} {t("expediente.perSession")}</span>
              </div>
              <div style={{ marginTop:20 }}>
                <button className="btn btn-primary-teal" onClick={() => openRecordPaymentModal(selected)} disabled={mutating}>
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
