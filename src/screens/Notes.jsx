import { useState, useMemo, useCallback, useRef } from "react";
import { IconSearch, IconClipboard, IconX, IconStar, IconTrash, IconEdit, IconDocument, IconCheck, IconUser } from "../components/Icons";
import { NoteEditor, NoteCard } from "../components/NoteEditor";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";
import { NOTE_TEMPLATES } from "../data/noteTemplates";

const TEMPLATE_ICONS = { edit: IconEdit, clipboard: IconClipboard, document: IconDocument, check: IconCheck, user: IconUser };

/* ── Swipeable wrapper for note cards ── */
const SWIPE_REVEALED = -80;
const SWIPE_THRESHOLD = -40;

function SwipeableRow({ children, onDelete }) {
  const ref = useRef(null);
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0);
  const [swiping, setSwiping] = useState(false);

  // Keep ref in sync so touch handlers see the latest committed offset
  // without needing to re-bind on every render.
  offsetRef.current = offset;

  const onTouchStart = useCallback((e) => {
    ref.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      startOffset: offsetRef.current,
      active: false,
    };
  }, []);

  const onTouchMove = useCallback((e) => {
    if (!ref.current) return;
    const dx = e.touches[0].clientX - ref.current.x;
    const dy = e.touches[0].clientY - ref.current.y;
    const revealed = ref.current.startOffset < 0;
    if (!ref.current.active) {
      // Activate horizontal swipe in both directions when revealed,
      // only leftward when hidden.
      const horizontal = Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy);
      const leftward = dx < 0;
      if (horizontal && (revealed || leftward)) {
        ref.current.active = true;
        setSwiping(true);
      } else if (Math.abs(dy) > 8 || (!revealed && dx > 5)) {
        ref.current = null;
        return;
      } else return;
    }
    if (ref.current.active) {
      const next = ref.current.startOffset + dx;
      setOffset(Math.min(0, Math.max(SWIPE_REVEALED, next)));
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!ref.current?.active) { ref.current = null; return; }
    ref.current = null;
    setSwiping(false);
    setOffset(prev => (prev < SWIPE_THRESHOLD ? SWIPE_REVEALED : 0));
  }, []);

  return (
    <div style={{ position:"relative", overflow:"hidden", borderRadius:"var(--radius)" }}>
      {/* Delete button behind */}
      <div style={{ position:"absolute", top:0, right:0, bottom:0, width:80, display:"flex", alignItems:"center", justifyContent:"center", background:"var(--red)", color:"white", fontSize:11, fontWeight:700, cursor:"pointer", borderRadius:"0 var(--radius) var(--radius) 0" }}
        onClick={() => { setOffset(0); onDelete(); }}>
        Eliminar
      </div>
      {/* Content */}
      <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        style={{ transform: `translateX(${offset}px)`, transition: swiping ? "none" : "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)", position:"relative", zIndex:1 }}>
        {children}
      </div>
    </div>
  );
}

