import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { getClientColor } from "../data/seedData";
import { shortDateToISO, todayISO, isoToShortDateWithYear } from "../utils/dates";
import { phoneHref, emailHref, phoneDigits } from "../utils/contact";
import { isNative } from "../lib/platform";
import { launchUrl } from "../lib/nativeBrowser";
import { IconClipboard, IconCalendar, IconUser, IconUsers, IconDollar, IconUpload, IconChevron, IconPhone, IconMail, IconTrendingUp, IconLink, IconCheck } from "../components/Icons";
import { InvitePatientSheet } from "../components/sheets/InvitePatientSheet";
import { NoteEditor } from "../components/NoteEditor";
import { SessionSheet } from "../components/SessionSheet";
import { isTutorSession } from "../utils/sessions";
import { isWordDoc } from "../utils/files";
import { DocumentViewer } from "../components/DocumentViewer";
import { HelpTip } from "../components/HelpTip";
import { Avatar } from "../components/Avatar";
import { useCardigan } from "../context/CardiganContext";
import { useLayer } from "../hooks/useLayer";
import { tryClaim as trySwipeClaim, release as releaseSwipe } from "../hooks/swipeCoordinator";
import { useT } from "../i18n/index";

const TAB_SWIPE_OWNER_ID = "expediente-tab-swipe";

import { ResumenTab } from "./expediente/ResumenTab";
import { SesionesTab } from "./expediente/SesionesTab";
import { FinanzasTab } from "./expediente/FinanzasTab";
import { ArchivoTab } from "./expediente/ArchivoTab";
import { GruposTab } from "./expediente/GruposTab";
import { MedicionesTab } from "./expediente/MedicionesTab";
import { usesAnthropometrics } from "../data/constants";

