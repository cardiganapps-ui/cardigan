import { useState, useMemo, useCallback, useRef } from "react";
import { getClientColor } from "../data/seedData";
import { shortDateToISO, todayISO } from "../utils/dates";
import { IconClipboard, IconCalendar, IconUser, IconDocument, IconUpload, IconChevron } from "../components/Icons";
import { NoteEditor, NoteCard } from "../components/NoteEditor";
import { SessionSheet } from "../components/SessionSheet";
import { isTutorSession, statusClass } from "../utils/sessions";
import { isWordDoc } from "../utils/files";
import { DocumentList } from "../components/DocumentList";
import { DocumentViewer } from "../components/DocumentViewer";
import { HelpTip } from "../components/HelpTip";
import { useCardigan } from "../context/CardiganContext";
import { useLayer } from "../hooks/useLayer";
import { useT } from "../i18n/index";

export function PatientExpediente({
  patient, upcomingSessions, notes, payments, documents,
  onClose, onRecordPayment, onEdit, createSession, createNote, updateNote, deleteNote,
  uploadDocument, renameDocument, tagDocumentSession, deleteDocument, getDocumentUrl,
  mutating,
}) {
  const { t, strings } = useT();
  const { onCancelSession, onMarkCompleted, deleteSession, rescheduleSession } = useCardigan();
  useLayer("expediente", onClose);
  const [tab, setTab] = useState("resumen");
  const [editingNote, setEditingNote] = useState(null);
  // Session currently shown in the edit overlay (Sesiones tab).
  const [selectedSession, setSelectedSession] = useState(null);
  // When the user chooses "Adjuntar documento" from the session sheet we
  // stash the target session id here; the file input's onChange consumes it
  // so the upload is tagged to that session.
  const [pendingDocSessionId, setPendingDocSessionId] = useState(null);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  });
  const [dateTo, setDateTo] = useState(todayISO());

  // All sessions for this patient, sorted descending (most recent first) —
  // used by the Resumen stats which are order-independent. The Sesiones tab
  // derives its own upcoming/past split below.
  const pSessions = useMemo(() =>
    (upcomingSessions || [])
      .filter(s => s.patient_id === patient.id)
      .sort((a, b) => {
        const da = shortDateToISO(a.date), db = shortDateToISO(b.date);
        if (da !== db) return db.localeCompare(da);
        return (b.time || "").localeCompare(a.time || "");
      }),
    [upcomingSessions, patient.id]
  );

  // Sesiones tab: upcoming ascending (nearest first), past descending
  // (most recent first). Date + time are compared as ISO strings so ordering
  // is stable across days.
  const { upcomingPSessions, pastPSessions } = useMemo(() => {
    const todayIso = todayISO();
    const byDateTimeAsc = (a, b) => {
      const da = shortDateToISO(a.date), db = shortDateToISO(b.date);
      if (da !== db) return da.localeCompare(db);
      return (a.time || "").localeCompare(b.time || "");
    };
    const byDateTimeDesc = (a, b) => byDateTimeAsc(b, a);
    const upcoming = [];
    const past = [];
    for (const s of pSessions) {
      if (shortDateToISO(s.date) >= todayIso) upcoming.push(s);
      else past.push(s);
    }
    upcoming.sort(byDateTimeAsc);
    past.sort(byDateTimeDesc);
    return { upcomingPSessions: upcoming, pastPSessions: past };
  }, [pSessions]);

  const pNotes = useMemo(() =>
    (notes || []).filter(n => n.patient_id === patient.id),
    [notes, patient.id]
  );

  // All-time stats
  const allCompleted = pSessions.filter(s => s.status === "completed").length;
  const allCancelled = pSessions.filter(s => s.status === "cancelled").length;
  const allCharged = pSessions.filter(s => s.status === "charged").length;
  const allScheduled = pSessions.filter(s => s.status === "scheduled").length;

  // Date-filtered stats for the Resumen attendance card
  const filteredSessions = useMemo(() => {
    const now = todayISO();
    return pSessions.filter(s => {
      const iso = shortDateToISO(s.date);
      if (iso > now) return false; // only past/today
      if (dateFrom && iso < dateFrom) return false;
      if (dateTo && iso > dateTo) return false;
      return true;
    });
  }, [pSessions, dateFrom, dateTo]);

  const fTotal = filteredSessions.length;
  const fCompleted = filteredSessions.filter(s => s.status === "completed").length;
  const fCancelled = filteredSessions.filter(s => s.status === "cancelled").length;
  const fCharged = filteredSessions.filter(s => s.status === "charged").length;
  const fScheduled = filteredSessions.filter(s => s.status === "scheduled").length;
  const fResolved = fCompleted + fCancelled + fCharged;
  const fAttendanceRate = fResolved > 0 ? Math.round(fCompleted / fResolved * 100) : null;

  // Filtered financials
  const fBillableSessions = filteredSessions.filter(s => s.status === "completed" || s.status === "charged");
  const fVendido = fBillableSessions.reduce((sum, s) => sum + (s.rate != null ? s.rate : patient.rate), 0);

  const pPayments = useMemo(() =>
    (payments || []).filter(p => p.patient_id === patient.id),
    [payments, patient.id]
  );
  const fCobrado = useMemo(() => {
    return pPayments.reduce((sum, p) => {
      const iso = shortDateToISO(p.date);
      if (dateFrom && iso < dateFrom) return sum;
      if (dateTo && iso > dateTo) return sum;
      return sum + p.amount;
    }, 0);
  }, [pPayments, dateFrom, dateTo]);
  const fPeriodSaldo = fVendido - fCobrado;

  const handleSaveNote = useCallback(async ({ title, content }) => {
    if (editingNote?.id) {
      await updateNote(editingNote.id, { title, content });
    }
  }, [editingNote, updateNote]);

  const handleDeleteNote = useCallback(async () => {
    if (editingNote?.id) await deleteNote(editingNote.id);
  }, [editingNote, deleteNote]);

  const openNewNote = async (sessionId) => {
    const note = await createNote({ patientId: patient.id, sessionId: sessionId || null, title: "", content: "" });
    if (note) setEditingNote(note);
  };

  const openSessionNote = (session) => {
    const existing = pNotes.find(n => n.session_id === session.id);
    if (existing) {
      setEditingNote(existing);
    } else {
      openNewNote(session.id);
    }
  };

  // ── Documents state ──
  const pDocuments = useMemo(() =>
    (documents || []).filter(d => d.patient_id === patient.id)
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [documents, patient.id]
  );
  const [docSort, setDocSort] = useState("newest"); // newest | oldest | name
  const [docFilter, setDocFilter] = useState("all"); // all | image | pdf | doc
  const [uploading, setUploading] = useState(false);
  const [viewingDoc, setViewingDoc] = useState(null); // { doc, url }
  const fileInputRef = useRef(null);

  const sortedFilteredDocs = useMemo(() => {
    let docs = [...pDocuments];
    // filter
    if (docFilter === "image") docs = docs.filter(d => d.file_type?.startsWith("image/"));
    else if (docFilter === "pdf") docs = docs.filter(d => d.file_type === "application/pdf");
    else if (docFilter === "doc") docs = docs.filter(d => isWordDoc(d));
    // sort
    if (docSort === "oldest") docs.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    else if (docSort === "name") docs.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    // newest is default sort from pDocuments
    return docs;
  }, [pDocuments, docSort, docFilter]);

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    // Capture + clear the pending session id up front so subsequent uploads
    // (triggered from other entry points) don't inherit it.
    const sessionId = pendingDocSessionId;
    setPendingDocSessionId(null);
    if (files.length === 0) { if (fileInputRef.current) fileInputRef.current.value = ""; return; }
    const oversized = files.filter(f => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      alert(t("docs.sizeLimit", { names: oversized.map(f => f.name).join(", "), count: oversized.length }));
    }
    const valid = files.filter(f => f.size <= MAX_FILE_SIZE);
    if (valid.length === 0) { if (fileInputRef.current) fileInputRef.current.value = ""; return; }
    setUploading(true);
    for (const file of valid) {
      await uploadDocument({ patientId: patient.id, file, sessionId, name: file.name });
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Trigger the file input. Used by the Resumen "Documento" button, the
  // Documentos tab upload button, and the per-session "Adjuntar documento"
  // action in the session sheet (which also sets pendingDocSessionId).
  const triggerUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const attachDocToSession = useCallback((session) => {
    setPendingDocSessionId(session.id);
    // Close the session sheet while the native file picker is up — on
    // return, the user sees the uploaded file reflected in whatever tab
    // they were on.
    setSelectedSession(null);
    triggerUpload();
  }, [triggerUpload]);

  const openDocViewer = async (doc) => {
    const url = await getDocumentUrl(doc.file_path);
    if (!url) return;
    // Word docs can't be rendered in-browser — open externally
    if (isWordDoc(doc)) {
      window.open(url, "_blank");
      return;
    }
    setViewingDoc({ doc, url });
  };

  const tabs = [
    { k: "resumen", l: t("expediente.resumen"), Icon: IconUser },
    { k: "sesiones", l: t("expediente.sesiones"), Icon: IconCalendar },
    { k: "notas", l: t("expediente.notas"), Icon: IconClipboard },
    { k: "documentos", l: t("expediente.docs"), Icon: IconDocument },
  ];

  // Swipe-to-dismiss
  const dragRef = useRef(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  const onDragStart = (e) => {
    dragRef.current = { y: e.touches[0].clientY, active: false };
  };
  const onDragMove = (e) => {
    if (!dragRef.current) return;
    const dy = e.touches[0].clientY - dragRef.current.y;
    if (!dragRef.current.active) {
      if (dy > 8) { dragRef.current.active = true; setDragging(true); }
      else return;
    }
    if (dragRef.current.active && dy > 0) setDragY(dy * 0.6);
  };
  const onDragEnd = () => {
    if (!dragRef.current?.active) { dragRef.current = null; return; }
    dragRef.current = null;
    setDragging(false);
    if (dragY > 120) { onClose(); }
    setDragY(0);
  };

  return (
    <>
    {/* Backdrop */}
    <div className="expediente-open" onClick={onClose}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.35)", zIndex:"var(--z-expediente-bg)", animation:"fadeIn 0.4s ease" }} />

    {/* Card */}
    <div className="expediente-open expediente-desktop-panel"
      style={{
        position:"fixed", top:"calc(var(--sat, 44px))", left:0, right:0, bottom:0, zIndex:"var(--z-expediente)",
        display:"flex", flexDirection:"column",
        background:"var(--white)",
        borderRadius:"var(--radius-lg) var(--radius-lg) 0 0",
        boxShadow:"0 -4px 30px rgba(0,0,0,0.12)",
        animation: dragY > 0 ? undefined : "expedientePullUp 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
        transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
        transition: dragging ? "none" : "transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)",
        overflow:"hidden",
      }}>

      {/* Drag zone — covers handle + header */}
      <div onTouchStart={onDragStart} onTouchMove={onDragMove} onTouchEnd={onDragEnd}
        style={{ flexShrink:0, cursor:"grab", borderBottom:"1px solid var(--border-lt)" }}>

        {/* Drag handle (visual only) */}
        <div style={{ padding:"10px 0 0" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"var(--cream-deeper)", margin:"0 auto 8px" }} />
        </div>

        {/* Header */}
        <div style={{ padding:"0 16px 0" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={onClose} aria-label={t("back")}
            style={{ padding:6, background:"none", border:"none", cursor:"pointer", color:"var(--charcoal-lt)", flexShrink:0, transform:"rotate(180deg)" }}>
            <IconChevron size={20} />
          </button>
          <div className="row-avatar" style={{ background: getClientColor(patient.colorIdx), width:48, height:48, fontSize:16 }}>
            {patient.initials}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:"var(--font-d)", fontSize:18, fontWeight:800, color:"var(--charcoal)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{patient.name}</div>
            <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
              {patient.status === "active" ? t("patients.statusActive") : t("patients.statusEnded")} · {patient.day} {patient.time}
            </div>
            {(patient.birthdate || patient.start_date) && (
              <div style={{ fontSize:11, color:"var(--charcoal-lt)", marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                {patient.birthdate && (() => {
                  const birth = new Date(patient.birthdate + "T00:00:00");
                  const today = new Date();
                  let age = today.getFullYear() - birth.getFullYear();
                  const m = today.getMonth() - birth.getMonth();
                  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
                  return `${age} ${t("patients.yearsOld")} · ${birth.toLocaleDateString("es-MX", { day:"numeric", month:"short", year:"numeric" })}`;
                })()}
                {patient.birthdate && patient.start_date && " · "}
                {patient.start_date && `${t("patients.startDate")}: ${new Date(patient.start_date + "T00:00:00").toLocaleDateString("es-MX", { day:"numeric", month:"short", year:"numeric" })}`}
              </div>
            )}
          </div>
          <button onClick={() => onEdit(patient)}
            style={{ padding:"6px 14px", fontSize:12, fontWeight:600, borderRadius:"var(--radius-pill)", border:"1.5px solid var(--border)", background:"transparent", color:"var(--charcoal-md)", cursor:"pointer", fontFamily:"var(--font)", flexShrink:0 }}>
            {t("edit")}
          </button>
          <HelpTip tipsKey="help.expediente" />
        </div>
        {/* Tabs */}
        <div role="tablist" style={{ display:"flex", gap:0, marginTop:14 }}>
          {tabs.map(t => (
            <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)}
              style={{
                flex:1, padding:"10px 0 12px", fontSize:12, fontWeight:700,
                fontFamily:"var(--font)", color: tab === t.k ? "var(--charcoal)" : "var(--charcoal-xl)",
                background:"none", border:"none", borderBottom: tab === t.k ? "2px solid var(--charcoal)" : "2px solid transparent",
                cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:5,
              }}>
              <t.Icon size={14} /> {t.l}
            </button>
          ))}
        </div>
      </div>
      </div>

      {/* Content */}
      <div style={{ flex:1, overflowY:"auto", background:"var(--white)", borderRadius:0 }}>

        {/* ── RESUMEN ── */}
        {tab === "resumen" && (
          <div style={{ padding:"12px 14px" }}>
            {/* Date range filter — explicitly labeled so users understand it
                scopes the financials + attendance cards right below. */}
            <div className="card" style={{ padding:"10px 12px", marginBottom:10 }}>
              <div style={{ marginBottom:8 }}>
                <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)" }}>{t("expediente.period")}</div>
                <div style={{ fontSize:11, color:"var(--charcoal-lt)", marginTop:2 }}>{t("expediente.periodFilterSub")}</div>
              </div>
              <div style={{ display:"flex", gap:6, marginBottom:6, flexWrap:"wrap" }}>
                {[{l:t("periods.1m"),m:1},{l:t("periods.3m"),m:3},{l:t("periods.6m"),m:6},{l:t("periods.1y"),m:12}].map(p => {
                  const d = new Date(); d.setMonth(d.getMonth() - p.m);
                  const fromVal = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
                  const isActive = dateFrom === fromVal && dateTo === todayISO();
                  return (
                    <button key={p.m} onClick={() => { setDateFrom(fromVal); setDateTo(todayISO()); }}
                      style={{ padding:"5px 10px", fontSize:11, fontWeight:600, borderRadius:"var(--radius-pill)", border:"none", cursor:"pointer", fontFamily:"var(--font)",
                        background: isActive ? "var(--teal)" : "var(--cream)", color: isActive ? "white" : "var(--charcoal-md)" }}>
                      {p.l}
                    </button>
                  );
                })}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                <div>
                  <label style={{ fontSize:10, fontWeight:600, color:"var(--charcoal-xl)" }}>{t("periods.from")}</label>
                  <input type="date" className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    style={{ fontSize:12, padding:"6px 8px", marginTop:2 }} />
                </div>
                <div>
                  <label style={{ fontSize:10, fontWeight:600, color:"var(--charcoal-xl)" }}>{t("periods.to")}</label>
                  <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    style={{ fontSize:12, padding:"6px 8px", marginTop:2 }} />
                </div>
              </div>
            </div>

            {/* Financials — filtered */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10, alignItems:"stretch" }}>
              <div style={{ background:"var(--white)", borderRadius:"var(--radius)", padding:"10px 8px", textAlign:"center", display:"flex", flexDirection:"column", justifyContent:"center" }}>
                <div style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:4 }}>{t("finances.collected")}</div>
                <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--green)" }}>${fCobrado.toLocaleString()}</div>
              </div>
              <div style={{ background:"var(--white)", borderRadius:"var(--radius)", padding:"10px 8px", textAlign:"center", display:"flex", flexDirection:"column", justifyContent:"center" }}>
                <div style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:4 }}>{t("finances.balance")}</div>
                <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color: patient.amountDue > 0 ? "var(--red)" : "var(--green)" }}>${patient.amountDue.toLocaleString()}</div>
              </div>
            </div>

            {/* Attendance — filtered */}
            <div className="card" style={{ padding:"10px 12px", marginBottom:10 }}>
              {(() => {
                const fTutor = filteredSessions.filter(s => isTutorSession(s)).length;
                const showTutor = !!patient.parent && fTutor > 0;
                return (
                <>
                <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:8 }}>{t("expediente.attendance")}</div>
                <div style={{ display:"grid", gridTemplateColumns: showTutor ? "1fr 1fr" : "1fr 1fr 1fr", gap:8, marginBottom:8 }}>
                  <div style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"8px 6px", textAlign:"center" }}>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--charcoal)" }}>{fTotal}</div>
                    <div style={{ fontSize:9, color:"var(--charcoal-xl)", marginTop:1 }}>{t("expediente.programmed")}</div>
                  </div>
                  <div style={{ background:"var(--green-bg)", borderRadius:"var(--radius)", padding:"8px 6px", textAlign:"center" }}>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--green)" }}>{fCompleted}</div>
                    <div style={{ fontSize:9, color:"var(--charcoal-xl)", marginTop:1 }}>{t("expediente.attended")}</div>
                  </div>
                  <div style={{ background:"var(--red-bg)", borderRadius:"var(--radius)", padding:"8px 6px", textAlign:"center" }}>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--red)" }}>{fCancelled + fCharged}</div>
                    <div style={{ fontSize:9, color:"var(--charcoal-xl)", marginTop:1 }}>{t("expediente.missed")}</div>
                  </div>
                  {showTutor && (
                    <div style={{ background:"var(--purple-bg)", borderRadius:"var(--radius)", padding:"8px 6px", textAlign:"center" }}>
                      <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--purple)" }}>{fTutor}</div>
                      <div style={{ fontSize:9, color:"var(--charcoal-xl)", marginTop:1 }}>{t("sessions.tutor")}</div>
                    </div>
                  )}
                </div>
                </>);
              })()}
              {fCharged > 0 && (
                <div style={{ fontSize:11, color:"var(--amber)", marginBottom:8 }}>
                  {t("expediente.chargedCancelled", { count: fCharged })}
                </div>
              )}
              {fAttendanceRate !== null && (
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ flex:1, height:6, background:"var(--cream-dark)", borderRadius:3, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${fAttendanceRate}%`, background:"var(--green)", borderRadius:3 }} />
                  </div>
                  <span style={{ fontSize:11, fontWeight:700, color:"var(--charcoal-md)" }}>{fAttendanceRate}%</span>
                </div>
              )}
            </div>

            <div className="card" style={{ padding:0 }}>
              {[
                { label: t("sessions.tutor"), value: patient.parent || "—" },
                { label: t("sessions.regular"), value:`${patient.day} ${patient.time}` },
                { label: t("patients.rate"), value:`$${patient.rate} ${t("expediente.perSession")}` },
              ].map((row, i, arr) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", borderBottom: i < arr.length - 1 ? "1px solid var(--border-lt)" : "none" }}>
                  <span style={{ fontSize:13, color:"var(--charcoal-xl)" }}>{row.label}</span>
                  <span style={{ fontSize:13, fontWeight:600, color:"var(--charcoal)" }}>{row.value}</span>
                </div>
              ))}
            </div>

            <div style={{ marginTop:12, display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
              <button className="btn" style={{ height:44, fontSize:12, background:"var(--teal)", color:"white", boxShadow:"none" }} onClick={() => onRecordPayment(patient)} disabled={mutating}>
                {t("fab.payment")}
              </button>
              <button className="btn" style={{ height:44, fontSize:12, background:"var(--teal-pale)", color:"var(--teal-dark)", boxShadow:"none" }} onClick={() => openNewNote(null)}>
                {t("fab.note")}
              </button>
              <button className="btn" style={{ height:44, fontSize:12, background:"var(--teal-pale)", color:"var(--teal-dark)", boxShadow:"none" }} onClick={triggerUpload} disabled={uploading}>
                {uploading ? t("docs.uploading") : t("fab.document")}
              </button>
            </div>
          </div>
        )}

        {/* ── SESIONES ── */}
        {tab === "sesiones" && (
          <div style={{ padding:16 }}>
            {pSessions.length === 0 ? (
              <div className="card" style={{ padding:"32px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>
                {t("expediente.noSessions")}
              </div>
            ) : (
              <>
                {/* Upcoming — nearest first */}
                <SessionsSection
                  title={t("expediente.upcomingSessions")}
                  emptyLabel={t("expediente.noUpcomingSessions")}
                  sessions={upcomingPSessions}
                  pNotes={pNotes}
                  onSelect={setSelectedSession}
                  t={t}
                />
                {/* Past — most recent first */}
                {pastPSessions.length > 0 && (
                  <div style={{ marginTop:16 }}>
                    <SessionsSection
                      title={t("expediente.pastSessions")}
                      emptyLabel={t("expediente.noPastSessions")}
                      sessions={pastPSessions}
                      pNotes={pNotes}
                      onSelect={setSelectedSession}
                      t={t}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── NOTAS ── */}
        {tab === "notas" && (
          <div style={{ padding:16 }}>
            <button className="btn btn-primary" style={{ marginBottom:16 }} onClick={() => openNewNote(null)}>
              {t("notes.newNote")}
            </button>
            {pNotes.length === 0
              ? <div className="card" style={{ padding:"32px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>
                  {t("notes.noNotes")}
                </div>
              : <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {pNotes.map(n => {
                    const linkedSession = n.session_id ? pSessions.find(s => s.id === n.session_id) : null;
                    return (
                      <div key={n.id} className="card" style={{ overflow:"hidden" }}>
                        <NoteCard
                          note={n}
                          onClick={() => setEditingNote(n)}
                          sessionLabel={linkedSession ? `${linkedSession.date} · ${linkedSession.time}` : null}
                        />
                      </div>
                    );
                  })}
                </div>
            }
          </div>
        )}

        {/* ── DOCUMENTOS ── */}
        {tab === "documentos" && (
          <div style={{ padding:16 }}>
            <button className="btn btn-primary" style={{ marginBottom:12, display:"flex", alignItems:"center", justifyContent:"center", gap:6, width:"100%" }}
              onClick={triggerUpload} disabled={uploading}>
              <IconUpload size={16} />
              {uploading ? t("docs.uploading") : t("docs.upload")}
            </button>

            {/* Sort & Filter bar */}
            {pDocuments.length > 0 && (
              <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap" }}>
                {/* Sort */}
                <select value={docSort} onChange={e => setDocSort(e.target.value)}
                  style={{ flex:1, minWidth:0, fontSize:11, fontWeight:600, fontFamily:"var(--font)", padding:"6px 8px", borderRadius:"var(--radius)", border:"1px solid var(--border)", background:"var(--white)", color:"var(--charcoal-md)", cursor:"pointer" }}>
                  <option value="newest">{t("docs.newest")}</option>
                  <option value="oldest">{t("docs.oldest")}</option>
                  <option value="name">{t("docs.nameAZ")}</option>
                </select>
                {/* Filter */}
                <div style={{ display:"flex", gap:4 }}>
                  {[
                    { k:"all", l:t("docs.allTypes") },
                    { k:"image", l:t("docs.image") },
                    { k:"pdf", l:t("docs.pdf") },
                    { k:"doc", l:t("docs.word") },
                  ].map(f => (
                    <button key={f.k} onClick={() => setDocFilter(f.k)}
                      style={{ padding:"5px 10px", fontSize:10, fontWeight:600, borderRadius:"var(--radius-pill)", border:"none", cursor:"pointer", fontFamily:"var(--font)",
                        background: docFilter === f.k ? "var(--teal)" : "var(--cream)", color: docFilter === f.k ? "white" : "var(--charcoal-md)" }}>
                      {f.l}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <DocumentList
              documents={sortedFilteredDocs}
              sessions={pSessions}
              onOpen={openDocViewer}
              onRename={renameDocument}
              onTag={tagDocumentSession}
              onDelete={deleteDocument}
              emptyMessage={pDocuments.length === 0 ? t("docs.patientDocsEmpty") : t("docs.noResults")}
              variant="cards"
            />
          </div>
        )}
      </div>
    </div>

    {/* Always-mounted file input so Resumen/Sesiones/Docs can all trigger it. */}
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept="image/*,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      style={{ display:"none" }}
      onChange={handleFileUpload}
    />

    {/* Session edit sheet — opened from the Sesiones tab rows. Reuses the
        same SessionSheet used from Agenda, with an extra "Adjuntar
        documento" action wired to the shared file input. */}
    {selectedSession && (
      <SessionSheet
        session={selectedSession}
        patients={[patient]}
        notes={pNotes}
        onClose={() => setSelectedSession(null)}
        onOpenNote={(s) => { openSessionNote(s); setSelectedSession(null); }}
        onAttachDocument={attachDocToSession}
        onCancelSession={async (session, charge, reason) => {
          const ok = await onCancelSession(session, charge, reason);
          if (ok) setSelectedSession(prev => (prev ? { ...prev, status: charge ? "charged" : "cancelled", cancel_reason: reason || null } : prev));
          return ok;
        }}
        onMarkCompleted={async (session, overrideStatus) => {
          const st = overrideStatus || "completed";
          const ok = await onMarkCompleted(session, overrideStatus);
          if (ok) setSelectedSession(prev => (prev ? { ...prev, status: st, cancel_reason: null } : prev));
          return ok;
        }}
        onDelete={async (id) => { await deleteSession(id); setSelectedSession(null); }}
        onReschedule={async (id, date, time) => {
          const ok = await rescheduleSession(id, date, time);
          if (ok) setSelectedSession(prev => prev ? { ...prev, date, time, status: "scheduled" } : prev);
          return ok;
        }}
        mutating={mutating}
      />
    )}

    {viewingDoc && (
      <DocumentViewer
        doc={viewingDoc.doc} url={viewingDoc.url}
        linkedSession={viewingDoc.doc.session_id ? pSessions.find(s => s.id === viewingDoc.doc.session_id) : null}
        onClose={() => setViewingDoc(null)}
      />
    )}
    {editingNote && (
      <NoteEditor
        note={editingNote}
        onSave={handleSaveNote}
        onDelete={editingNote.id ? handleDeleteNote : undefined}
        onClose={() => setEditingNote(null)}
      />
    )}
    </>
  );
}

/* ── SESSIONS SECTION ──
   Renders one labeled block of session rows in the Sesiones tab. Each row
   shows the date + time on a single line, a status pill, and a "note
   attached" hint when applicable. Tapping a row opens the SessionSheet
   edit overlay via `onSelect`. */
function SessionsSection({ title, emptyLabel, sessions, pNotes, onSelect, t }) {
  if (sessions.length === 0) {
    return (
      <>
        <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:6 }}>{title}</div>
        <div className="card" style={{ padding:"20px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:12 }}>
          {emptyLabel}
        </div>
      </>
    );
  }
  return (
    <>
      <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:6 }}>{title}</div>
      <div className="card">
        {sessions.map(s => {
          const tutor = isTutorSession(s);
          const hasNote = pNotes.some(n => n.session_id === s.id);
          return (
            <div className="row-item" key={s.id} onClick={() => onSelect(s)} style={{ cursor:"pointer" }}>
              <div style={{ flex:1, minWidth:0 }}>
                {/* Date + time on a single line, always. */}
                <div style={{
                  fontFamily:"var(--font-d)", fontSize:13, fontWeight:700, color:"var(--charcoal)",
                  whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                }}>
                  {s.date} · {s.time}
                </div>
                <div style={{ marginTop:3, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                  <span className={`session-status ${statusClass(s.status)}`} style={{ fontSize:10 }}>
                    {t(`sessions.${s.status}`)}
                  </span>
                  {tutor && (
                    <span style={{ fontSize:9, fontWeight:700, color:"var(--purple)", textTransform:"uppercase" }}>
                      {t("sessions.tutor")}
                    </span>
                  )}
                  {hasNote && (
                    <span style={{ fontSize:10, color:"var(--teal-dark)", fontWeight:600, display:"inline-flex", alignItems:"center", gap:3 }}>
                      <IconClipboard size={11} />
                      {t("notes.noteAttached")}
                    </span>
                  )}
                </div>
              </div>
              <span className="row-chevron" style={{ flexShrink:0 }}>›</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
