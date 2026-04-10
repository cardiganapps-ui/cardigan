import { useState, useEffect, useRef, useCallback } from "react";
import { IconX, IconCheck, IconUser, IconCalendar, IconStar } from "./Icons";
import { useT } from "../i18n/index";
import { useCardigan } from "../context/CardiganContext";

function relativeTime(dateStr) {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days}d`;
  return new Date(dateStr).toLocaleDateString("es-MX", { day:"numeric", month:"short" });
}

/* ── List prefix detection ── */
const LIST_PATTERNS = [
  { regex: /^(\s*)(- )/, prefix: (m) => `${m[1]}- ` },
  { regex: /^(\s*)(\* )/, prefix: (m) => `${m[1]}* ` },
  { regex: /^(\s*)(\d+)\. /, prefix: (m) => `${m[1]}${parseInt(m[2]) + 1}. ` },
  { regex: /^(\s*)\[[ x]\] /, prefix: (m) => `${m[1]}[ ] ` },
];

function getListPrefix(line) {
  for (const p of LIST_PATTERNS) {
    const m = line.match(p.regex);
    if (m) return { match: m, nextPrefix: p.prefix(m), currentPrefix: m[0] };
  }
  return null;
}

/* ── Formatting helpers ── */
function wrapSelection(textarea, before, after) {
  const { selectionStart: s, selectionEnd: e, value } = textarea;
  const selected = value.slice(s, e);
  const newValue = value.slice(0, s) + before + selected + (after || before) + value.slice(e);
  textarea.value = newValue;
  textarea.selectionStart = s + before.length;
  textarea.selectionEnd = e + before.length;
  textarea.focus();
  return newValue;
}

function insertAtCursor(textarea, text) {
  const { selectionStart: s, value } = textarea;
  const newValue = value.slice(0, s) + text + value.slice(s);
  textarea.value = newValue;
  textarea.selectionStart = textarea.selectionEnd = s + text.length;
  textarea.focus();
  return newValue;
}

function insertLinePrefix(textarea, prefix) {
  const { selectionStart: s, value } = textarea;
  const lineStart = value.lastIndexOf("\n", s - 1) + 1;
  const newValue = value.slice(0, lineStart) + prefix + value.slice(lineStart);
  textarea.value = newValue;
  textarea.selectionStart = textarea.selectionEnd = s + prefix.length;
  textarea.focus();
  return newValue;
}

/* ── Toolbar button ── */
function ToolBtn({ children, onClick, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      width:40, height:40, display:"flex", alignItems:"center", justifyContent:"center",
      background:"none", border:"none", cursor:"pointer", borderRadius:8,
      color:"var(--charcoal-md)", WebkitTapHighlightColor:"transparent",
    }}>{children}</button>
  );
}
function ToolSep() {
  return <div style={{ width:1, height:20, background:"var(--border-lt)", margin:"0 2px", flexShrink:0 }} />;
}

/* ── Main Editor ── */
export function NoteEditor({ note, onSave, onDelete, onClose }) {
  const { t } = useT();
  const { patients, upcomingSessions, togglePinNote } = useCardigan();
  const [pinned, setPinned] = useState(!!note?.pinned);
  const [title, setTitle] = useState(note?.title || "");
  const [content, setContent] = useState(note?.content || "");
  const [linkedPatientId, setLinkedPatientId] = useState(note?.patient_id || "");
  const [linkedSessionId, setLinkedSessionId] = useState(note?.session_id || "");
  const [showContext, setShowContext] = useState(false);
  const [saved, setSaved] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saveTimer = useRef(null);
  const bodyRef = useRef(null);

  const autoSave = useCallback((newTitle, newContent) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaved(false);
    saveTimer.current = setTimeout(async () => {
      await onSave({ title: newTitle, content: newContent });
      setSaved(true);
    }, 800);
  }, [onSave]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const updateContent = (newContent) => {
    setContent(newContent);
    autoSave(title, newContent);
  };

  const handleTitleChange = (e) => {
    setTitle(e.target.value);
    autoSave(e.target.value, content);
  };

  const handleContentChange = (e) => {
    updateContent(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  };

  const handleTitleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      bodyRef.current?.focus();
    }
  };

  /* ── Auto-list continuation on Enter ── */
  const handleContentKeyDown = (e) => {
    if (e.key !== "Enter") return;
    const ta = bodyRef.current;
    if (!ta) return;
    const { selectionStart, value } = ta;
    const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
    const currentLine = value.slice(lineStart, selectionStart);
    const listInfo = getListPrefix(currentLine);

    if (listInfo) {
      e.preventDefault();
      // If line is just the prefix (empty list item), remove it and exit list mode
      if (currentLine.trim() === listInfo.currentPrefix.trim()) {
        const newValue = value.slice(0, lineStart) + value.slice(selectionStart);
        const newCursor = lineStart;
        setContent(newValue);
        autoSave(title, newValue);
        requestAnimationFrame(() => {
          ta.value = newValue;
          ta.selectionStart = ta.selectionEnd = newCursor;
          ta.style.height = "auto";
          ta.style.height = ta.scrollHeight + "px";
        });
      } else {
        // Continue list on next line
        const insert = "\n" + listInfo.nextPrefix;
        const newValue = value.slice(0, selectionStart) + insert + value.slice(selectionStart);
        const newCursor = selectionStart + insert.length;
        setContent(newValue);
        autoSave(title, newValue);
        requestAnimationFrame(() => {
          ta.value = newValue;
          ta.selectionStart = ta.selectionEnd = newCursor;
          ta.style.height = "auto";
          ta.style.height = ta.scrollHeight + "px";
        });
      }
    }
  };

  /* ── Formatting toolbar actions ── */
  const applyFormat = (type) => {
    const ta = bodyRef.current;
    if (!ta) return;
    let newValue;
    switch (type) {
      case "bold": newValue = wrapSelection(ta, "**"); break;
      case "italic": newValue = wrapSelection(ta, "*"); break;
      case "strike": newValue = wrapSelection(ta, "~~"); break;
      case "heading": newValue = insertLinePrefix(ta, "# "); break;
      case "bullet": newValue = insertLinePrefix(ta, "- "); break;
      case "numbered": newValue = insertLinePrefix(ta, "1. "); break;
      case "checklist": newValue = insertLinePrefix(ta, "[ ] "); break;
      default: return;
    }
    if (newValue != null) updateContent(newValue);
  };

  // Auto-grow on mount
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.style.height = "auto";
      bodyRef.current.style.height = bodyRef.current.scrollHeight + "px";
    }
  }, []);

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;

  const linkedPatient = linkedPatientId ? (patients || []).find(p => p.id === linkedPatientId) : null;
  const linkedSession = linkedSessionId ? (upcomingSessions || []).find(s => s.id === linkedSessionId) : null;
  const patientSessions = linkedPatientId
    ? (upcomingSessions || []).filter(s => s.patient_id === linkedPatientId).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    : [];

  const { updateNoteLink } = useCardigan();
  const handleLinkChange = async (newPatientId, newSessionId) => {
    setLinkedPatientId(newPatientId);
    setLinkedSessionId(newSessionId);
    if (note?.id) await updateNoteLink(note.id, { patientId: newPatientId, sessionId: newSessionId });
  };

  const dateStr = note?.updated_at
    ? new Date(note.updated_at).toLocaleDateString("es-MX", { day:"numeric", month:"long", year:"numeric", hour:"2-digit", minute:"2-digit" })
    : "";

  return (
    <div style={{ position:"fixed", inset:0, background:"var(--white)", zIndex:"var(--z-note-editor)", display:"flex", flexDirection:"column" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"calc(var(--sat, 0px) + 12px) 16px 10px", borderBottom:"1px solid var(--border-lt)", flexShrink:0 }}>
        <button onClick={async () => { if (saveTimer.current) { clearTimeout(saveTimer.current); await onSave({ title, content }); } onClose(); }}
          style={{ fontSize:13, fontWeight:600, color:"var(--teal-dark)", background:"none", border:"none", cursor:"pointer", fontFamily:"var(--font)", padding:"4px 0" }}>
          ‹ {t("back")}
        </button>
        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
          {saved
            ? <span style={{ fontSize:11, color:"var(--charcoal-xl)" }}>{t("notes.saved")}</span>
            : <span style={{ fontSize:11, color:"var(--amber)" }}>{t("notes.saving")}</span>}
          {note?.id && (
            <button onClick={async () => { await togglePinNote(note.id); setPinned(p => !p); }}
              style={{ padding:"4px 6px", background:"none", border:"none", cursor:"pointer", color: pinned ? "var(--amber)" : "var(--charcoal-xl)" }}>
              <IconStar size={16} />
            </button>
          )}
          {onDelete && (
            <button onClick={() => setConfirmDelete(true)}
              style={{ fontSize:11, fontWeight:600, color:"var(--red)", background:"none", border:"none", cursor:"pointer", fontFamily:"var(--font)", padding:"4px 8px" }}>
              {t("delete")}
            </button>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div style={{ padding:"10px 16px", background:"var(--red-bg)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:12, color:"var(--red)", fontWeight:600 }}>{t("notes.deleteConfirm")}</span>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={async () => { await onDelete(); onClose(); }}
              style={{ fontSize:12, fontWeight:700, color:"var(--red)", background:"none", border:"none", cursor:"pointer", fontFamily:"var(--font)" }}>{t("yes")}</button>
            <button onClick={() => setConfirmDelete(false)}
              style={{ fontSize:12, fontWeight:600, color:"var(--charcoal-md)", background:"none", border:"none", cursor:"pointer", fontFamily:"var(--font)" }}>{t("no")}</button>
          </div>
        </div>
      )}

      {/* Formatting toolbar */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:2, padding:"4px 12px", borderBottom:"1px solid var(--border-lt)", flexShrink:0, background:"var(--cream)" }}>
        {/* Inline formatting */}
        <ToolBtn onClick={() => applyFormat("bold")} title="Negrita">
          <span style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:900 }}>B</span>
        </ToolBtn>
        <ToolBtn onClick={() => applyFormat("italic")} title="Cursiva">
          <span style={{ fontFamily:"Georgia, serif", fontSize:16, fontStyle:"italic" }}>I</span>
        </ToolBtn>
        <ToolBtn onClick={() => applyFormat("strike")} title="Tachado">
          <span style={{ fontFamily:"var(--font)", fontSize:14, textDecoration:"line-through" }}>S</span>
        </ToolBtn>
        <ToolSep />
        {/* Block formatting */}
        <ToolBtn onClick={() => applyFormat("heading")} title="Título">
          <span style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:800 }}>H</span>
        </ToolBtn>
        <ToolBtn onClick={() => applyFormat("bullet")} title="Lista">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="4" cy="7" r="1.5" fill="currentColor" stroke="none"/><line x1="9" y1="7" x2="20" y2="7"/>
            <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><line x1="9" y1="12" x2="20" y2="12"/>
            <circle cx="4" cy="17" r="1.5" fill="currentColor" stroke="none"/><line x1="9" y1="17" x2="20" y2="17"/>
          </svg>
        </ToolBtn>
        <ToolBtn onClick={() => applyFormat("numbered")} title="Lista numerada">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <text x="2" y="9" fill="currentColor" stroke="none" fontSize="8" fontWeight="700" fontFamily="var(--font-d)">1</text><line x1="9" y1="7" x2="20" y2="7"/>
            <text x="2" y="14.5" fill="currentColor" stroke="none" fontSize="8" fontWeight="700" fontFamily="var(--font-d)">2</text><line x1="9" y1="12" x2="20" y2="12"/>
            <text x="2" y="20" fill="currentColor" stroke="none" fontSize="8" fontWeight="700" fontFamily="var(--font-d)">3</text><line x1="9" y1="17" x2="20" y2="17"/>
          </svg>
        </ToolBtn>
        <ToolBtn onClick={() => applyFormat("checklist")} title="Checklist">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="5" height="5" rx="1"/><line x1="11" y1="7.5" x2="21" y2="7.5"/>
            <rect x="3" y="14" width="5" height="5" rx="1"/><path d="M4.5 16.5l1.5 1.5 2.5-3"/><line x1="11" y1="16.5" x2="21" y2="16.5"/>
          </svg>
        </ToolBtn>
      </div>

      {/* Patient/Session context bar */}
      <div onClick={() => setShowContext(!showContext)}
        style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 16px", borderBottom:"1px solid var(--border-lt)", flexShrink:0, cursor:"pointer", background:"var(--cream)" }}>
        <IconUser size={14} style={{ color:"var(--charcoal-xl)", flexShrink:0 }} />
        <span style={{ fontSize:12, fontWeight:600, color: linkedPatient ? "var(--charcoal)" : "var(--charcoal-xl)", flex:1 }}>
          {linkedPatient ? linkedPatient.name : t("notes.generalNote")}
        </span>
        {linkedSession && (
          <>
            <IconCalendar size={12} style={{ color:"var(--charcoal-xl)", flexShrink:0 }} />
            <span style={{ fontSize:11, color:"var(--teal-dark)" }}>{linkedSession.date} · {linkedSession.time}</span>
          </>
        )}
        <span style={{ fontSize:10, color:"var(--charcoal-xl)" }}>{showContext ? "▲" : "▼"}</span>
      </div>
      {showContext && (
        <div style={{ padding:"10px 16px", borderBottom:"1px solid var(--border-lt)", background:"var(--cream)", flexShrink:0 }}>
          <div style={{ marginBottom:8 }}>
            <label style={{ fontSize:10, fontWeight:600, color:"var(--charcoal-xl)", display:"block", marginBottom:3 }}>{t("sessions.patient")}</label>
            <select className="input" value={linkedPatientId} onChange={e => handleLinkChange(e.target.value, e.target.value ? linkedSessionId : "")}
              style={{ fontSize:12, padding:"6px 8px" }}>
              <option value="">{t("notes.generalNote")}</option>
              {(patients || []).filter(p => p.status === "active").sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {linkedPatientId && patientSessions.length > 0 && (
            <div>
              <label style={{ fontSize:10, fontWeight:600, color:"var(--charcoal-xl)", display:"block", marginBottom:3 }}>{t("notes.linkToSession")}</label>
              <select className="input" value={linkedSessionId} onChange={e => handleLinkChange(linkedPatientId, e.target.value)}
                style={{ fontSize:12, padding:"6px 8px" }}>
                <option value="">{t("notes.generalPatientNote")}</option>
                {patientSessions.map(s => (
                  <option key={s.id} value={s.id}>{s.date} · {s.time} — {t(`sessions.${s.status}`)}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Editor body */}
      <div style={{ flex:1, overflowY:"auto", padding:"16px 20px 60px" }}>
        {dateStr && (
          <div style={{ fontSize:11, color:"var(--charcoal-xl)", textAlign:"center", marginBottom:12 }}>{dateStr}</div>
        )}
        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          onKeyDown={handleTitleKeyDown}
          placeholder={t("notes.titlePlaceholder")}
          autoFocus
          style={{
            width:"100%", border:"none", outline:"none", padding:0, marginBottom:12,
            fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--charcoal)",
            background:"transparent",
          }}
        />
        <textarea
          ref={bodyRef}
          value={content}
          onChange={handleContentChange}
          onKeyDown={handleContentKeyDown}
          placeholder={t("notes.bodyPlaceholder")}
          style={{
            width:"100%", border:"none", outline:"none", padding:0, resize:"none",
            fontFamily:"var(--font)", fontSize:15, fontWeight:400, color:"var(--charcoal)",
            lineHeight:1.7, background:"transparent", minHeight:200,
          }}
        />
      </div>

      {/* Footer — word count */}
      <div style={{ padding:"8px 20px", borderTop:"1px solid var(--border-lt)", flexShrink:0, fontSize:11, color:"var(--charcoal-xl)", textAlign:"right" }}>
        {wordCount} {wordCount === 1 ? "palabra" : "palabras"}
      </div>
    </div>
  );
}

export function NoteCard({ note, onClick }) {
  const { t } = useT();
  const preview = note.content?.replace(/[*~#\[\]]/g, "").slice(0, 80) || t("notes.noContent");
  const timeAgo = relativeTime(note.updated_at);
  return (
    <div className="row-item" role="button" tabIndex={0} onClick={onClick} style={{ cursor:"pointer" }}>
      {note.pinned && <IconStar size={12} style={{ color:"var(--amber)", flexShrink:0 }} />}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:14, fontWeight:700, color:"var(--charcoal)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
          {note.title || t("notes.noTitle")}
        </div>
        <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginTop:3, display:"flex", gap:6, alignItems:"center" }}>
          <span style={{ flexShrink:0 }}>{timeAgo}</span>
          <span style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{preview}</span>
        </div>
      </div>
      <span className="row-chevron">›</span>
    </div>
  );
}
