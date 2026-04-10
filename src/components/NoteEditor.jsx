import { useState, useEffect, useRef, useCallback } from "react";
import { IconX, IconCheck } from "./Icons";
import { useT } from "../i18n/index";

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
function ToolBtn({ label, onClick, active }) {
  return (
    <button onClick={onClick} style={{
      padding:"6px 10px", fontSize:14, fontWeight: active ? 800 : 500,
      fontFamily:"var(--font)", color: active ? "var(--teal-dark)" : "var(--charcoal-md)",
      background:"none", border:"none", cursor:"pointer", minHeight:36,
      borderBottom: active ? "2px solid var(--teal)" : "2px solid transparent",
    }}>{label}</button>
  );
}

/* ── Main Editor ── */
export function NoteEditor({ note, onSave, onDelete, onClose }) {
  const { t } = useT();
  const [title, setTitle] = useState(note?.title || "");
  const [content, setContent] = useState(note?.content || "");
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
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          {saved
            ? <span style={{ fontSize:11, color:"var(--charcoal-xl)" }}>{t("notes.saved")}</span>
            : <span style={{ fontSize:11, color:"var(--amber)" }}>{t("notes.saving")}</span>}
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
      <div style={{ display:"flex", gap:0, padding:"0 8px", borderBottom:"1px solid var(--border-lt)", flexShrink:0, overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
        <ToolBtn label="B" onClick={() => applyFormat("bold")} />
        <ToolBtn label="I" onClick={() => applyFormat("italic")} />
        <ToolBtn label="S" onClick={() => applyFormat("strike")} />
        <ToolBtn label="H" onClick={() => applyFormat("heading")} />
        <ToolBtn label="•" onClick={() => applyFormat("bullet")} />
        <ToolBtn label="1." onClick={() => applyFormat("numbered")} />
        <ToolBtn label="☐" onClick={() => applyFormat("checklist")} />
      </div>

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
  const dateStr = note.updated_at
    ? new Date(note.updated_at).toLocaleDateString("es-MX", { day:"numeric", month:"short" })
    : "";
  return (
    <div className="row-item" role="button" tabIndex={0} onClick={onClick} style={{ cursor:"pointer" }}>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:14, fontWeight:700, color:"var(--charcoal)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
          {note.title || t("notes.noTitle")}
        </div>
        <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginTop:3, display:"flex", gap:6, alignItems:"center" }}>
          <span>{dateStr}</span>
          <span style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{preview}</span>
        </div>
      </div>
      <span className="row-chevron">›</span>
    </div>
  );
}
