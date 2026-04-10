import { useState, useMemo, useCallback, useRef } from "react";
import { IconSearch, IconClipboard, IconX } from "../components/Icons";
import { NoteEditor, NoteCard } from "../components/NoteEditor";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";

/* ── Swipeable wrapper for note cards ── */
function SwipeableRow({ children, onDelete }) {
  const ref = useRef(null);
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const onTouchStart = useCallback((e) => {
    ref.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, active: false };
  }, []);

  const onTouchMove = useCallback((e) => {
    if (!ref.current) return;
    const dx = e.touches[0].clientX - ref.current.x;
    const dy = e.touches[0].clientY - ref.current.y;
    if (!ref.current.active) {
      if (dx < -8 && Math.abs(dx) > Math.abs(dy)) { ref.current.active = true; setSwiping(true); }
      else if (Math.abs(dy) > 8 || dx > 5) { ref.current = null; return; }
      else return;
    }
    if (ref.current.active) setOffset(Math.min(0, Math.max(-80, dx)));
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!ref.current?.active) { ref.current = null; return; }
    ref.current = null;
    setSwiping(false);
    setOffset(offset < -40 ? -80 : 0);
  }, [offset]);

  return (
    <div style={{ position:"relative", overflow:"hidden" }}>
      {/* Delete button behind */}
      <div style={{ position:"absolute", top:0, right:0, bottom:0, width:80, display:"flex", alignItems:"center", justifyContent:"center", background:"var(--red)", color:"white", fontSize:11, fontWeight:700, cursor:"pointer" }}
        onClick={() => { setOffset(0); onDelete(); }}>
        Eliminar
      </div>
      {/* Content */}
      <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        style={{ transform: `translateX(${offset}px)`, transition: swiping ? "none" : "transform 0.2s ease", background:"var(--white)", position:"relative", zIndex:1 }}>
        {children}
      </div>
    </div>
  );
}