export function Notes() {
  const { notes, patients, upcomingSessions, createNote, updateNote, updateNoteLink, togglePinNote, deleteNote, deleteNotes, openExpediente } = useCardigan();
  const { t } = useT();
  const [search, setSearch] = useState("");
  const [filterPatient, setFilterPatient] = useState("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [propsNote, setPropsNote] = useState(null); // note being edited via long-press
  const [longPressingId, setLongPressingId] = useState(null);
  const [confirmDeleteProps, setConfirmDeleteProps] = useState(false);
  useEscape(confirmDeleteProps ? () => setConfirmDeleteProps(false) : (propsNote ? () => setPropsNote(null) : null));
  const longPressRef = useRef(null);

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
    if (favoritesOnly) list = list.filter(n => n.pinned);
    if (filterPatient === "general") list = list.filter(n => !n.patient_id);
    else if (filterPatient !== "all") list = list.filter(n => n.patient_id === filterPatient);
    return list.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (b.updated_at || "").localeCompare(a.updated_at || "");
    });
  }, [notes, search, filterPatient, favoritesOnly, patients]);

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

  const startLongPress = (note) => {
    setLongPressingId(note.id);
    longPressRef.current = setTimeout(() => {
      longPressRef.current = "fired";
      setLongPressingId(null);
      setPropsNote({ ...note, _patientId: note.patient_id || "", _sessionId: note.session_id || "" });
    }, 500);
  };
  const cancelLongPress = () => {
    if (longPressRef.current && longPressRef.current !== "fired") clearTimeout(longPressRef.current);
    longPressRef.current = null;
    setLongPressingId(null);
  };
  const handleNoteClick = (note) => {
    if (longPressRef.current === "fired") { longPressRef.current = null; return; }
    cancelLongPress();
    if (selectMode) toggleSelect(note.id); else setEditingNote(note);
  };

  const propsNoteSessions = propsNote?._patientId
    ? (upcomingSessions || []).filter(s => s.patient_id === propsNote._patientId)
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    : [];

  return (
    <>
    {editingNote && (
      <NoteEditor
        note={editingNote}
        onSave={handleSaveNote}
        onDelete={editingNote.id ? handleDeleteNote : undefined}
        onClose={() => setEditingNote(null)}
      />
    )}
    <div className="page" style={{ paddingTop:16, paddingLeft:16, paddingRight:16 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12, gap:8 }}>
        <div className="section-title">{t("notes.title")}</div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
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
      </div>

      <div className="search-bar" style={{ marginBottom:12 }}>
        <IconSearch size={16} style={{ color:"var(--charcoal-xl)" }} />
        <input placeholder={t("notes.searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {!selectMode && (
        <div style={{ marginBottom:12 }}>
          <button className="btn btn-primary" style={{ width:"100%", fontSize:12 }}
            onClick={() => setShowTemplates(!showTemplates)}>
            {t("notes.newNote")}
          </button>
          {showTemplates && (
            <div className="card" style={{ marginTop:8, padding:0 }}>
              {NOTE_TEMPLATES.map(tmpl => (
                <div key={tmpl.id} className="row-item" role="button" tabIndex={0} style={{ cursor:"pointer" }}
                  onClick={async () => {
                    setShowTemplates(false);
                    const note = await createNote({ patientId: null, sessionId: null, title: tmpl.title, content: tmpl.content });
                    if (note) setEditingNote(note);
                  }}>
                  <span style={{ display:"flex", alignItems:"center", justifyContent:"center", width:28, height:28, borderRadius:"var(--radius)", background:"var(--teal-pale)", color:"var(--teal-dark)", flexShrink:0 }}>
                    {(() => { const Ic = TEMPLATE_ICONS[tmpl.icon]; return Ic ? <Ic size={15} /> : null; })()}
                  </span>
                  <span style={{ fontSize:13, fontWeight:600, color:"var(--charcoal)" }}>{tmpl.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display:"flex", gap:8, marginBottom:14, alignItems:"center" }}>
        <select value={filterPatient} onChange={e => setFilterPatient(e.target.value)}
          style={{ flex:1, fontSize:11, fontWeight:600, fontFamily:"var(--font)", padding:"6px 8px", borderRadius:"var(--radius)", border:"1px solid var(--border)", background:"var(--white)", color:"var(--charcoal-md)", cursor:"pointer" }}>
          <option value="all">{t("docs.allPatients")}</option>
          <option value="general">{t("notes.generalNotes")}</option>
          {patientsWithNotes.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button type="button"
          onClick={() => setFavoritesOnly(v => !v)}
          aria-pressed={favoritesOnly}
          aria-label={t("notes.onlyFavorites")}
          title={t("notes.onlyFavorites")}
          style={{
            display:"flex", alignItems:"center", justifyContent:"center",
            width:34, height:34, minHeight:34, borderRadius:"var(--radius)",
            border: `1px solid ${favoritesOnly ? "var(--amber)" : "var(--border)"}`,
            background: favoritesOnly ? "var(--amber-bg)" : "var(--white)",
            color: favoritesOnly ? "var(--amber)" : "var(--charcoal-xl)",
            cursor:"pointer", padding:0, flexShrink:0,
            transition:"all 0.4s",
          }}>
          <IconStar size={16} />
        </button>
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
        : <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {filteredNotes.map(n => {
              const p = n.patient_id ? patients.find(pt => pt.id === n.patient_id) : null;
              const linkedSession = n.session_id ? (upcomingSessions || []).find(s => s.id === n.session_id) : null;
              const isSelected = selected.has(n.id);

              const isLongPressing = longPressingId === n.id;
              const noteContent = (
                <div className={isLongPressing ? "note-card-pressing" : ""} style={{ position:"relative", background:"var(--white)", borderRadius:"var(--radius)", border:"1px solid var(--border-lt)", boxShadow:"var(--shadow-sm)", overflow:"hidden", transition:"transform 0.4s ease, background 0.4s ease" }}>
                  <div style={{ display:"flex", alignItems:"center" }}>
                    {selectMode && (
                      <div onClick={(e) => { e.stopPropagation(); toggleSelect(n.id); }}
                        style={{ padding:"12px 0 12px 12px", cursor:"pointer", flexShrink:0 }}>
                        <div style={{
                          width:22, height:22, borderRadius:"50%",
                          border: isSelected ? "none" : "2px solid var(--border)",
                          background: isSelected ? "var(--teal)" : "transparent",
                          display:"flex", alignItems:"center", justifyContent:"center",
                          transition:"all 0.4s",
                        }}>
                          {isSelected && <span style={{ color:"white", fontSize:12, fontWeight:800 }}>✓</span>}
                        </div>
                      </div>
                    )}
                    <div style={{ flex:1, minWidth:0, WebkitUserSelect:"none", userSelect:"none" }}
                      onTouchStart={() => !selectMode && startLongPress(n)}
                      onTouchEnd={cancelLongPress} onTouchMove={cancelLongPress}
                      onTouchCancel={cancelLongPress}>
                      <NoteCard note={n} onClick={() => handleNoteClick(n)}
                        patientName={p?.name} sessionLabel={linkedSession ? `${linkedSession.date} · ${linkedSession.time}` : null}
                        onPatientClick={p ? () => openExpediente(p) : undefined} />
                    </div>
                  </div>
                  {isLongPressing && <div className="note-longpress-progress" aria-hidden="true" />}
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
          animation:"toastIn 0.5s ease",
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

      {/* Long-press properties sheet */}
      {propsNote && (
        <div className="sheet-overlay" onClick={() => setPropsNote(null)}>
          <div className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{propsNote.title || t("notes.noTitle")}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => setPropsNote(null)}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              <div className="input-group">
                <label className="input-label">{t("sessions.patient")}</label>
                <select className="input" value={propsNote._patientId}
                  onChange={e => setPropsNote(prev => ({ ...prev, _patientId: e.target.value, _sessionId: "" }))}>
                  <option value="">{t("notes.generalNote")}</option>
                  {(patients || []).filter(p => p.status === "active").sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              {propsNote._patientId && propsNoteSessions.length > 0 && (
                <div className="input-group">
                  <label className="input-label">{t("notes.linkToSession")}</label>
                  <select className="input" value={propsNote._sessionId}
                    onChange={e => setPropsNote(prev => ({ ...prev, _sessionId: e.target.value }))}>
                    <option value="">{t("notes.generalPatientNote")}</option>
                    {propsNoteSessions.map(s => (
                      <option key={s.id} value={s.id}>{s.date} · {s.time} — {t(`sessions.${s.status}`)}</option>
                    ))}
                  </select>
                </div>
              )}
              <div style={{ display:"flex", gap:8, marginTop:4 }}>
                <button className="btn btn-primary" style={{ flex:1 }}
                  onClick={async () => {
                    await updateNoteLink(propsNote.id, { patientId: propsNote._patientId, sessionId: propsNote._sessionId });
                    setPropsNote(null);
                  }}>
                  {t("save")}
                </button>
                <button className="btn" style={{ flex:0, padding:"0 16px", background: propsNote.pinned ? "var(--amber)" : "var(--cream)", color: propsNote.pinned ? "white" : "var(--charcoal-md)", boxShadow:"none" }}
                  aria-label={t("favorite") || "Favorito"}
                  onClick={async () => {
                    await togglePinNote(propsNote.id);
                    setPropsNote(prev => ({ ...prev, pinned: !prev.pinned }));
                  }}>
                  <IconStar size={16} />
                </button>
                <button className="btn" style={{ flex:0, padding:"0 16px", background:"var(--red-bg)", color:"var(--red)", boxShadow:"none" }}
                  aria-label={t("delete")}
                  onClick={() => setConfirmDeleteProps(true)}>
                  <IconTrash size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal (long-press sheet) */}
      {confirmDeleteProps && propsNote && (
        <div className="sheet-overlay" onClick={() => setConfirmDeleteProps(false)} style={{ alignItems:"center" }}>
          <div className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}
            style={{ maxWidth:340, borderRadius:"var(--radius-lg)", margin:"0 20px", animation:"slideUp 0.5s ease" }}>
            <div style={{ padding:"28px 24px 22px", textAlign:"center" }}>
              <div style={{ width:56, height:56, borderRadius:"50%", background:"var(--red-bg)", color:"var(--red)", display:"inline-flex", alignItems:"center", justifyContent:"center", marginBottom:14 }}>
                <IconTrash size={24} />
              </div>
              <div style={{ fontFamily:"var(--font-d)", fontSize:18, fontWeight:800, color:"var(--charcoal)", marginBottom:6 }}>
                {t("notes.deleteConfirm")}
              </div>
              <div style={{ fontSize:13, color:"var(--charcoal-lt)", lineHeight:1.5, marginBottom:20 }}>
                {t("notes.deleteWarning")}
              </div>
              <button className="btn btn-danger"
                onClick={async () => {
                  const id = propsNote.id;
                  setConfirmDeleteProps(false);
                  setPropsNote(null);
                  await deleteNote(id);
                }}>
                {t("delete")}
              </button>
              <button className="btn btn-secondary" style={{ marginTop:8, width:"100%" }}
                onClick={() => setConfirmDeleteProps(false)}>
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
