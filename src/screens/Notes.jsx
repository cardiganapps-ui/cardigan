import { useState, useMemo, useCallback } from "react";
import { IconSearch, IconClipboard } from "../components/Icons";
import { NoteEditor, NoteCard } from "../components/NoteEditor";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";

export function Notes() {
  const { notes, patients, upcomingSessions, createNote, updateNote, deleteNote } = useCardigan();
  const { t } = useT();
  const [search, setSearch] = useState("");
  const [filterPatient, setFilterPatient] = useState("all");
  const [editingNote, setEditingNote] = useState(null);

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
      <div className="section-title" style={{ marginBottom:12 }}>{t("notes.title")}</div>

      <div className="search-bar" style={{ marginBottom:12 }}>
        <IconSearch size={16} style={{ color:"var(--charcoal-xl)" }} />
        <input placeholder={t("notes.searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div style={{ display:"flex", gap:8, marginBottom:12 }}>
        <button className="btn btn-primary" style={{ flex:1, fontSize:12 }} onClick={async () => {
          const note = await createNote({ patientId: null, sessionId: null, title: "", content: "" });
          if (note) setEditingNote(note);
        }}>{t("notes.newNote")}</button>
      </div>

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
        ? <div className="card" style={{ padding:"32px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>
            {(notes || []).length === 0 ? t("notes.noNotes") : t("docs.noResults")}
          </div>
        : <div className="card">
            {filteredNotes.map(n => {
              const p = n.patient_id ? patients.find(pt => pt.id === n.patient_id) : null;
              const linkedSession = n.session_id ? (upcomingSessions || []).find(s => s.id === n.session_id) : null;
              return (
                <div key={n.id}>
                  {(p || linkedSession) && (
                    <div style={{ padding:"6px 16px 0", fontSize:10, color:"var(--teal-dark)", fontWeight:600 }}>
                      {p && p.name}
                      {p && linkedSession && " · "}
                      {linkedSession && `${t("sessions.session")} ${linkedSession.date}`}
                    </div>
                  )}
                  <NoteCard note={n} onClick={() => setEditingNote(n)} />
                </div>
              );
            })}
          </div>
      }
    </div>
  );
}