export function Notes() {
  const { notes, patients, upcomingSessions, createNote, updateNote, deleteNote, deleteNotes } = useCardigan();
  const { t } = useT();
  const [search, setSearch] = useState("");
  const [filterPatient, setFilterPatient] = useState("all");
  const [editingNote, setEditingNote] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(new Set());

  const patientsWithNotes = useMemo(() => {
    const ids = new Set((notes || []).filter(n => n.patient_id).map(n => n.patient_id));
    return (patients || []).filter(p => ids.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [notes, patients]);

  const filteredNotes = useMemo(() => {
    let list = [...(notes || [])];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(n => {
        const p = patients.find(pt => pt.id === n.patient_id);
        return n.title?.toLowerCase().includes(q) || n.content?.toLowerCase().includes(q) || p?.name?.toLowerCase().includes(q);
      });
    }
    if (filterPatient === "general") list = list.filter(n => !n.patient_id);
    else if (filterPatient !== "all") list = list.filter(n => n.patient_id === filterPatient);
    return list.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  }, [notes, search, filterPatient, patients]);

  const handleSaveNote = useCallback(async ({ title, content }) => {
    if (editingNote?.id) await updateNote(editingNote.id, { title, content });
  }, [editingNote, updateNote]);

  const handleDeleteNote = useCallback(async () => {
    if (editingNote?.id) await deleteNote(editingNote.id);
  }, [editingNote, deleteNote]);

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    await deleteNotes([...selected]);
    setSelected(new Set());
    setSelectMode(false);
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

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

  return (
    <div style={{ padding:16 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
        <div className="section-title">{t("notes.title")}</div>
        {selectMode ? (
          <button onClick={exitSelectMode} style={{ fontSize:12, fontWeight:600, color:"var(--teal-dark)", background:"none", border:"none", cursor:"pointer", fontFamily:"var(--font)" }}>
            {t("done")}
          </button>
        ) : filteredNotes.length > 0 && (
          <button onClick={() => setSelectMode(true)} style={{ fontSize:12, fontWeight:600, color:"var(--teal-dark)", background:"none", border:"none", cursor:"pointer", fontFamily:"var(--font)" }}>
            Seleccionar
          </button>
        )}
      </div>

      <div className="search-bar" style={{ marginBottom:12 }}>
        <IconSearch size={16} style={{ color:"var(--charcoal-xl)" }} />
        <input placeholder={t("notes.searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {!selectMode && (
        <div style={{ display:"flex", gap:8, marginBottom:12 }}>
          <button className="btn btn-primary" style={{ flex:1, fontSize:12 }} onClick={async () => {
            const note = await createNote({ patientId: null, sessionId: null, title: "", content: "" });
            if (note) setEditingNote(note);
          }}>{t("notes.newNote")}</button>
        </div>
      )}

      <div style={{ display:"flex", gap:6, marginBottom:14, alignItems:"center" }}>
        <select value={filterPatient} onChange={e => setFilterPatient(e.target.value)}
          style={{ flex:1, fontSize:11, fontWeight:600, fontFamily:"var(--font)", padding:"6px 8px", borderRadius:"var(--radius)", border:"1px solid var(--border)", background:"var(--white)", color:"var(--charcoal-md)", cursor:"pointer" }}>
          <option value="all">{t("docs.allPatients")}</option>
          <option value="general">{t("notes.generalNotes")}</option>
          {patientsWithNotes.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div style={{ fontSize:11, color:"var(--charcoal-xl)", marginBottom:8 }}>
        {t("notes.count", { count: filteredNotes.length })}
      </div>

      {filteredNotes.length === 0
        ? <div className="card" style={{ padding:"32px 16px", textAlign:"center", color:"var(--charcoal-xl)" }}>
            <div style={{ marginBottom:8, color:"var(--teal-light)" }}><IconClipboard size={28} /></div>
            <div style={{ fontSize:14, fontWeight:600, color:"var(--charcoal)", marginBottom:4 }}>
              {(notes || []).length === 0 ? t("notes.noNotes") : t("docs.noResults")}
            </div>
            {(notes || []).length === 0 && (
              <div style={{ fontSize:12, lineHeight:1.5 }}>
                Crea tu primera nota con el botón de arriba.
              </div>
            )}
          </div>
        : <div className="card">
            {filteredNotes.map(n => {
              const p = n.patient_id ? patients.find(pt => pt.id === n.patient_id) : null;
              const linkedSession = n.session_id ? (upcomingSessions || []).find(s => s.id === n.session_id) : null;
              const isSelected = selected.has(n.id);

              const noteContent = (
                <div>
                  {(p || linkedSession) && (
                    <div style={{ padding:"6px 16px 0", fontSize:10, color:"var(--teal-dark)", fontWeight:600 }}>
                      {p && p.name}
                      {p && linkedSession && " · "}
                      {linkedSession && `${t("sessions.session")} ${linkedSession.date}`}
                    </div>
                  )}
                  <div style={{ display:"flex", alignItems:"center" }}>
                    {selectMode && (
                      <div onClick={(e) => { e.stopPropagation(); toggleSelect(n.id); }}
                        style={{ padding:"12px 0 12px 16px", cursor:"pointer", flexShrink:0 }}>
                        <div style={{
                          width:22, height:22, borderRadius:"50%",
                          border: isSelected ? "none" : "2px solid var(--border)",
                          background: isSelected ? "var(--teal)" : "transparent",
                          display:"flex", alignItems:"center", justifyContent:"center",
                          transition:"all 0.15s",
                        }}>
                          {isSelected && <span style={{ color:"white", fontSize:12, fontWeight:800 }}>✓</span>}
                        </div>
                      </div>
                    )}
                    <div style={{ flex:1, minWidth:0 }}>
                      <NoteCard note={n} onClick={() => selectMode ? toggleSelect(n.id) : setEditingNote(n)} />
                    </div>
                  </div>
                </div>
              );

              return selectMode ? (
                <div key={n.id}>{noteContent}</div>
              ) : (
                <SwipeableRow key={n.id} onDelete={() => deleteNote(n.id)}>
                  {noteContent}
                </SwipeableRow>
              );
            })}
          </div>
      }

      {/* Multi-select action bar */}
      {selectMode && selected.size > 0 && (
        <div style={{
          position:"fixed", bottom:"calc(var(--sab, 34px) + 12px)", left:16, right:16,
          background:"var(--red)", color:"white", borderRadius:"var(--radius)",
          padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"space-between",
          boxShadow:"0 4px 20px rgba(0,0,0,0.2)", zIndex:"var(--z-sheet)",
          animation:"toastIn 0.2s ease",
        }}>
          <span style={{ fontSize:13, fontWeight:700 }}>
            {selected.size} seleccionada{selected.size !== 1 ? "s" : ""}
          </span>
          <button onClick={handleBulkDelete}
            style={{ padding:"8px 16px", fontSize:12, fontWeight:700, borderRadius:"var(--radius-pill)", border:"2px solid white", background:"transparent", color:"white", cursor:"pointer", fontFamily:"var(--font)" }}>
            {t("delete")}
          </button>
        </div>
      )}
    </div>
  );
}
