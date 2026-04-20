import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { getClientColor } from "../data/seedData";
import { shortDateToISO, todayISO } from "../utils/dates";
import { formatPhoneMX, phoneHref, emailHref } from "../utils/contact";
import { IconClipboard, IconCalendar, IconUser, IconDollar, IconUpload, IconChevron, IconPhone, IconMail } from "../components/Icons";
import { NoteEditor } from "../components/NoteEditor";
import { SessionSheet } from "../components/SessionSheet";
import { isTutorSession } from "../utils/sessions";
import { isWordDoc } from "../utils/files";
import { DocumentViewer } from "../components/DocumentViewer";
import { HelpTip } from "../components/HelpTip";
import { Avatar } from "../components/Avatar";
import { useCardigan } from "../context/CardiganContext";
import { useLayer } from "../hooks/useLayer";
import { useT } from "../i18n/index";

import { ResumenTab } from "./expediente/ResumenTab";
import { SesionesTab } from "./expediente/SesionesTab";
import { FinanzasTab } from "./expediente/FinanzasTab";
import { ArchivoTab } from "./expediente/ArchivoTab";

export function PatientExpediente({
  patient, upcomingSessions, notes, payments, documents,
  onClose, onRecordPayment, onEdit, createSession, createNote, updateNote, deleteNote,
  uploadDocument, renameDocument, tagDocumentSession, deleteDocument, getDocumentUrl,
  mutating,
  layout = "overlay",
}) {
  const inline = layout === "inline";
  const { t, strings } = useT();
  const { onCancelSession, onMarkCompleted, deleteSession, rescheduleSession, updateSessionModality, updateSessionRate, updateCancelReason, deletePayment, readOnly } = useCardigan();

  // ── Enter/close animation state ──
  // `entering` is true for the first paint so the panel mounts at
  // translateY(100%); a rAF flips it to false on the next frame so the
  // CSS transition to translateY(0) plays. `closing` flips the panel
  // back to translateY(100%); we listen for the panel's transitionend to
  // call the parent's onClose and unmount, avoiding setTimeout races.
  const [entering, setEntering] = useState(true);
  const [closing, setClosing] = useState(false);
  const closedRef = useRef(false);

  // Refs for state/props that must be read from a stable callback — the
  // onClose prop from Patients.jsx is an inline arrow (new reference every
  // render), so depending on it directly would reset the safety timeout
  // on every context update and prevent close from ever firing.
  const onCloseRef = useRef(onClose);
  const enteringRef = useRef(true);
  useEffect(() => { onCloseRef.current = onClose; });
  useEffect(() => { enteringRef.current = entering; }, [entering]);

  useEffect(() => {
    // Double-rAF guarantees the browser has painted the initial
    // translateY(100%) frame before we transition to 0 — otherwise React
    // can batch both into one paint and the transition never plays.
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setEntering(false));
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const finishClose = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    onCloseRef.current();
  }, []);

  const startClose = useCallback(() => {
    if (closedRef.current) return;
    // Inline mode has no slide animation, so transitionend never fires.
    // Same story if the panel never rose into view (rare: user closes
    // within ~32ms of mount before the entering flip). Unmount immediately
    // in both cases.
    if (inline || enteringRef.current) {
      finishClose();
      return;
    }
    setClosing((c) => (c ? c : true));
  }, [finishClose, inline]);

  // Safety net: if transitionend never fires (interrupted, tab unfocused,
  // etc.) unmount after slightly longer than the close duration. Depends
  // ONLY on `closing` — reading onClose via ref keeps this effect from
  // resetting every time Patients.jsx re-renders.
  useEffect(() => {
    if (!closing) return;
    const id = setTimeout(finishClose, 420);
    return () => clearTimeout(id);
  }, [closing, finishClose]);

  useLayer(inline ? null : "expediente", inline ? null : startClose);
  const [tab, setTab] = useState("resumen");
  const [editingNote, setEditingNote] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [pendingDocSessionId, setPendingDocSessionId] = useState(null);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  });
  const [dateTo, setDateTo] = useState(todayISO());

  // Session filter state (sesiones tab — also set by Resumen tile clicks)
  const [sessStatusFilter, setSessStatusFilter] = useState("all");
  const [sessDateFrom, setSessDateFrom] = useState(null);
  const [sessDateTo, setSessDateTo] = useState(null);

  // ── Shared memos ──
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

  const sessCounts = useMemo(() => {
    let completed = 0, cancelled = 0, charged = 0, scheduled = 0, tutor = 0, regular = 0;
    for (const s of pSessions) {
      if (s.status === "completed") completed++;
      else if (s.status === "cancelled") cancelled++;
      else if (s.status === "charged") charged++;
      else if (s.status === "scheduled") scheduled++;
      if (isTutorSession(s)) tutor++; else regular++;
    }
    return { completed, cancelled, charged, scheduled, tutor, regular, total: pSessions.length };
  }, [pSessions]);

  const filteredPSessions = useMemo(() => {
    return pSessions.filter(s => {
      if (sessStatusFilter !== "all") {
        if (sessStatusFilter === "cancelled_any") {
          if (s.status !== "cancelled" && s.status !== "charged") return false;
        } else if (s.status !== sessStatusFilter) {
          return false;
        }
      }
      if (sessDateFrom || sessDateTo) {
        const iso = shortDateToISO(s.date);
        if (sessDateFrom && iso < sessDateFrom) return false;
        if (sessDateTo && iso > sessDateTo) return false;
      }
      return true;
    });
  }, [pSessions, sessStatusFilter, sessDateFrom, sessDateTo]);

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
    for (const s of filteredPSessions) {
      if (shortDateToISO(s.date) >= todayIso) upcoming.push(s);
      else past.push(s);
    }
    upcoming.sort(byDateTimeAsc);
    past.sort(byDateTimeDesc);
    return { upcomingPSessions: upcoming, pastPSessions: past };
  }, [filteredPSessions]);

  const pNotes = useMemo(() =>
    (notes || []).filter(n => n.patient_id === patient.id),
    [notes, patient.id]
  );

  const earliestISO = pSessions.length > 0 ? shortDateToISO(pSessions[pSessions.length - 1].date) : null;

  const filteredSessions = useMemo(() => {
    const now = todayISO();
    return pSessions.filter(s => {
      const iso = shortDateToISO(s.date);
      if (iso > now) return false;
      if (dateFrom && iso < dateFrom) return false;
      if (dateTo && iso > dateTo) return false;
      return true;
    });
  }, [pSessions, dateFrom, dateTo]);

  const pPayments = useMemo(() =>
    (payments || []).filter(p => p.patient_id === patient.id),
    [payments, patient.id]
  );

  // ── Note callbacks ──
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
  const [uploading, setUploading] = useState(false);
  const [viewingDoc, setViewingDoc] = useState(null);
  const fileInputRef = useRef(null);

  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
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

  const triggerUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const attachDocToSession = useCallback((session) => {
    setPendingDocSessionId(session.id);
    setSelectedSession(null);
    triggerUpload();
  }, [triggerUpload]);

  const openDocViewer = async (doc) => {
    const url = await getDocumentUrl(doc.file_path);
    if (!url) return;
    if (isWordDoc(doc)) {
      window.open(url, "_blank");
      return;
    }
    setViewingDoc({ doc, url });
  };

  // ── Navigation callbacks for Resumen → other tabs ──
  const goToSesiones = useCallback((statusFilter) => {
    setSessStatusFilter(statusFilter);
    setSessDateFrom(dateFrom);
    setSessDateTo(dateTo);
    setTab("sesiones");
  }, [dateFrom, dateTo]);

  const goToArchivo = useCallback(() => setTab("archivo"), []);

  // ── Tabs config ──
  const tabs = [
    { k: "resumen", l: t("expediente.resumen"), Icon: IconUser },
    { k: "sesiones", l: t("expediente.sesiones"), Icon: IconCalendar },
    { k: "finanzas", l: t("finances.payments"), Icon: IconDollar },
    { k: "archivo", l: t("expediente.archivo"), Icon: IconClipboard },
  ];

  // ── Horizontal swipe between tabs ──
  // Pattern mirrors the Home carousel: 60px threshold, must be strongly
  // horizontal (|dx| > |dy|) so vertical scroll inside the tab body keeps
  // working. Advances one tab per gesture; stops at the ends (no wrap).
  const tabSwipeRef = useRef(null);
  const onTabContentTouchStart = (e) => {
    if (inline) return;
    // Avoid conflicting with the drag-to-close handle (which already
    // fires onDragStart when contentRef is scrolled to top).
    tabSwipeRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      active: false,
    };
  };
  const onTabContentTouchMove = (e) => {
    if (!tabSwipeRef.current) return;
    const dx = e.touches[0].clientX - tabSwipeRef.current.x;
    const dy = e.touches[0].clientY - tabSwipeRef.current.y;
    if (!tabSwipeRef.current.active) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.6) {
        tabSwipeRef.current.active = true;
      } else if (Math.abs(dy) > 10) {
        tabSwipeRef.current = null;
      }
    }
  };
  const onTabContentTouchEnd = (e) => {
    if (!tabSwipeRef.current?.active) { tabSwipeRef.current = null; return; }
    const dx = e.changedTouches[0].clientX - tabSwipeRef.current.x;
    tabSwipeRef.current = null;
    if (Math.abs(dx) < 60) return;
    const i = tabs.findIndex(tx => tx.k === tab);
    const next = dx < 0 ? Math.min(tabs.length - 1, i + 1) : Math.max(0, i - 1);
    if (next !== i) setTab(tabs[next].k);
  };

  // ── Swipe-to-dismiss ──
  const dragRef = useRef(null);
  const contentRef = useRef(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  const onDragStart = (e) => {
    dragRef.current = { y: e.touches[0].clientY, active: false };
  };

  // Delegate to the drag gesture only when the content is scrolled to the
  // top — otherwise the user is scrolling the inner list, not pulling the
  // sheet down. Same pattern as the handle drag zone above.
  const onContentTouchStart = (e) => {
    const el = contentRef.current;
    if (!el || el.scrollTop > 0) return;
    onDragStart(e);
  };
  const onDragMove = (e) => {
    if (!dragRef.current) return;
    const dy = e.touches[0].clientY - dragRef.current.y;
    if (!dragRef.current.active) {
      if (dy > 8) { dragRef.current.active = true; setDragging(true); }
      else return;
    }
    if (dragRef.current.active && dy > 0) {
      // Prevent the outer PullToRefresh (which sees the portaled expediente
      // as a descendant in React's event tree) from interpreting this
      // downward swipe as a refresh gesture.
      e.stopPropagation();
      setDragY(dy * 0.6);
    }
  };
  const onDragEnd = (e) => {
    if (!dragRef.current?.active) { dragRef.current = null; return; }
    dragRef.current = null;
    setDragging(false);
    e?.stopPropagation?.();
    if (dragY > 120) {
      startClose();
    } else {
      setDragY(0);
    }
  };

  return (
    <>
    {/* Backdrop (overlay mode only) */}
    {!inline && (
      <div className="expediente-open" onClick={startClose}
        style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.35)", zIndex:"var(--z-expediente-bg)",
          opacity: entering || closing ? 0 : 1,
          transition: "opacity 0.34s ease",
          pointerEvents: closing ? "none" : undefined,
        }} />
    )}

    {/* Card */}
    <div className={inline ? "expediente-inline" : "expediente-open expediente-desktop-panel"}
      onTransitionEnd={inline ? undefined : (e) => {
        if (!closing) return;
        if (e.target !== e.currentTarget) return;
        if (e.propertyName !== "transform") return;
        finishClose();
      }}
      style={inline ? {
        display:"flex", flexDirection:"column", flex:1, minHeight:0,
        background:"var(--white)", overflow:"hidden",
      } : {
        position:"fixed", top:"calc(var(--sat, 44px))", bottom:0, zIndex:"var(--z-expediente)",
        display:"flex", flexDirection:"column",
        background:"var(--white)",
        boxShadow:"var(--shadow-lg)",
        // Unified transform source of truth. Priority: closing > dragging > entering > rest.
        transform: closing
          ? "translateY(100%)"
          : dragY > 0 ? `translateY(${dragY}px)`
          : entering ? "translateY(100%)"
          : "translateY(0)",
        transition: dragging
          ? "none"
          : closing
            ? "transform 0.34s cubic-bezier(0.55, 0.06, 0.68, 0.19)"
            : "transform 0.62s cubic-bezier(0.32, 0.72, 0, 1)",
        willChange: "transform",
        overflow:"hidden",
      }}>

      {/* Drag zone — covers handle + header */}
      <div onTouchStart={inline ? undefined : onDragStart} onTouchMove={inline ? undefined : onDragMove} onTouchEnd={inline ? undefined : onDragEnd}
        style={{ flexShrink:0, cursor: inline ? "default" : "grab", boxShadow:"0 1px 0 var(--border-lt)" }}>

        {/* Drag handle (mobile overlay only) */}
        {!inline && (
          <div className="expediente-drag-handle" style={{ padding:"8px 0 2px" }}>
            <div style={{ width:40, height:5, borderRadius:3, background:"var(--cream-deeper)", margin:"0 auto 6px" }} />
          </div>
        )}

        {/* Header */}
        <div style={{ padding:"0 16px 0" }}>
          {/* Row 1 — name always gets full width so long names don't get
              truncated by the action icons that used to share this row. */}
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <button onClick={startClose} aria-label={t("back")}
              style={{ padding:6, background:"none", border:"none", cursor:"pointer", color:"var(--charcoal-lt)", flexShrink:0, transform:"rotate(180deg)" }}>
              <IconChevron size={20} />
            </button>
            <Avatar initials={patient.initials} color={getClientColor(patient.colorIdx)}
              style={{ width:48, height:48, fontSize:"var(--text-lg)" }} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-lg)", fontWeight:800, color:"var(--charcoal)", overflow:"hidden", textOverflow:"ellipsis", wordBreak:"break-word", lineHeight:1.15 }}>{patient.name}</div>
              <div style={{ marginTop:3 }}>
                <span className={`badge ${patient.status === "active" ? "badge-teal" : "badge-gray"}`}>{patient.status === "active" ? t("patients.statusActive") : t("patients.statusEnded")}</span>
              </div>
            </div>
          </div>
          {/* Row 2 — contact + quick actions. Kept on its own line so the
              name in Row 1 never gets pushed or ellipsized. */}
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:10, flexWrap:"wrap" }}>
            {patient.phone && (
              <a href={phoneHref(patient.phone)} aria-label={t("patients.phone")}
                onClick={e => e.stopPropagation()}
                style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:36, height:36, minWidth:36, minHeight:36, borderRadius:"50%", background:"var(--teal-pale)", color:"var(--teal-dark)", textDecoration:"none", flexShrink:0, WebkitTapHighlightColor:"transparent" }}>
                <IconPhone size={16} />
              </a>
            )}
            {patient.email && (
              <a href={emailHref(patient.email)} aria-label={t("settings.email")}
                onClick={e => e.stopPropagation()}
                style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:36, height:36, minWidth:36, minHeight:36, borderRadius:"50%", background:"var(--teal-pale)", color:"var(--teal-dark)", textDecoration:"none", flexShrink:0, WebkitTapHighlightColor:"transparent" }}>
                <IconMail size={16} />
              </a>
            )}
            <button type="button" onClick={() => openNewNote()} aria-label={t("notes.addNote")}
              style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:36, height:36, minWidth:36, minHeight:36, borderRadius:"50%", background:"var(--teal-pale)", color:"var(--teal-dark)", border:"none", cursor:"pointer", flexShrink:0, WebkitTapHighlightColor:"transparent", padding:0 }}>
              <IconClipboard size={16} />
            </button>
            <div style={{ flex:1 }} />
            <button onClick={() => onEdit(patient)}
              style={{ padding:"6px 14px", fontSize:"var(--text-sm)", fontWeight:600, borderRadius:"var(--radius-pill)", border:"1.5px solid var(--border)", background:"transparent", color:"var(--charcoal-md)", cursor:"pointer", fontFamily:"var(--font)", flexShrink:0 }}>
              {t("edit")}
            </button>
            <HelpTip tipsKey="help.expediente" />
          </div>
        {/* Tabs */}
        <div role="tablist" style={{ display:"flex", gap:0, marginTop:14 }}>
          {tabs.map(t => (
            <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)}
              style={{
                flex:1, padding:"10px 0 12px", fontSize:"var(--text-sm)", fontWeight:700,
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
      <div ref={contentRef}
        onTouchStart={inline ? undefined : (e) => { onContentTouchStart(e); onTabContentTouchStart(e); }}
        onTouchMove={inline ? undefined : (e) => { onDragMove(e); onTabContentTouchMove(e); }}
        onTouchEnd={inline ? undefined : (e) => { onDragEnd(e); onTabContentTouchEnd(e); }}
        style={{ flex:1, minHeight:0, overflowY:"scroll", WebkitOverflowScrolling:"touch", overscrollBehaviorY:"contain", background:"var(--white)", borderRadius:0 }}>

        {tab === "resumen" && (
          <ResumenTab
            patient={patient} upcomingSessions={upcomingSessions}
            dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo}
            earliestISO={earliestISO} filteredSessions={filteredSessions}
            onRecordPayment={onRecordPayment} onGoToSesiones={goToSesiones} onGoToArchivo={goToArchivo}
            mutating={mutating}
          />
        )}

        {tab === "sesiones" && (
          <SesionesTab
            pSessions={pSessions} pNotes={pNotes}
            sessStatusFilter={sessStatusFilter} setSessStatusFilter={setSessStatusFilter}
            sessDateFrom={sessDateFrom} setSessDateFrom={setSessDateFrom}
            sessDateTo={sessDateTo} setSessDateTo={setSessDateTo}
            filteredPSessions={filteredPSessions}
            upcomingPSessions={upcomingPSessions} pastPSessions={pastPSessions}
            onSelectSession={setSelectedSession}
            onOpenNote={openSessionNote}
            onMarkCompleted={onMarkCompleted}
            readOnly={readOnly}
            mutating={mutating}
          />
        )}

        {tab === "finanzas" && (
          <FinanzasTab
            patient={patient} pPayments={pPayments}
            onRecordPayment={onRecordPayment} deletePayment={deletePayment}
            mutating={mutating}
          />
        )}

        {tab === "archivo" && (
          <ArchivoTab
            patient={patient} pNotes={pNotes} pSessions={pSessions} pDocuments={pDocuments}
            onNewNote={openNewNote} onEditNote={setEditingNote}
            uploading={uploading} triggerUpload={triggerUpload} onOpenDoc={openDocViewer}
            renameDocument={renameDocument} tagDocumentSession={tagDocumentSession} deleteDocument={deleteDocument}
          />
        )}
      </div>
    </div>

    {/* Always-mounted file input */}
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept="image/*,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      style={{ display:"none" }}
      onChange={handleFileUpload}
    />

    {/* Session edit sheet */}
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
        onUpdateModality={async (id, modality) => {
          const ok = await updateSessionModality(id, modality);
          if (ok) setSelectedSession(prev => prev ? { ...prev, modality } : prev);
          return ok;
        }}
        onUpdateRate={async (id, rate) => {
          const ok = await updateSessionRate(id, rate);
          if (ok) setSelectedSession(prev => prev ? { ...prev, rate: Number(rate) } : prev);
          return ok;
        }}
        onUpdateCancelReason={async (id, reason) => {
          const ok = await updateCancelReason(id, reason);
          if (ok) setSelectedSession(prev => prev ? { ...prev, cancel_reason: reason.trim() || null } : prev);
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
