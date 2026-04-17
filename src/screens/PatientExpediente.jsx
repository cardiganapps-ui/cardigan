import { useState, useMemo, useCallback, useRef } from "react";
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
}) {
  const { t, strings } = useT();
  const { onCancelSession, onMarkCompleted, deleteSession, rescheduleSession, updateSessionModality, updateSessionRate, deletePayment } = useCardigan();
  useLayer("expediente", onClose);
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
  const [sessTypeFilter, setSessTypeFilter] = useState("all");
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
      if (sessTypeFilter === "patient" && isTutorSession(s)) return false;
      if (sessTypeFilter === "tutor" && !isTutorSession(s)) return false;
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
  }, [pSessions, sessTypeFilter, sessStatusFilter, sessDateFrom, sessDateTo]);

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
  const goToSesiones = useCallback((statusFilter, typeFilter = "all") => {
    setSessStatusFilter(statusFilter);
    setSessTypeFilter(typeFilter);
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

  // ── Swipe-to-dismiss ──
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
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.35)", zIndex:"var(--z-expediente-bg)", animation:"fadeIn 0.9s ease" }} />

    {/* Card */}
    <div className="expediente-open expediente-desktop-panel"
      style={{
        position:"fixed", top:"calc(var(--sat, 44px))", bottom:0, zIndex:"var(--z-expediente)",
        display:"flex", flexDirection:"column",
        background:"var(--white)",
        boxShadow:"var(--shadow-lg)",
        animation: dragY > 0 ? "none" : undefined,
        transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
        transition: dragging ? "none" : "transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
        overflow:"hidden",
      }}>

      {/* Drag zone — covers handle + header */}
      <div onTouchStart={onDragStart} onTouchMove={onDragMove} onTouchEnd={onDragEnd}
        style={{ flexShrink:0, cursor:"grab", boxShadow:"0 1px 0 var(--border-lt)" }}>

        {/* Drag handle */}
        <div className="expediente-drag-handle" style={{ padding:"8px 0 2px" }}>
          <div style={{ width:40, height:5, borderRadius:3, background:"var(--cream-deeper)", margin:"0 auto 6px" }} />
        </div>

        {/* Header */}
        <div style={{ padding:"0 16px 0" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={onClose} aria-label={t("back")}
            style={{ padding:6, background:"none", border:"none", cursor:"pointer", color:"var(--charcoal-lt)", flexShrink:0, transform:"rotate(180deg)" }}>
            <IconChevron size={20} />
          </button>
          <Avatar initials={patient.initials} color={getClientColor(patient.colorIdx)}
            style={{ width:48, height:48, fontSize:"var(--text-lg)" }} />
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-lg)", fontWeight:800, color:"var(--charcoal)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{patient.name}</div>
            <div style={{ marginTop:3 }}>
              <span className={`badge ${patient.status === "active" ? "badge-teal" : "badge-gray"}`}>{patient.status === "active" ? t("patients.statusActive") : t("patients.statusEnded")}</span>
            </div>
          </div>
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
      <div style={{ flex:1, minHeight:0, overflowY:"auto", background:"var(--white)", borderRadius:0 }}>

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
            pSessions={pSessions} pNotes={pNotes} sessCounts={sessCounts}
            sessTypeFilter={sessTypeFilter} setSessTypeFilter={setSessTypeFilter}
            sessStatusFilter={sessStatusFilter} setSessStatusFilter={setSessStatusFilter}
            sessDateFrom={sessDateFrom} setSessDateFrom={setSessDateFrom}
            sessDateTo={sessDateTo} setSessDateTo={setSessDateTo}
            filteredPSessions={filteredPSessions}
            upcomingPSessions={upcomingPSessions} pastPSessions={pastPSessions}
            onSelectSession={setSelectedSession}
            onOpenNote={openSessionNote}
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