export function PatientExpediente({
  patient, upcomingSessions, notes, payments, documents,
  onClose, onRecordPayment, onEdit, createNote, updateNote, deleteNote,
  uploadDocument, renameDocument, tagDocumentSession, deleteDocument, getDocumentUrl,
  mutating,
  layout = "overlay",
}) {
  const inline = layout === "inline";
  const { t } = useT();
  const { onCancelSession, onMarkCompleted, deleteSession, rescheduleSession, updateSessionModality, updateSessionRate, updateCancelReason, deletePayment, readOnly, showToast, profession, groupMembers, groupsEnabled } = useCardigan();
  // The Grupos tab only appears when this patient actually belongs to a group
  // (keeps the tab bar lean for individual-only patients).
  const patientGroupCount = useMemo(
    () => (groupMembers || []).filter(m => m.patient_id === patient.id && m.left_at == null).length,
    [groupMembers, patient.id]
  );
  const showMedicionesTab = usesAnthropometrics(profession);

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
  // Track the previously-rendered tab so we can pick the right
  // slide-in animation for the new content. Direction is derived
  // from the index delta in the `tabs` array — moving right
  // (Resumen → Sesiones) animates `screenSlideLeft` (content
  // settles in from the right), and vice versa. Updated in a
  // useEffect after the new tab paints so the animation only fires
  // on transitions, not the initial mount.
  const prevTabRef = useRef("resumen");
  const [editingNote, setEditingNote] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [pendingDocSessionId, setPendingDocSessionId] = useState(null);
  // Patient-portal invite sheet — opened from the header action.
  // Only meaningful when the patient is not already linked.
  const [inviteSheetPatient, setInviteSheetPatient] = useState(null);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  });
  const [dateTo, setDateTo] = useState(todayISO());

  // Session filter state (sesiones tab — also set by Resumen tile clicks)
  const [sessStatusFilter, setSessStatusFilter] = useState("all");
  const [sessDateFrom, setSessDateFrom] = useState(null);
  const [sessDateTo, setSessDateTo] = useState(null);
  // Tutor-only filter is orthogonal to status — it's not part of the
  // segmented control (only ~minors have tutor sessions) so we track
  // it separately and surface it via a dismissible pill on the
  // Sesiones tab. Triggered from the Resumen tutor tile.
  const [sessTutorOnly, setSessTutorOnly] = useState(false);

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

  const filteredPSessions = useMemo(() => {
    return pSessions.filter(s => {
      if (sessTutorOnly && !isTutorSession(s)) return false;
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
  }, [pSessions, sessStatusFilter, sessDateFrom, sessDateTo, sessTutorOnly]);

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

  const processFiles = async (rawFiles, sessionId) => {
    const files = Array.from(rawFiles || []);
    if (files.length === 0) return;
    const oversized = files.filter(f => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      showToast?.(t("docs.sizeLimit", { names: oversized.map(f => f.name).join(", "), count: oversized.length }), "warning");
    }
    const valid = files.filter(f => f.size <= MAX_FILE_SIZE);
    if (valid.length === 0) return;
    setUploading(true);
    let ok = 0;
    for (const file of valid) {
      const result = await uploadDocument({ patientId: patient.id, file, sessionId, name: file.name });
      if (result) ok++;
    }
    setUploading(false);
    // Explicit toast feedback — see Documents.jsx::confirmUpload.
    const total = valid.length;
    const failed = total - ok;
    if (failed === 0) {
      showToast?.(ok === 1 ? t("docs.uploadSuccessOne") : t("docs.uploadSuccessMany", { count: ok }), "success");
    } else if (ok === 0) {
      showToast?.(total === 1 ? t("docs.uploadFailedOne") : t("docs.uploadFailedMany"), "error");
    } else {
      showToast?.(
        failed === 1
          ? t("docs.uploadPartial", { ok, total, failed })
          : t("docs.uploadPartialMany", { ok, total, failed }),
        "warning"
      );
    }
  };

  const handleFileUpload = async (e) => {
    const sessionId = pendingDocSessionId;
    setPendingDocSessionId(null);
    await processFiles(e.target.files, sessionId);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const triggerUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Drag-and-drop upload. Enabled only on the Archivo tab to avoid
  // accidental uploads while users are browsing sesiones/finanzas.
  // Tracks whether a Files drag is currently over the container so the
  // UI can surface a drop-zone hint.
  const [dragOverFiles, setDragOverFiles] = useState(false);
  const dragDepthRef = useRef(0);
  const hasFilePayload = (e) => {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    for (let i = 0; i < types.length; i++) { if (types[i] === "Files") return true; }
    return false;
  };
  const onDragEnterArchivo = (e) => {
    if (tab !== "archivo" || readOnly) return;
    if (!hasFilePayload(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    if (!dragOverFiles) setDragOverFiles(true);
  };
  const onDragOverArchivo = (e) => {
    if (tab !== "archivo" || readOnly) return;
    if (!hasFilePayload(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeaveArchivo = (e) => {
    if (tab !== "archivo" || readOnly) return;
    if (!hasFilePayload(e)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOverFiles(false);
  };
  const onDropArchivo = async (e) => {
    if (tab !== "archivo" || readOnly) return;
    if (!hasFilePayload(e)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragOverFiles(false);
    await processFiles(e.dataTransfer.files, null);
  };

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
  const goToSesiones = useCallback((statusFilter, opts = {}) => {
    setSessStatusFilter(statusFilter);
    setSessDateFrom(dateFrom);
    setSessDateTo(dateTo);
    setSessTutorOnly(!!opts.tutorOnly);
    setTab("sesiones");
  }, [dateFrom, dateTo]);

  const goToArchivo = useCallback(() => setTab("archivo"), []);

  // ── Tabs config ──
  // Mediciones is inserted between Sesiones and Finanzas — it's
  // higher-frequency than Finanzas for an active nutritionist /
  // trainer and reads naturally next to the Sesiones tab where the
  // visit happens.
  const tabs = [
    { k: "resumen", l: t("expediente.resumen"), Icon: IconUser },
    { k: "sesiones", l: t("expediente.sesiones"), Icon: IconCalendar },
    ...(showMedicionesTab ? [{ k: "mediciones", l: t("measurements.tabLabel"), Icon: IconTrendingUp }] : []),
    { k: "finanzas", l: t("finances.payments"), Icon: IconDollar },
    { k: "archivo", l: t("expediente.archivo"), Icon: IconClipboard },
    ...(groupsEnabled !== false && patientGroupCount > 0 ? [{ k: "grupos", l: t("groups.title"), Icon: IconUsers }] : []),
  ];

  // ── Horizontal swipe between tabs ──
  // Pattern mirrors the Home carousel: 60px threshold, must be strongly
  // horizontal (|dx| > |dy|) so vertical scroll inside the tab body keeps
  // working. Advances one tab per gesture; stops at the ends (no wrap).
  //
  // Cooperates with `swipeCoordinator`: a SwipeableRow inside a tab body
  // (e.g. payment rows on Finanzas) claims the lock at ~8px of leftward
  // motion. Without coordination, the tab handler at 12px would also
  // activate and yank the user to the next tab while they're trying to
  // reveal the row's delete button.
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
        // If a SwipeableRow (or any other handler) already owns the
        // gesture, defer — they were faster off the mark and the user
        // intends to interact with that row, not switch tabs.
        if (!trySwipeClaim(TAB_SWIPE_OWNER_ID)) {
          tabSwipeRef.current = null;
          return;
        }
        tabSwipeRef.current.active = true;
      } else if (Math.abs(dy) > 10) {
        tabSwipeRef.current = null;
      }
    }
  };
  const onTabContentTouchEnd = (e) => {
    if (!tabSwipeRef.current?.active) { tabSwipeRef.current = null; releaseSwipe(TAB_SWIPE_OWNER_ID); return; }
    const dx = e.changedTouches[0].clientX - tabSwipeRef.current.x;
    tabSwipeRef.current = null;
    releaseSwipe(TAB_SWIPE_OWNER_ID);
    if (Math.abs(dx) < 60) return;
    const i = tabs.findIndex(tx => tx.k === tab);
    const next = dx < 0 ? Math.min(tabs.length - 1, i + 1) : Math.max(0, i - 1);
    if (next !== i) setTab(tabs[next].k);
  };
  const onTabContentTouchCancel = () => {
    tabSwipeRef.current = null;
    releaseSwipe(TAB_SWIPE_OWNER_ID);
  };

  // ── Swipe-to-dismiss ──
  const dragRef = useRef(null);
  const contentRef = useRef(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Reset scroll to the top on every tab switch so the new tab's header
  // is visible regardless of where the previous tab was scrolled. Without
  // this, switching from a long Sesiones list into Resumen (much shorter)
  // leaves the viewport clamped at the bottom of the new content.
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
    // Snapshot the latest rendered tab so the next transition can
    // compute its direction relative to where we just were.
    prevTabRef.current = tab;
  }, [tab]);

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
            {!inline && (
              <button onClick={startClose} aria-label={t("back")}
                style={{ padding:6, background:"none", border:"none", cursor:"pointer", color:"var(--charcoal-lt)", flexShrink:0, transform:"rotate(180deg)" }}>
                <IconChevron size={20} />
              </button>
            )}
            <Avatar initials={patient.initials} color={getClientColor(patient.colorIdx)}
              style={{ width:40, height:40, fontSize:"var(--text-md)" }} />
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:800, color:"var(--charcoal)", overflow:"hidden", textOverflow:"ellipsis", wordBreak:"break-word", lineHeight:1.2 }}>{patient.name}</div>
              <div style={{ marginTop:3, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                <span className={`badge ${patient.status === "active" ? "badge-teal" : "badge-gray"}`}>{patient.status === "active" ? t("patients.statusActive") : t("patients.statusEnded")}</span>
                {patient.patient_intake_completed_at && (
                  <span
                    title={t("patientIntake.completedHint", { date: isoToShortDateWithYear(patient.patient_intake_completed_at.slice(0, 10)) })}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      fontSize: "var(--text-eyebrow)",
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      padding: "2px 7px",
                      borderRadius: "var(--radius-pill)",
                      background: "var(--green-bg, var(--teal-pale))",
                      color: "var(--green, var(--teal-dark))",
                    }}
                  >
                    <IconCheck size={10} />
                    {t("patientIntake.completedBadge")}
                  </span>
                )}
              </div>
            </div>
          </div>
          {/* Row 2 — contact + quick actions. Kept on its own line so the
              name in Row 1 never gets pushed or ellipsized. The 36px
              circles are below Apple HIG's 44px guideline but acceptable
              for a sheet header where the rest of the screen has plenty
              of space — the trade-off buys back enough vertical room
              that the Resumen tab fits without scrolling. */}
          <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:8, flexWrap:"wrap" }}>
            {patient.phone && (
              <a href={phoneHref(patient.phone)} aria-label={t("patients.phone")}
                onClick={e => {
                  e.stopPropagation();
                  if (isNative()) { e.preventDefault(); launchUrl(phoneHref(patient.phone)).then(ok => { if (!ok) showToast?.(t("patients.contactOpenError"), "error"); }); }
                }}
                style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:36, height:36, minWidth:36, minHeight:36, borderRadius:"50%", background:"var(--teal-pale)", color:"var(--teal-dark)", textDecoration:"none", flexShrink:0, WebkitTapHighlightColor:"transparent" }}>
                <IconPhone size={16} />
              </a>
            )}
            {patient.whatsapp_enabled && patient.phone && (() => {
              const d = phoneDigits(patient.phone);
              const wa = `whatsapp://send?phone=${d.length === 10 ? "52" : ""}${d}`;
              return (
                <a href={wa} aria-label="WhatsApp"
                  onClick={e => {
                    e.stopPropagation();
                    if (isNative()) { e.preventDefault(); launchUrl(wa).then(ok => { if (!ok) showToast?.(t("patients.contactOpenError"), "error"); }); }
                  }}
                  style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:36, height:36, minWidth:36, minHeight:36, borderRadius:"50%", background:"var(--teal-pale)", color:"var(--teal-dark)", textDecoration:"none", flexShrink:0, WebkitTapHighlightColor:"transparent" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M19.05 4.91A9.82 9.82 0 0 0 12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.91-7.01zM12.04 20.15h-.01a8.2 8.2 0 0 1-4.18-1.14l-.3-.18-3.12.82.83-3.04-.19-.31a8.2 8.2 0 0 1-1.26-4.39c0-4.54 3.7-8.24 8.24-8.24 2.2 0 4.27.86 5.83 2.42a8.2 8.2 0 0 1 2.41 5.82c0 4.54-3.7 8.24-8.24 8.24zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.42h-.48c-.17 0-.43.06-.66.31-.23.25-.86.84-.86 2.05s.89 2.37 1.01 2.54c.12.17 1.74 2.66 4.22 3.73.59.25 1.05.41 1.41.52.59.19 1.13.16 1.55.1.47-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29z"/>
                  </svg>
                </a>
              );
            })()}
            {patient.email && (
              <a href={emailHref(patient.email)} aria-label={t("settings.email")}
                onClick={e => {
                  e.stopPropagation();
                  if (isNative()) { e.preventDefault(); launchUrl(emailHref(patient.email)).then(ok => { if (!ok) showToast?.(t("patients.contactOpenError"), "error"); }); }
                }}
                style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:36, height:36, minWidth:36, minHeight:36, borderRadius:"50%", background:"var(--teal-pale)", color:"var(--teal-dark)", textDecoration:"none", flexShrink:0, WebkitTapHighlightColor:"transparent" }}>
                <IconMail size={16} />
              </a>
            )}
            <button type="button" onClick={() => openNewNote()} aria-label={t("notes.addNote")}
              style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:36, height:36, minWidth:36, minHeight:36, borderRadius:"50%", background:"var(--teal-pale)", color:"var(--teal-dark)", border:"none", cursor:"pointer", flexShrink:0, WebkitTapHighlightColor:"transparent", padding:0 }}>
              <IconClipboard size={16} />
            </button>
            {/* Patient-portal invite trigger. Only when the patient
                isn't already linked — a successful claim flips
                patient_user_id and the icon swaps to the "Vinculado"
                pill below. */}
            {!patient.patient_user_id ? (
              <button
                type="button"
                onClick={() => setInviteSheetPatient(patient)}
                aria-label={t("patientInvite.action")}
                title={t("patientInvite.action")}
                style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:36, height:36, minWidth:36, minHeight:36, borderRadius:"50%", background:"var(--teal-pale)", color:"var(--teal-dark)", border:"none", cursor:"pointer", flexShrink:0, WebkitTapHighlightColor:"transparent", padding:0 }}
              >
                <IconLink size={16} />
              </button>
            ) : (
              <span
                aria-label={t("patientInvite.linkedBadge")}
                title={t("patientInvite.linkedBadge")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 36,
                  height: 36,
                  minWidth: 36,
                  minHeight: 36,
                  borderRadius: "50%",
                  background: "var(--green-bg, rgba(61,171,116,0.12))",
                  color: "var(--green)",
                  flexShrink: 0,
                }}
              >
                <IconLink size={16} />
              </span>
            )}
            <div style={{ flex:1 }} />
            <button onClick={() => onEdit(patient)}
              style={{ padding:"6px 14px", fontSize:"var(--text-sm)", fontWeight:600, borderRadius:"var(--radius-pill)", border:"1.5px solid var(--border)", background:"transparent", color:"var(--charcoal-md)", cursor:"pointer", fontFamily:"var(--font)", flexShrink:0 }}>
              {t("edit")}
            </button>
            <HelpTip tipsKey="help.expediente" />
          </div>
        {/* Horizontal tabs — overlay/mobile only. Inline mode uses a
            left rail rendered below so the detail panel reads natively
            on iPad / desktop with a trackpad. */}
        {!inline && (
          <div role="tablist" style={{ display:"flex", gap:0, marginTop:14 }}>
            {tabs.map(tt => (
              <button key={tt.k} role="tab" aria-selected={tab === tt.k} onClick={() => setTab(tt.k)}
                style={{
                  flex:1, padding:"10px 0 12px", fontSize:"var(--text-sm)", fontWeight:700,
                  fontFamily:"var(--font)", color: tab === tt.k ? "var(--charcoal)" : "var(--charcoal-xl)",
                  background:"none", border:"none", borderBottom: tab === tt.k ? "2px solid var(--charcoal)" : "2px solid transparent",
                  cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:5,
                }}>
                <tt.Icon size={14} /> {tt.l}
              </button>
            ))}
          </div>
        )}
      </div>
      </div>

      {/* Body — two columns on inline (rail + content), single column otherwise. */}
      <div className={inline ? "expediente-inline-body" : "expediente-overlay-body"}>
        {inline && (
          <nav className="expediente-inline-tabs" role="tablist" aria-orientation="vertical">
            {tabs.map(tt => (
              <button key={tt.k} type="button" role="tab" aria-selected={tab === tt.k}
                onClick={() => setTab(tt.k)}
                className={`expediente-inline-tab ${tab === tt.k ? "expediente-inline-tab--active" : ""}`}>
                <tt.Icon size={16} />
                <span>{tt.l}</span>
              </button>
            ))}
          </nav>
        )}

      {/* Content */}
      <div ref={contentRef}
        className={`expediente-scroll ${dragOverFiles && tab === "archivo" ? "expediente-scroll--drop" : ""}`}
        onTouchStart={inline ? undefined : (e) => { onContentTouchStart(e); onTabContentTouchStart(e); }}
        onTouchMove={inline ? undefined : (e) => { onDragMove(e); onTabContentTouchMove(e); }}
        onTouchEnd={inline ? undefined : (e) => { onDragEnd(e); onTabContentTouchEnd(e); }}
        onTouchCancel={inline ? undefined : onTabContentTouchCancel}
        onDragEnter={onDragEnterArchivo}
        onDragOver={onDragOverArchivo}
        onDragLeave={onDragLeaveArchivo}
        onDrop={onDropArchivo}
        style={{ flex:1, minHeight:0, overflowY:"scroll", WebkitOverflowScrolling:"touch", overscrollBehaviorY:"contain", background:"var(--white)", borderRadius:0, position:"relative" }}>

        {(() => {
          // Pick a slide-in keyframe based on the index delta from the
          // previously-rendered tab. Initial mount: no animation.
          // Same canonical 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) curve
          // as the bottom-nav screen transitions in App.jsx so the
          // gesture language stays consistent across the app.
          //
          // Reading prevTabRef.current during render is intentional —
          // the ref is updated post-paint in a useEffect above, so by
          // the time we render here it holds the *previous* tab value.
          // The lint rule guards against effects driven by ref reads
          // during render; we're using it as a one-shot snapshot.
          // eslint-disable-next-line react-hooks/refs
          const oldIdx = tabs.findIndex(tt => tt.k === prevTabRef.current);
          const newIdx = tabs.findIndex(tt => tt.k === tab);
          const animation = oldIdx === -1 || newIdx === -1 || oldIdx === newIdx
            ? undefined
            : newIdx > oldIdx
              ? "screenSlideLeft 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)"
              : "screenSlideRight 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)";
          return (
        <div key={tab} className="expediente-tab-content" style={{ animation }}>
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
            sessTutorOnly={sessTutorOnly} setSessTutorOnly={setSessTutorOnly}
            filteredPSessions={filteredPSessions}
            upcomingPSessions={upcomingPSessions} pastPSessions={pastPSessions}
            onSelectSession={setSelectedSession}
            onOpenNote={openSessionNote}
            onMarkCompleted={onMarkCompleted}
            readOnly={readOnly}
            mutating={mutating}
          />
        )}

        {tab === "mediciones" && showMedicionesTab && (
          <MedicionesTab patient={patient} />
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

        {tab === "grupos" && <GruposTab patient={patient} />}
        </div>
          );
        })()}
        {dragOverFiles && tab === "archivo" && (
          <div className="expediente-drop-overlay" aria-hidden>
            <div className="expediente-drop-overlay-card">
              <IconUpload size={28} />
              <div className="expediente-drop-overlay-title">{t("docs.dropHere") || "Soltar para subir"}</div>
            </div>
          </div>
        )}
      </div>
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
        key={editingNote.id || "new"}
        note={editingNote}
        onSave={handleSaveNote}
        onDelete={editingNote.id ? handleDeleteNote : undefined}
        onClose={() => setEditingNote(null)}
      />
    )}
    {inviteSheetPatient && (
      <InvitePatientSheet
        patient={inviteSheetPatient}
        onClose={() => setInviteSheetPatient(null)}
      />
    )}
    </>
  );
}
