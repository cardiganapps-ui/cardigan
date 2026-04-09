import { useState, useEffect, useRef, useCallback } from "react";
import { IconX, IconCheck } from "./Icons";

export function NoteEditor({ note, onSave, onDelete, onClose }) {
  const [title, setTitle] = useState(note?.title || "");
  const [content, setContent] = useState(note?.content || "");
  const [saved, setSaved] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saveTimer = useRef(null);
  const bodyRef = useRef(null);

  const autoSave = useCallback((t, c) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaved(false);
    saveTimer.current = setTimeout(async () => {
      await onSave({ title: t, content: c });
      setSaved(true);
    }, 800);
  }, [onSave]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const handleTitleChange = (e) => {
    setTitle(e.target.value);
    autoSave(e.target.value, content);
  };

  const handleContentChange = (e) => {
    setContent(e.target.value);
    autoSave(title, e.target.value);
    // Auto-grow textarea
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

  // Auto-grow on mount
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.style.height = "auto";
      bodyRef.current.style.height = bodyRef.current.scrollHeight + "px";
    }
  }, []);

  const dateStr = note?.updated_at
    ? new Date(note.updated_at).toLocaleDateString("es-MX", { day:"numeric", month:"long", year:"numeric", hour:"2-digit", minute:"2-digit" })
    : "";

  return (
    <div style={{ position:"fixed", inset:0, background:"var(--white)", zIndex:550, display:"flex", flexDirection:"column" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"calc(var(--sat, 0px) + 12px) 16px 12px", borderBottom:"1px solid var(--border-lt)", flexShrink:0 }}>
        <button onClick={() => { if (saveTimer.current) { clearTimeout(saveTimer.current); onSave({ title, content }); } onClose(); }}
          style={{ fontSize:13, fontWeight:600, color:"var(--teal-dark)", background:"none", border:"none", cursor:"pointer", fontFamily:"var(--font)", padding:"4px 0" }}>
          ‹ Volver
        </button>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          {saved
            ? <span style={{ fontSize:11, color:"var(--charcoal-xl)" }}>Guardado</span>
            : <span style={{ fontSize:11, color:"var(--amber)" }}>Guardando...</span>}
          {onDelete && (
            <button onClick={() => setConfirmDelete(true)}
              style={{ fontSize:11, fontWeight:600, color:"var(--red)", background:"none", border:"none", cursor:"pointer", fontFamily:"var(--font)", padding:"4px 8px" }}>
              Eliminar
            </button>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div style={{ padding:"12px 16px", background:"var(--red-bg)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:12, color:"var(--red)", fontWeight:600 }}>¿Eliminar esta nota?</span>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={async () => { await onDelete(); onClose(); }}
              style={{ fontSize:12, fontWeight:700, color:"var(--red)", background:"none", border:"none", cursor:"pointer", fontFamily:"var(--font)" }}>Sí</button>
            <button onClick={() => setConfirmDelete(false)}
              style={{ fontSize:12, fontWeight:600, color:"var(--charcoal-md)", background:"none", border:"none", cursor:"pointer", fontFamily:"var(--font)" }}>No</button>
          </div>
        </div>
      )}

      {/* Editor body */}
      <div style={{ flex:1, overflowY:"auto", padding:"20px 20px 40px" }}>
        {dateStr && (
          <div style={{ fontSize:11, color:"var(--charcoal-xl)", textAlign:"center", marginBottom:16 }}>{dateStr}</div>
        )}
        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          onKeyDown={handleTitleKeyDown}
          placeholder="Título"
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
          placeholder="Escribe aquí..."
          style={{
            width:"100%", border:"none", outline:"none", padding:0, resize:"none",
            fontFamily:"var(--font)", fontSize:15, fontWeight:400, color:"var(--charcoal)",
            lineHeight:1.7, background:"transparent", minHeight:200,
          }}
        />
      </div>
    </div>
  );
}

export function NoteCard({ note, onClick }) {
  const preview = note.content?.slice(0, 80) || "Sin contenido";
  const dateStr = note.updated_at
    ? new Date(note.updated_at).toLocaleDateString("es-MX", { day:"numeric", month:"short" })
    : "";
  return (
    <div className="row-item" onClick={onClick} style={{ cursor:"pointer" }}>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:14, fontWeight:700, color:"var(--charcoal)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
          {note.title || "Sin título"}
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
