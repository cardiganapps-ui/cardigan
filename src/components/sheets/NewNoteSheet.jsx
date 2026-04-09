import { useState } from "react";
import { todayISO, shortDateToISO } from "../../utils/dates";
import { isTutorSession } from "../../utils/sessions";
import { Toggle } from "../Toggle";
import { NoteEditor } from "../NoteEditor";
import { IconX } from "../Icons";

function findClosestPastSession(sessions) {
  const now = todayISO();
  let best = null;
  for (const s of sessions) {
    const iso = shortDateToISO(s.date);
    if (iso > now) continue;
    if (!best || iso > shortDateToISO(best.date) || (iso === shortDateToISO(best.date) && (s.time || "") > (best.time || ""))) {
      best = s;
    }
  }
  return best;
}

function sessionLabel(s) {
  const st = s.status === "completed" ? "Completada" : s.status === "scheduled" ? "Agendada" : "Cancelada";
  return `${s.date} · ${s.time} — ${st}`;
}

export function NewNoteSheet({ onClose, patients, upcomingSessions, createNote, updateNote, deleteNote }) {
  const [patientId, setPatientId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [isTutorNote, setIsTutorNote] = useState(false);
  const [autoLinked, setAutoLinked] = useState(false);
  const [editingNote, setEditingNote] = useState(null);

  const selectedPatient = patients.find(p => p.id === patientId);
  const isMinor = selectedPatient && !!selectedPatient.parent;
  const now = todayISO();

  const patientSessions = patientId
    ? (upcomingSessions || []).filter(s => s.patient_id === patientId)
    : [];

  const pastSessions = patientSessions
    .filter(s => shortDateToISO(s.date) <= now)
    .sort((a, b) => {
      const da = shortDateToISO(a.date), db = shortDateToISO(b.date);
      if (da !== db) return db.localeCompare(da);
      return (b.time || "").localeCompare(a.time || "");
    });
  const futureSessions = patientSessions
    .filter(s => shortDateToISO(s.date) > now)
    .sort((a, b) => {
      const da = shortDateToISO(a.date), db = shortDateToISO(b.date);
      if (da !== db) return da.localeCompare(db);
      return (a.time || "").localeCompare(b.time || "");
    });

  const handlePatientChange = (newId) => {
    setPatientId(newId);
    setIsTutorNote(false);
    if (newId) {
      const pSess = (upcomingSessions || []).filter(s => s.patient_id === newId);
      const closest = findClosestPastSession(pSess);
      setSessionId(closest?.id || "");
      setAutoLinked(!!closest);
    } else {
      setSessionId("");
      setAutoLinked(false);
    }
  };

  const startNote = async () => {
    const titlePrefix = isTutorNote ? `[Tutor: ${selectedPatient.parent}] ` : "";
    const note = await createNote({
      patientId: patientId || null,
      sessionId: sessionId || null,
      title: titlePrefix,
    });
    if (note) setEditingNote(note);
  };

  if (editingNote) {
    return (
      <NoteEditor
        note={editingNote}
        onSave={async ({ title, content }) => await updateNote(editingNote.id, { title, content })}
        onDelete={async () => { await deleteNote(editingNote.id); }}
        onClose={onClose}
      />
    );
  }

  const linkedSession = sessionId ? patientSessions.find(s => s.id === sessionId) : null;

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ maxHeight:"92vh", overflowY:"auto" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">Nueva nota</span>
          <button className="sheet-close" onClick={onClose}><IconX size={14} /></button>
        </div>
        <div style={{ padding:"0 20px 22px" }}>
          <div className="input-group">
            <label className="input-label">Vincular a paciente</label>
            <select className="input" value={patientId} onChange={e => handlePatientChange(e.target.value)}>
              <option value="">General (sin paciente)</option>
              {patients.filter(p => p.status === "active").map(p => (
                <option key={p.id} value={p.id}>{p.name}{p.parent ? " (menor)" : ""}</option>
              ))}
            </select>
          </div>
          {patientId && (pastSessions.length > 0 || futureSessions.length > 0) && (
            <div className="input-group">
              <label className="input-label">Vincular a sesión</label>
              <select className="input" value={sessionId} onChange={e => { setSessionId(e.target.value); setAutoLinked(false); }}>
                <option value="">Nota general del paciente</option>
                {pastSessions.length > 0 && <option disabled>— Pasadas —</option>}
                {pastSessions.map(s => (
                  <option key={s.id} value={s.id}>{isTutorSession(s) ? "🔹 " : ""}{sessionLabel(s)}</option>
                ))}
                {futureSessions.length > 0 && <option disabled>— Próximas —</option>}
                {futureSessions.map(s => (
                  <option key={s.id} value={s.id}>{isTutorSession(s) ? "🔹 " : ""}{sessionLabel(s)}</option>
                ))}
              </select>
              {autoLinked && linkedSession && (
                <div style={{ fontSize:11, color:"var(--teal-dark)", marginTop:4 }}>Vinculada a la sesión más reciente</div>
              )}
            </div>
          )}
          {isMinor && patientId && (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <span style={{ fontSize:12, fontWeight:600, color:"var(--purple)" }}>Nota de sesión con tutor ({selectedPatient.parent})</span>
              <Toggle on={isTutorNote} onToggle={() => setIsTutorNote(v => !v)} />
            </div>
          )}
          <div style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 14px", marginBottom:14, fontSize:12, color:"var(--charcoal-md)", lineHeight:1.5 }}>
            {patientId ? (
              <>
                Paciente: <strong>{selectedPatient?.name}</strong>
                {isTutorNote && <span style={{ color:"var(--purple)", fontWeight:700 }}> (Tutor)</span>}
                <br />
                {linkedSession
                  ? <>Sesión: <strong>{linkedSession.date} · {linkedSession.time}</strong></>
                  : <>Nota general (sin sesión específica)</>}
              </>
            ) : (
              <>Nota rápida — no vinculada a ningún paciente</>
            )}
          </div>
          <button className={`btn ${isTutorNote ? "" : "btn-primary"}`} onClick={startNote}
            style={isTutorNote ? { background:"var(--purple)", color:"white", boxShadow:"none", width:"100%" } : undefined}>
            Crear nota
          </button>
        </div>
      </div>
    </div>
  );
}
