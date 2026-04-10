import { useState } from "react";
import { todayISO, shortDateToISO } from "../../utils/dates";
import { isTutorSession } from "../../utils/sessions";
import { Toggle } from "../Toggle";
import { NoteEditor } from "../NoteEditor";
import { IconX } from "../Icons";
import { useT } from "../../i18n/index";

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

function sessionLabel(s, t) {
  const st = t(`sessions.${s.status}`);
  return `${s.date} · ${s.time} — ${st}`;
}

export function NewNoteSheet({ onClose, patients, upcomingSessions, createNote, updateNote, deleteNote }) {
  const { t } = useT();
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
      <div className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{ maxHeight:"92vh", overflowY:"auto" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("notes.createNote")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={onClose}><IconX size={14} /></button>
        </div>
        <div style={{ padding:"0 20px 22px" }}>
          <div className="input-group">
            <label className="input-label">{t("notes.linkToPatient")}</label>
            <select className="input" value={patientId} onChange={e => handlePatientChange(e.target.value)}>
              <option value="">{t("notes.generalNote")}</option>
              {patients.filter(p => p.status === "active").map(p => (
                <option key={p.id} value={p.id}>{p.name}{p.parent ? ` ${t("patients.minor")}` : ""}</option>
              ))}
            </select>
          </div>
          {patientId && (pastSessions.length > 0 || futureSessions.length > 0) && (
            <div className="input-group">
              <label className="input-label">{t("notes.linkToSession")}</label>
              <select className="input" value={sessionId} onChange={e => { setSessionId(e.target.value); setAutoLinked(false); }}>
                <option value="">{t("notes.generalPatientNote")}</option>
                {pastSessions.length > 0 && <option disabled>— {t("notes.past")} —</option>}
                {pastSessions.map(s => (
                  <option key={s.id} value={s.id}>{isTutorSession(s) ? "🔹 " : ""}{sessionLabel(s, t)}</option>
                ))}
                {futureSessions.length > 0 && <option disabled>— {t("notes.upcoming")} —</option>}
                {futureSessions.map(s => (
                  <option key={s.id} value={s.id}>{isTutorSession(s) ? "🔹 " : ""}{sessionLabel(s, t)}</option>
                ))}
              </select>
              {autoLinked && linkedSession && (
                <div style={{ fontSize:11, color:"var(--teal-dark)", marginTop:4 }}>{t("notes.linkedToRecent")}</div>
              )}
            </div>
          )}
          {isMinor && patientId && (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <span style={{ fontSize:12, fontWeight:600, color:"var(--purple)" }}>{t("notes.tutorNote", { name: selectedPatient.parent })}</span>
              <Toggle on={isTutorNote} onToggle={() => setIsTutorNote(v => !v)} />
            </div>
          )}
          <div style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 14px", marginBottom:14, fontSize:12, color:"var(--charcoal-md)", lineHeight:1.5 }}>
            {patientId ? (
              <>
                {t("notes.patientLabel")} <strong>{selectedPatient?.name}</strong>
                {isTutorNote && <span style={{ color:"var(--purple)", fontWeight:700 }}> ({t("sessions.tutor")})</span>}
                <br />
                {linkedSession
                  ? <>{t("notes.sessionLabel")} <strong>{linkedSession.date} · {linkedSession.time}</strong></>
                  : <>{t("notes.generalNoSession")}</>}
              </>
            ) : (
              <>{t("notes.generalUnlinked")}</>
            )}
          </div>
          <button className={`btn ${isTutorNote ? "" : "btn-primary"}`} onClick={startNote}
            style={isTutorNote ? { background:"var(--purple)", color:"white", boxShadow:"none", width:"100%" } : undefined}>
            {t("notes.createNote")}
          </button>
        </div>
      </div>
    </div>
  );
}
