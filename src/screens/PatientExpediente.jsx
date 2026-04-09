import { useState, useMemo, useCallback, useRef } from "react";
import { clientColors } from "../data/seedData";
import { shortDateToISO, todayISO } from "../utils/dates";
import { IconX, IconClipboard, IconCalendar, IconUser, IconEdit, IconDocument, IconUpload, IconTrash, IconTag, IconFilter, IconChevron } from "../components/Icons";
import { NoteEditor, NoteCard } from "../components/NoteEditor";
import { isTutorSession, statusLabel, statusClass } from "../utils/sessions";

export function PatientExpediente({
  patient, upcomingSessions, notes, payments, documents,
  onClose, onRecordPayment, onEdit, createSession, createNote, updateNote, deleteNote,
  uploadDocument, renameDocument, tagDocumentSession, deleteDocument, getDocumentUrl,
  mutating,
}) {
  const [tab, setTab] = useState("resumen");
  const [editingNote, setEditingNote] = useState(null);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  });
  const [dateTo, setDateTo] = useState(todayISO());

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
  const fBillable = filteredSessions.filter(s => s.status === "completed" || s.status === "charged").length;
  const fVendido = fBillable * patient.rate;

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

  // Note editor overlay
  if (editingNote) {
    return (
      <NoteEditor
        note={editingNote}
        onSave={handleSaveNote}
        onDelete={editingNote.id ? handleDeleteNote : undefined}
        onClose={() => setEditingNote(null)}
      />
    );
  }

  // ── Documents state ──
  const pDocuments = useMemo(() =>
    (documents || []).filter(d => d.patient_id === patient.id)
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [documents, patient.id]
  );
  const [docSort, setDocSort] = useState("newest"); // newest | oldest | name
  const [docFilter, setDocFilter] = useState("all"); // all | image | pdf | doc
  const [renamingDoc, setRenamingDoc] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [taggingDoc, setTaggingDoc] = useState(null);
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [viewingDoc, setViewingDoc] = useState(null); // { doc, url }
  const fileInputRef = useRef(null);

  const sortedFilteredDocs = useMemo(() => {
    let docs = [...pDocuments];
    // filter
    if (docFilter === "image") docs = docs.filter(d => d.file_type?.startsWith("image/"));
    else if (docFilter === "pdf") docs = docs.filter(d => d.file_type === "application/pdf");
    else if (docFilter === "doc") docs = docs.filter(d => d.file_type?.includes("word") || d.file_type?.includes("document") || d.name?.endsWith(".doc") || d.name?.endsWith(".docx"));
    // sort
    if (docSort === "oldest") docs.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    else if (docSort === "name") docs.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    // newest is default sort from pDocuments
    return docs;
  }, [pDocuments, docSort, docFilter]);

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const oversized = files.filter(f => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      alert(`${oversized.map(f => f.name).join(", ")} excede${oversized.length > 1 ? "n" : ""} el límite de 10 MB`);
    }
    const valid = files.filter(f => f.size <= MAX_FILE_SIZE);
    if (valid.length === 0) { if (fileInputRef.current) fileInputRef.current.value = ""; return; }
    setUploading(true);
    for (const file of valid) {
      await uploadDocument({ patientId: patient.id, file, sessionId: null, name: file.name });
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRename = async () => {
    if (renamingDoc && renameValue.trim()) {
      await renameDocument(renamingDoc, renameValue.trim());
    }
    setRenamingDoc(null);
    setRenameValue("");
  };

  const handleTag = async (docId, sessionId) => {
    await tagDocumentSession(docId, sessionId);
    setTaggingDoc(null);
  };

  const handleDeleteDoc = async (id) => {
    await deleteDocument(id);
    setConfirmDeleteDoc(null);
  };

  const openDocViewer = async (doc) => {
    const url = await getDocumentUrl(doc.file_path);
    if (!url) return;
    const t = doc.file_type || "";
    // Word docs can't be rendered in-browser — open externally
    if (t.includes("word") || t.includes("document") || doc.name?.endsWith(".doc") || doc.name?.endsWith(".docx")) {
      window.open(url, "_blank");
      return;
    }
    setViewingDoc({ doc, url });
  };

  const getFileIcon = (doc) => {
    const t = doc.file_type || "";
    if (t.startsWith("image/")) return "\u{1F5BC}";
    if (t === "application/pdf") return "\u{1F4C4}";
    if (t.includes("word") || t.includes("document")) return "\u{1F4DD}";
    return "\u{1F4CE}";
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const tabs = [
    { k: "resumen", l: "Resumen", Icon: IconUser },
    { k: "sesiones", l: "Sesiones", Icon: IconCalendar },
    { k: "notas", l: "Notas", Icon: IconClipboard },
    { k: "documentos", l: "Docs", Icon: IconDocument },
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
    <div className="expediente-open"
      style={{
        position:"fixed", top:"calc(var(--sat, 44px))", left:0, right:0, bottom:0, zIndex:"var(--z-expediente)",
        display:"flex", flexDirection:"column",
        background:"var(--nav-bg)",
        borderRadius:"20px 20px 0 0",
        boxShadow:"0 -4px 30px rgba(0,0,0,0.25)",
        animation: dragY > 0 ? undefined : "expedientePullUp 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
        transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
        transition: dragging ? "none" : "transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)",
        overflow:"hidden",
      }}>

      {/* Drag zone — covers handle + header */}
      <div onTouchStart={onDragStart} onTouchMove={onDragMove} onTouchEnd={onDragEnd}
        style={{ flexShrink:0, cursor:"grab" }}>

        {/* Drag handle (visual only) */}
        <div style={{ padding:"10px 0 0" }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"rgba(255,255,255,0.3)", margin:"0 auto 8px" }} />
        </div>

        {/* Header */}
        <div style={{ padding:"0 16px 0" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={onClose}
            style={{ padding:6, background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.7)", flexShrink:0, transform:"rotate(180deg)" }}>
            <IconChevron size={20} />
          </button>
          <div className="row-avatar" style={{ background: clientColors[(patient.colorIdx || 0) % clientColors.length], width:48, height:48, fontSize:16 }}>
            {patient.initials}
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:"var(--font-d)", fontSize:18, fontWeight:800, color:"white" }}>{patient.name}</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", marginTop:2 }}>
              {patient.status === "active" ? "Activo" : "Finalizado"} · {patient.day} {patient.time}
            </div>
          </div>
          <button onClick={() => onEdit(patient)}
            style={{ padding:"6px 14px", fontSize:12, fontWeight:600, borderRadius:"var(--radius-pill)", border:"1.5px solid rgba(255,255,255,0.3)", background:"transparent", color:"rgba(255,255,255,0.8)", cursor:"pointer", fontFamily:"var(--font)", flexShrink:0 }}>
            Editar
          </button>
        </div>
        {/* Tabs */}
        <div style={{ display:"flex", gap:0, marginTop:14 }}>
          {tabs.map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
              style={{
                flex:1, padding:"10px 0 12px", fontSize:12, fontWeight:700,
                fontFamily:"var(--font)", color: tab === t.k ? "white" : "rgba(255,255,255,0.4)",
                background:"none", border:"none", borderBottom: tab === t.k ? "2px solid white" : "2px solid transparent",
                cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:5,
              }}>
              <t.Icon size={14} /> {t.l}
            </button>
          ))}
        </div>
      </div>
      </div>

      {/* Content */}
      <div style={{ flex:1, overflowY:"auto", background:"var(--cream)", borderRadius:0 }}>

        {/* ── RESUMEN ── */}
        {tab === "resumen" && (
          <div style={{ padding:"12px 14px" }}>
            {/* Date range filter */}
            <div className="card" style={{ padding:"10px 12px", marginBottom:10 }}>
              <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:6 }}>Período</div>
              <div style={{ display:"flex", gap:6, marginBottom:6, flexWrap:"wrap" }}>
                {[{l:"1 mes",m:1},{l:"3 meses",m:3},{l:"6 meses",m:6},{l:"1 año",m:12}].map(p => {
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
                  <label style={{ fontSize:10, fontWeight:600, color:"var(--charcoal-xl)" }}>Desde</label>
                  <input type="date" className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    style={{ fontSize:12, padding:"6px 8px", marginTop:2 }} />
                </div>
                <div>
                  <label style={{ fontSize:10, fontWeight:600, color:"var(--charcoal-xl)" }}>Hasta</label>
                  <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    style={{ fontSize:12, padding:"6px 8px", marginTop:2 }} />
                </div>
              </div>
            </div>

            {/* Financials — filtered */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:10, alignItems:"stretch" }}>
              <div style={{ background:"var(--white)", borderRadius:"var(--radius)", padding:"10px 8px", textAlign:"center", display:"flex", flexDirection:"column", justifyContent:"center" }}>
                <div style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:4 }}>Vendido</div>
                <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--charcoal)" }}>${fVendido.toLocaleString()}</div>
              </div>
              <div style={{ background:"var(--white)", borderRadius:"var(--radius)", padding:"10px 8px", textAlign:"center", display:"flex", flexDirection:"column", justifyContent:"center" }}>
                <div style={{ fontSize:12, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:4 }}>Cobrado</div>
                <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--green)" }}>${fCobrado.toLocaleString()}</div>
              </div>
              <div style={{ background:"var(--white)", borderRadius:"var(--radius)", padding:"10px 8px", textAlign:"center" }}>
                <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:4 }}>Saldo</div>
                <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:800, color: fPeriodSaldo > 0 ? "var(--red)" : "var(--charcoal-xl)" }}>${fPeriodSaldo.toLocaleString()}</div>
                <div style={{ fontSize:9, color:"var(--charcoal-xl)", marginTop:1 }}>período</div>
                <div style={{ borderTop:"1px solid var(--border-lt)", marginTop:5, paddingTop:4 }}>
                  <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:800, color: patient.amountDue > 0 ? "var(--red)" : "var(--green)" }}>${patient.amountDue.toLocaleString()}</div>
                  <div style={{ fontSize:9, color:"var(--charcoal-xl)", marginTop:1 }}>actual</div>
                </div>
              </div>
            </div>

            {/* Attendance — filtered */}
            <div className="card" style={{ padding:"10px 12px", marginBottom:10 }}>
              {(() => {
                const fTutor = filteredSessions.filter(s => isTutorSession(s)).length;
                const showTutor = !!patient.parent && fTutor > 0;
                return (
                <>
                <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:8 }}>Asistencia</div>
                <div style={{ display:"grid", gridTemplateColumns: showTutor ? "1fr 1fr" : "1fr 1fr 1fr", gap:8, marginBottom:8 }}>
                  <div style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"8px 6px", textAlign:"center" }}>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--charcoal)" }}>{fTotal}</div>
                    <div style={{ fontSize:9, color:"var(--charcoal-xl)", marginTop:1 }}>Programadas</div>
                  </div>
                  <div style={{ background:"var(--green-bg)", borderRadius:"var(--radius)", padding:"8px 6px", textAlign:"center" }}>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--green)" }}>{fCompleted}</div>
                    <div style={{ fontSize:9, color:"var(--charcoal-xl)", marginTop:1 }}>Asistió</div>
                  </div>
                  <div style={{ background:"var(--red-bg)", borderRadius:"var(--radius)", padding:"8px 6px", textAlign:"center" }}>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--red)" }}>{fCancelled + fCharged}</div>
                    <div style={{ fontSize:9, color:"var(--charcoal-xl)", marginTop:1 }}>No asistió</div>
                  </div>
                  {showTutor && (
                    <div style={{ background:"var(--purple-bg)", borderRadius:"var(--radius)", padding:"8px 6px", textAlign:"center" }}>
                      <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--purple)" }}>{fTutor}</div>
                      <div style={{ fontSize:9, color:"var(--charcoal-xl)", marginTop:1 }}>Tutor</div>
                    </div>
                  )}
                </div>
                </>);
              })()}
              {fCharged > 0 && (
                <div style={{ fontSize:11, color:"var(--amber)", marginBottom:8 }}>
                  {fCharged} cancelada{fCharged !== 1 ? "s" : ""} cobrada{fCharged !== 1 ? "s" : ""}
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
                { label:"Tutor", value: patient.parent || "—" },
                { label:"Sesión regular", value:`${patient.day} a las ${patient.time}` },
                { label:"Tarifa", value:`$${patient.rate} por sesión` },
              ].map((row, i, arr) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", borderBottom: i < arr.length - 1 ? "1px solid var(--border-lt)" : "none" }}>
                  <span style={{ fontSize:13, color:"var(--charcoal-xl)" }}>{row.label}</span>
                  <span style={{ fontSize:13, fontWeight:600, color:"var(--charcoal)" }}>{row.value}</span>
                </div>
              ))}
            </div>

            <div style={{ marginTop:12, display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              <button className="btn" style={{ height:44, fontSize:12, background:"var(--teal)", color:"white", boxShadow:"none" }} onClick={() => onRecordPayment(patient)} disabled={mutating}>
                Pago
              </button>
              <button className="btn" style={{ height:44, fontSize:12, background:"var(--teal-pale)", color:"var(--teal-dark)", boxShadow:"none" }} onClick={() => openNewNote(null)}>
                Nota
              </button>
            </div>
          </div>
        )}

        {/* ── SESIONES ── */}
        {tab === "sesiones" && (
          <div style={{ padding:16 }}>
            {pSessions.length === 0
              ? <div className="card" style={{ padding:"32px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>
                  Sin sesiones registradas
                </div>
              : <div className="card">
                  {pSessions.map(s => {
                    const tutor = isTutorSession(s);
                    const hasNote = pNotes.some(n => n.session_id === s.id);
                    return (
                      <div className="row-item" key={s.id} onClick={() => openSessionNote(s)} style={{ cursor:"pointer" }}>
                        <div style={{ width:44, textAlign:"center", flex:"none" }}>
                          <div style={{ fontFamily:"var(--font-d)", fontSize:13, fontWeight:800, color:"var(--charcoal)" }}>{s.date}</div>
                          <div style={{ fontSize:10, color:"var(--charcoal-xl)" }}>{s.time}</div>
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:"var(--charcoal)", display:"flex", alignItems:"center", gap:4 }}>
                            {tutor && <span style={{ fontSize:9, fontWeight:700, color:"var(--purple)", textTransform:"uppercase" }}>Tutor</span>}
                            <span className={`session-status ${statusClass(s.status)}`} style={{ fontSize:10 }}>{statusLabel(s.status)}</span>
                          </div>
                          {hasNote && <div style={{ fontSize:11, color:"var(--teal-dark)", marginTop:2 }}>Nota adjunta</div>}
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                          <IconClipboard size={14} style={{ color: hasNote ? "var(--teal-dark)" : "var(--charcoal-xl)" }} />
                          <span className="row-chevron">›</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
            }
          </div>
        )}

        {/* ── NOTAS ── */}
        {tab === "notas" && (
          <div style={{ padding:16 }}>
            <button className="btn btn-primary" style={{ marginBottom:16 }} onClick={() => openNewNote(null)}>
              + Nueva nota
            </button>
            {pNotes.length === 0
              ? <div className="card" style={{ padding:"32px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>
                  Las notas del paciente aparecerán aquí
                </div>
              : <div className="card">
                  {pNotes.map(n => {
                    const linkedSession = n.session_id ? pSessions.find(s => s.id === n.session_id) : null;
                    return (
                      <div key={n.id}>
                        {linkedSession && (
                          <div style={{ padding:"6px 16px 0", fontSize:10, color:"var(--teal-dark)", fontWeight:600 }}>
                            Sesión {linkedSession.date} · {linkedSession.time}
                          </div>
                        )}
                        <NoteCard note={n} onClick={() => setEditingNote(n)} />
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
            {/* Upload button */}
            <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              style={{ display:"none" }} onChange={handleFileUpload} />
            <button className="btn btn-primary" style={{ marginBottom:12, display:"flex", alignItems:"center", justifyContent:"center", gap:6, width:"100%" }}
              onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              <IconUpload size={16} />
              {uploading ? "Subiendo..." : "Subir documento"}
            </button>

            {/* Sort & Filter bar */}
            {pDocuments.length > 0 && (
              <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap" }}>
                {/* Sort */}
                <select value={docSort} onChange={e => setDocSort(e.target.value)}
                  style={{ flex:1, minWidth:0, fontSize:11, fontWeight:600, fontFamily:"var(--font)", padding:"6px 8px", borderRadius:"var(--radius)", border:"1px solid var(--border)", background:"var(--white)", color:"var(--charcoal-md)", cursor:"pointer" }}>
                  <option value="newest">Más reciente</option>
                  <option value="oldest">Más antiguo</option>
                  <option value="name">Nombre A-Z</option>
                </select>
                {/* Filter */}
                <div style={{ display:"flex", gap:4 }}>
                  {[
                    { k:"all", l:"Todos" },
                    { k:"image", l:"Imagen" },
                    { k:"pdf", l:"PDF" },
                    { k:"doc", l:"Word" },
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

            {/* Documents list */}
            {sortedFilteredDocs.length === 0
              ? <div className="card" style={{ padding:"32px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>
                  {pDocuments.length === 0 ? "Los documentos del paciente aparecerán aquí" : "Sin resultados para este filtro"}
                </div>
              : <div className="card" style={{ padding:0 }}>
                  {sortedFilteredDocs.map((doc, i) => {
                    const linkedSession = doc.session_id ? pSessions.find(s => s.id === doc.session_id) : null;
                    const isRenaming = renamingDoc === doc.id;
                    const isConfirmingDelete = confirmDeleteDoc === doc.id;
                    const isTagging = taggingDoc === doc.id;
                    return (
                      <div key={doc.id} style={{ borderBottom: i < sortedFilteredDocs.length - 1 ? "1px solid var(--border-lt)" : "none" }}>
                        {/* Session tag */}
                        {linkedSession && (
                          <div style={{ padding:"6px 14px 0", fontSize:10, color:"var(--teal-dark)", fontWeight:600 }}>
                            Sesión {linkedSession.date} · {linkedSession.time}
                          </div>
                        )}
                        <div style={{ display:"flex", alignItems:"center", padding:"10px 14px", gap:10 }}>
                          {/* File icon */}
                          <div style={{ fontSize:24, lineHeight:1, flexShrink:0 }}>{getFileIcon(doc)}</div>
                          {/* Name & info */}
                          <div style={{ flex:1, minWidth:0 }}>
                            {isRenaming ? (
                              <div style={{ display:"flex", gap:4 }}>
                                <input className="input" value={renameValue} onChange={e => setRenameValue(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") { setRenamingDoc(null); setRenameValue(""); } }}
                                  autoFocus style={{ fontSize:12, padding:"4px 6px", flex:1 }} />
                                <button onClick={handleRename} style={{ padding:"4px 8px", fontSize:11, fontWeight:600, borderRadius:"var(--radius)", border:"none", background:"var(--teal)", color:"white", cursor:"pointer" }}>OK</button>
                              </div>
                            ) : (
                              <>
                                <div style={{ fontSize:13, fontWeight:600, color:"var(--teal-dark)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", cursor:"pointer" }}
                                  onClick={() => openDocViewer(doc)}>
                                  {doc.name}
                                </div>
                                <div style={{ fontSize:10, color:"var(--charcoal-xl)", marginTop:2 }}>
                                  {formatFileSize(doc.file_size)}
                                  {doc.created_at && ` · ${new Date(doc.created_at).toLocaleDateString("es-MX", { day:"numeric", month:"short", year:"numeric" })}`}
                                </div>
                              </>
                            )}
                          </div>
                          {/* Actions */}
                          {!isRenaming && (
                            <div style={{ display:"flex", gap:2, flexShrink:0 }}>
                              <button onClick={() => { setRenamingDoc(doc.id); setRenameValue(doc.name || ""); }}
                                style={{ padding:6, background:"none", border:"none", cursor:"pointer", color:"var(--charcoal-xl)" }} title="Renombrar">
                                <IconEdit size={14} />
                              </button>
                              <button onClick={() => setTaggingDoc(taggingDoc === doc.id ? null : doc.id)}
                                style={{ padding:6, background:"none", border:"none", cursor:"pointer", color: doc.session_id ? "var(--teal-dark)" : "var(--charcoal-xl)" }} title="Vincular a sesión">
                                <IconTag size={14} />
                              </button>
                              {isConfirmingDelete ? (
                                <div style={{ display:"flex", gap:2 }}>
                                  <button onClick={() => handleDeleteDoc(doc.id)}
                                    style={{ padding:"4px 8px", fontSize:10, fontWeight:700, borderRadius:"var(--radius)", border:"none", background:"var(--red)", color:"white", cursor:"pointer" }}>Sí</button>
                                  <button onClick={() => setConfirmDeleteDoc(null)}
                                    style={{ padding:"4px 8px", fontSize:10, fontWeight:700, borderRadius:"var(--radius)", border:"1px solid var(--border)", background:"var(--white)", color:"var(--charcoal-md)", cursor:"pointer" }}>No</button>
                                </div>
                              ) : (
                                <button onClick={() => setConfirmDeleteDoc(doc.id)}
                                  style={{ padding:6, background:"none", border:"none", cursor:"pointer", color:"var(--charcoal-xl)" }} title="Eliminar">
                                  <IconTrash size={14} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        {/* Tag to session dropdown */}
                        {isTagging && (
                          <div style={{ padding:"0 14px 10px" }}>
                            <div style={{ fontSize:10, fontWeight:600, color:"var(--charcoal-xl)", marginBottom:4 }}>Vincular a sesión:</div>
                            <select value={doc.session_id || ""} onChange={e => handleTag(doc.id, e.target.value || null)}
                              style={{ width:"100%", fontSize:11, fontFamily:"var(--font)", padding:"6px 8px", borderRadius:"var(--radius)", border:"1px solid var(--border)", background:"var(--white)", color:"var(--charcoal-md)" }}>
                              <option value="">Sin vincular</option>
                              {pSessions.map(s => (
                                <option key={s.id} value={s.id}>{s.date} · {s.time} — {statusLabel(s.status)}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
            }
          </div>
        )}
      </div>
    </div>

    {/* ── Document Viewer Overlay ── */}
    {viewingDoc && (() => {
      const { doc, url } = viewingDoc;
      const isImage = doc.file_type?.startsWith("image/");
      const isPdf = doc.file_type === "application/pdf";
      const linkedSession = doc.session_id ? pSessions.find(s => s.id === doc.session_id) : null;
      return (
        <>
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:"var(--z-doc-viewer-bg)", animation:"fadeIn 0.2s ease" }}
            onClick={() => setViewingDoc(null)} />
          <div style={{
            position:"fixed", top:"calc(var(--sat, 44px))", left:0, right:0, bottom:0, zIndex:"var(--z-doc-viewer)",
            display:"flex", flexDirection:"column", background:"var(--cream)",
            borderRadius:"20px 20px 0 0", overflow:"hidden",
            animation:"expedientePullUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
          }}>
            {/* Header */}
            <div style={{ background:"var(--nav-bg)", padding:"12px 16px", flexShrink:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <button onClick={() => setViewingDoc(null)}
                  style={{ padding:6, background:"none", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.7)", flexShrink:0, transform:"rotate(180deg)" }}>
                  <IconChevron size={20} />
                </button>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:800, color:"white", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {doc.name}
                  </div>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.5)", marginTop:1 }}>
                    {formatFileSize(doc.file_size)}
                    {linkedSession && ` · Sesión ${linkedSession.date}`}
                  </div>
                </div>
                <a href={url} target="_blank" rel="noopener noreferrer"
                  style={{ padding:"6px 12px", fontSize:11, fontWeight:600, borderRadius:"var(--radius-pill)", border:"1.5px solid rgba(255,255,255,0.3)", background:"transparent", color:"rgba(255,255,255,0.8)", cursor:"pointer", fontFamily:"var(--font)", textDecoration:"none", flexShrink:0 }}>
                  Abrir
                </a>
              </div>
            </div>
            {/* Content */}
            <div style={{ flex:1, overflow:"auto", display:"flex", alignItems:"center", justifyContent:"center", background: isImage ? "#1a1a1a" : "var(--cream)" }}>
              {isImage && (
                <img src={url} alt={doc.name}
                  style={{ maxWidth:"100%", maxHeight:"100%", objectFit:"contain" }} />
              )}
              {isPdf && (
                <iframe src={url} title={doc.name}
                  style={{ width:"100%", height:"100%", border:"none" }} />
              )}
              {!isImage && !isPdf && (
                <div style={{ textAlign:"center", padding:32, color:"var(--charcoal-xl)" }}>
                  <div style={{ fontSize:48, marginBottom:12 }}>{getFileIcon(doc)}</div>
                  <div style={{ fontSize:14, fontWeight:600, color:"var(--charcoal)", marginBottom:4 }}>{doc.name}</div>
                  <div style={{ fontSize:12, marginBottom:16 }}>Vista previa no disponible</div>
                  <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ display:"inline-flex", textDecoration:"none" }}>
                    Descargar archivo
                  </a>
                </div>
              )}
            </div>
          </div>
        </>
      );
    })()}
    </>
  );
}
