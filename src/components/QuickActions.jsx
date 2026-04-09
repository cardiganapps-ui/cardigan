import { useState, useEffect } from "react";
import { DAY_ORDER } from "../data/seedData";
import { todayISO, isoToShortDate, shortDateToISO } from "../utils/dates";
import { isTutorSession } from "../utils/sessions";
import { Toggle } from "./Toggle";
import { IconUserPlus, IconDollar, IconCalendarPlus, IconClipboard, IconX } from "./Icons";
import { NoteEditor } from "./NoteEditor";

const ACTIONS = [
  { key:"patient", Icon: IconUserPlus,     label:"Paciente" },
  { key:"payment", Icon: IconDollar,       label:"Pago" },
  { key:"session", Icon: IconCalendarPlus, label:"Sesión" },
  { key:"note",    Icon: IconClipboard,    label:"Nota" },
];

/* ── NEW PATIENT FORM ── */
function NewPatientSheet({ onClose, onSubmit, mutating, patients }) {
  const [name, setName]       = useState("");
  const [isMinor, setIsMinor] = useState(false);
  const [parent, setParent]   = useState("");
  const [rate, setRate]       = useState("");
  const [recurring, setRecurring] = useState(true);
  const [schedules, setSchedules] = useState([{ day: "Lunes", time: "16:00" }]);
  const [startDate, setStartDate] = useState(todayISO());
  const [hasEndDate, setHasEndDate] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [err, setErr]         = useState("");

  const updateSched = (i, f, v) => setSchedules(prev => prev.map((s, idx) => idx === i ? { ...s, [f]: v } : s));
  const removeSched = (i) => setSchedules(prev => prev.filter((_, idx) => idx !== i));

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setErr("Ingresa el nombre del paciente."); return; }
    if (patients?.some(p => p.name.toLowerCase() === name.trim().toLowerCase())) {
      setErr("Ya existe un paciente con ese nombre."); return;
    }
    setErr("");
    const ok = await onSubmit({
      name,
      parent: isMinor ? parent : "",
      rate: Number(rate) || 0,
      schedules,
      recurring,
      startDate: recurring ? startDate : null,
      endDate: recurring && hasEndDate ? endDate : null,
    });
    if (ok) onClose();
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ maxHeight:"92vh", overflowY:"auto" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">Nuevo paciente</span>
          <button className="sheet-close" onClick={onClose}><IconX size={14} /></button>
        </div>
        <form onSubmit={submit} style={{ padding:"0 20px 22px" }}>
          <div className="input-group">
            <label className="input-label">Nombre completo</label>
            <input className="input" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="María López" />
          </div>

          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: isMinor ? 6 : 14 }}>
            <span style={{ fontSize:12, fontWeight:600, color:"var(--charcoal-md)" }}>Es menor de edad</span>
            <Toggle on={isMinor} onToggle={() => setIsMinor(v => !v)} />
          </div>
          {isMinor && (
            <div className="input-group">
              <label className="input-label">Tutor / contacto</label>
              <input className="input" type="text" value={parent} onChange={e => setParent(e.target.value)} placeholder="Nombre del tutor" />
            </div>
          )}

          <div className="input-group">
            <label className="input-label">Tarifa por sesión</label>
            <input className="input" type="number" min="0" step="50" value={rate} onChange={e => setRate(e.target.value)} placeholder="Ej: 700" />
          </div>

          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <span style={{ fontSize:13, fontWeight:700, color:"var(--charcoal)" }}>Citas recurrentes</span>
            <Toggle on={recurring} onToggle={() => setRecurring(v => !v)} />
          </div>

          {schedules.map((s, i) => (
            <div key={i} style={{ display:"grid", gridTemplateColumns: schedules.length > 1 ? "1fr 1fr 28px" : "1fr 1fr", gap:8, marginBottom:8, alignItems:"end" }}>
              <div className="input-group" style={{ marginBottom:0 }}>
                {i === 0 && <label className="input-label">Día</label>}
                <select className="input" value={s.day} onChange={e => updateSched(i, "day", e.target.value)}>
                  {DAY_ORDER.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="input-group" style={{ marginBottom:0 }}>
                {i === 0 && <label className="input-label">Hora</label>}
                <input className="input" type="time" value={s.time} onChange={e => updateSched(i, "time", e.target.value)} />
              </div>
              {schedules.length > 1 && (
                <button type="button" onClick={() => removeSched(i)}
                  style={{ width:28, height:28, borderRadius:"50%", border:"none", background:"var(--red-bg)", color:"var(--red)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <IconX size={12} />
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setSchedules(prev => [...prev, { day: "Lunes", time: "16:00" }])}
            style={{ fontSize:12, fontWeight:600, color:"var(--teal-dark)", background:"none", border:"none", cursor:"pointer", padding:"4px 0 12px", fontFamily:"var(--font)" }}>
            + Agregar otro horario
          </button>

          {recurring && (
            <div style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 14px", marginBottom:14 }}>
              <div className="input-group" style={{ marginBottom:10 }}>
                <label className="input-label">Inicio</label>
                <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: hasEndDate ? 8 : 0 }}>
                <span style={{ fontSize:12, fontWeight:600, color:"var(--charcoal-md)" }}>Fecha de fin</span>
                <Toggle on={hasEndDate} onToggle={() => setHasEndDate(v => !v)} />
              </div>
              {hasEndDate ? (
                <div className="input-group" style={{ marginBottom:0 }}>
                  <input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              ) : (
                <div style={{ fontSize:11, color:"var(--charcoal-xl)", marginTop:4 }}>Permanente — se renuevan automáticamente</div>
              )}
            </div>
          )}

          {err && <div style={{ fontSize:12, color:"var(--red)", marginBottom:10 }}>{err}</div>}
          <button className="btn btn-primary" type="submit" disabled={mutating}>
            {mutating ? "Guardando..." : "Agregar paciente"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ── NEW SESSION FORM ── */
function NewSessionSheet({ onClose, onSubmit, patients, mutating }) {
  const [patientName, setPatientName] = useState("");
  const [sessionType, setSessionType] = useState("patient");
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState("16:00");
  const [customRate, setCustomRate] = useState("");
  const [err, setErr]   = useState("");

  const selectedPatient = patients.find(p => p.name === patientName);
  const isMinor = selectedPatient && !!selectedPatient.parent;
  const isTutor = sessionType === "tutor";

  const handlePatientChange = (name) => {
    setPatientName(name);
    const p = patients.find(pt => pt.name === name);
    setSessionType("patient");
    setCustomRate(p ? String(p.rate) : "");
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!patientName) { setErr("Selecciona un paciente."); return; }
    if (!date)  { setErr("Ingresa una fecha."); return; }
    if (!time.trim())  { setErr("Ingresa una hora."); return; }
    setErr("");
    const params = { patientName, date: isoToShortDate(date), time };
    if (isTutor) {
      params.isTutor = true;
      params.tutorName = selectedPatient.parent;
      params.customRate = Number(customRate) || selectedPatient.rate;
    }
    const ok = await onSubmit(params);
    if (ok) onClose();
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ maxHeight:"92vh", overflowY:"auto" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">Agendar sesión</span>
          <button className="sheet-close" onClick={onClose}><IconX size={14} /></button>
        </div>
        <form onSubmit={submit} style={{ padding:"0 20px 22px" }}>
          <div className="input-group">
            <label className="input-label">Paciente</label>
            <select className="input" value={patientName} onChange={e => handlePatientChange(e.target.value)}>
              <option value="">Seleccionar paciente</option>
              {patients.filter(p => p.status === "active").map(p => (
                <option key={p.id} value={p.name}>{p.name}{p.parent ? " (menor)" : ""}</option>
              ))}
            </select>
          </div>

          {isMinor && (
            <div className="input-group">
              <label className="input-label">Tipo de sesión</label>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                <button type="button" onClick={() => setSessionType("patient")}
                  style={{ padding:"10px", fontSize:12, fontWeight:700, borderRadius:"var(--radius)", border: sessionType==="patient" ? "2px solid var(--teal)" : "1.5px solid var(--border)", background: sessionType==="patient" ? "var(--teal-pale)" : "var(--white)", color: sessionType==="patient" ? "var(--teal-dark)" : "var(--charcoal-lt)", cursor:"pointer", fontFamily:"var(--font)", textAlign:"center" }}>
                  Paciente
                </button>
                <button type="button" onClick={() => { setSessionType("tutor"); setCustomRate(String(selectedPatient.rate)); }}
                  style={{ padding:"10px", fontSize:12, fontWeight:700, borderRadius:"var(--radius)", border: sessionType==="tutor" ? "2px solid var(--purple)" : "1.5px solid var(--border)", background: sessionType==="tutor" ? "var(--purple-bg)" : "var(--white)", color: sessionType==="tutor" ? "var(--purple)" : "var(--charcoal-lt)", cursor:"pointer", fontFamily:"var(--font)", textAlign:"center" }}>
                  Tutor: {selectedPatient.parent}
                </button>
              </div>
            </div>
          )}

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div className="input-group">
              <label className="input-label">Fecha</label>
              <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="input-group">
              <label className="input-label">Hora</label>
              <input className="input" type="time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
          </div>

          {isTutor && (
            <div className="input-group">
              <label className="input-label">Tarifa de esta sesión</label>
              <input className="input" type="number" min="0" step="50" value={customRate} onChange={e => setCustomRate(e.target.value)} placeholder="Ej: 700" />
            </div>
          )}

          {err && <div style={{ fontSize:12, color:"var(--red)", marginBottom:10 }}>{err}</div>}
          <button className={`btn ${isTutor ? "" : "btn-primary"}`} type="submit" disabled={mutating}
            style={isTutor ? { background:"var(--purple)", color:"white", boxShadow:"none", width:"100%" } : undefined}>
            {mutating ? "Agendando..." : isTutor ? `Agendar con tutor · $${(Number(customRate) || selectedPatient?.rate || 0).toLocaleString()}` : "Agendar sesión"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ── NEW NOTE SHEET ── */
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

function NewNoteSheet({ onClose, patients, upcomingSessions, createNote, updateNote, deleteNote }) {
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

  // Past sessions: recent first. Future sessions: earliest first.
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
                <div style={{ fontSize:11, color:"var(--teal-dark)", marginTop:4 }}>
                  Vinculada a la sesión más reciente
                </div>
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

/* ── QUICK ACTIONS (FAB + MENU + SHEETS) ── */
export function QuickActions({
  patients,
  upcomingSessions,
  onOpenPaymentModal,
  createPatient,
  createSession,
  createNote, updateNote, deleteNote,
  mutating,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSheet, setActiveSheet] = useState(null);

  const handleAction = (key) => {
    setMenuOpen(false);
    if (key === "payment") {
      onOpenPaymentModal();
    } else {
      setActiveSheet(key);
    }
  };

  const closeSheet = () => setActiveSheet(null);

  return (
    <>
      {menuOpen && <div className="fab-overlay" onClick={() => setMenuOpen(false)} />}
      {menuOpen && (
        <div className="fab-menu">
          {ACTIONS.map((a, i) => (
            <button key={a.key} className="fab-action" style={{ animationDelay:`${i * 0.04}s` }} onClick={() => handleAction(a.key)}>
              <span className="fab-action-label">{a.label}</span>
              <span className="fab-action-icon"><a.Icon size={16} /></span>
            </button>
          ))}
        </div>
      )}
      <button
        className={`fab ${menuOpen ? "fab-open" : ""}`}
        onClick={() => setMenuOpen(o => !o)}
        aria-label={menuOpen ? "Cerrar" : "Agregar"}
      >+</button>

      {activeSheet === "patient" && (
        <NewPatientSheet onClose={closeSheet} onSubmit={createPatient} mutating={mutating} patients={patients} />
      )}
      {activeSheet === "session" && (
        <NewSessionSheet onClose={closeSheet} onSubmit={createSession} patients={patients} mutating={mutating} />
      )}
      {activeSheet === "note" && (
        <NewNoteSheet onClose={closeSheet} patients={patients} upcomingSessions={upcomingSessions}
          createNote={createNote} updateNote={updateNote} deleteNote={deleteNote} />
      )}
    </>
  );
}
