import { useState, useMemo, useCallback } from "react";
import { clientColors } from "../data/seedData";
import { shortDateToISO, todayISO } from "../utils/dates";
import { IconX, IconClipboard, IconCalendar, IconUser, IconEdit } from "../components/Icons";
import { NoteEditor, NoteCard } from "../components/NoteEditor";
import { isTutorSession, statusLabel, statusClass } from "../utils/sessions";

export function PatientExpediente({
  patient, upcomingSessions, notes, payments,
  onClose, onRecordPayment, onEdit, onScheduleSession, createSession, createNote, updateNote, deleteNote,
  mutating,
}) {
  const [tab, setTab] = useState("resumen");
  const [editingNote, setEditingNote] = useState(null);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  });
  const [dateTo, setDateTo] = useState(todayISO());

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

  const pNotes = useMemo(() =>
    (notes || []).filter(n => n.patient_id === patient.id),
    [notes, patient.id]
  );

  // All-time stats
  const allCompleted = pSessions.filter(s => s.status === "completed").length;
  const allCancelled = pSessions.filter(s => s.status === "cancelled").length;
  const allCharged = pSessions.filter(s => s.status === "charged").length;
  const allScheduled = pSessions.filter(s => s.status === "scheduled").length;

  // Date-filtered stats for the Resumen attendance card
  const filteredSessions = useMemo(() => {
    const now = todayISO();
    return pSessions.filter(s => {
      const iso = shortDateToISO(s.date);
      if (iso > now) return false; // only past/today
      if (dateFrom && iso < dateFrom) return false;
      if (dateTo && iso > dateTo) return false;
      return true;
    });
  }, [pSessions, dateFrom, dateTo]);

  const fTotal = filteredSessions.length;
  const fCompleted = filteredSessions.filter(s => s.status === "completed").length;
  const fCancelled = filteredSessions.filter(s => s.status === "cancelled").length;
  const fCharged = filteredSessions.filter(s => s.status === "charged").length;
  const fScheduled = filteredSessions.filter(s => s.status === "scheduled").length;
  const fResolved = fCompleted + fCancelled + fCharged;
  const fAttendanceRate = fResolved > 0 ? Math.round(fCompleted / fResolved * 100) : null;

  // Filtered financials
  const fBillable = filteredSessions.filter(s => s.status === "completed" || s.status === "charged").length;
  const fVendido = fBillable * patient.rate;

  const pPayments = useMemo(() =>
    (payments || []).filter(p => p.patient_id === patient.id),
    [payments, patient.id]
  );
  const fCobrado = useMemo(() => {
    return pPayments.reduce((sum, p) => {
      const iso = shortDateToISO(p.date);
      if (dateFrom && iso < dateFrom) return sum;
      if (dateTo && iso > dateTo) return sum;
      return sum + p.amount;
    }, 0);
  }, [pPayments, dateFrom, dateTo]);
  const fPeriodSaldo = fVendido - fCobrado;

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

  // Note editor overlay
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

  const tabs = [
    { k: "resumen", l: "Resumen", Icon: IconUser },
    { k: "sesiones", l: "Sesiones", Icon: IconCalendar },
    { k: "notas", l: "Notas", Icon: IconClipboard },
  ];

  return (
    <div className="expediente-open" style={{ position:"fixed", inset:0, background:"var(--white)", zIndex:500, display:"flex", flexDirection:"column" }}>
      {/* Header */}
      <div style={{ background:"var(--nav-bg)", padding:"calc(var(--sat, 0px) + 14px) 16px 16px", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <button onClick={onClose}
            style={{ fontSize:14, color:"rgba(255,255,255,0.7)", background:"none", border:"none", cursor:"pointer", fontFamily:"var(--font)", fontWeight:600, padding:"4px 0" }}>
            ‹ Pacientes
          </button>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:14, marginTop:14 }}>
          <div className="row-avatar" style={{ background: clientColors[(patient.colorIdx || 0) % clientColors.length], width:48, height:48, fontSize:16 }}>
            {patient.initials}
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:"var(--font-d)", fontSize:18, fontWeight:800, color:"white" }}>{patient.name}</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", marginTop:2 }}>
              {patient.status === "active" ? "Activo" : "Finalizado"} · {patient.day} {patient.time}
            </div>
          </div>
          <button onClick={() => onEdit(patient)}
            style={{ padding:"6px 14px", fontSize:12, fontWeight:600, borderRadius:"var(--radius-pill)", border:"1.5px solid rgba(255,255,255,0.3)", background:"transparent", color:"rgba(255,255,255,0.8)", cursor:"pointer", fontFamily:"var(--font)", flexShrink:0 }}>
            Editar
          </button>
        </div>
        {/* Tabs */}
        <div style={{ display:"flex", gap:0, marginTop:16 }}>
          {tabs.map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
              style={{
                flex:1, padding:"10px 0 12px", fontSize:12, fontWeight:700,
                fontFamily:"var(--font)", color: tab === t.k ? "white" : "rgba(255,255,255,0.4)",
                background:"none", border:"none", borderBottom: tab === t.k ? "2px solid white" : "2px solid transparent",
                cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:5,
              }}>
              <t.Icon size={14} /> {t.l}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex:1, overflowY:"auto", background:"var(--cream)" }}>

        {/* ── RESUMEN ── */}
        {tab === "resumen" && (
          <div style={{ padding:16 }}>
            {/* Date range filter */}
            <div className="card" style={{ padding:"12px 14px", marginBottom:16 }}>
              <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:8 }}>Período</div>
              <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap" }}>
                {[{l:"1 mes",m:1},{l:"3 meses",m:3},{l:"6 meses",m:6},{l:"1 año",m:12}].map(p => {
                  const d = new Date(); d.setMonth(d.getMonth() - p.m);
                  const fromVal = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
                  const isActive = dateFrom === fromVal && dateTo === todayISO();
                  return (
                    <button key={p.m} onClick={() => { setDateFrom(fromVal); setDateTo(todayISO()); }}
                      style={{ padding:"5px 10px", fontSize:11, fontWeight:600, borderRadius:"var(--radius-pill)", border:"none", cursor:"pointer", fontFamily:"var(--font)",
                        background: isActive ? "var(--teal)" : "var(--cream)", color: isActive ? "white" : "var(--charcoal-md)" }}>
                      {p.l}
                    </button>
                  );
                })}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                <div>
                  <label style={{ fontSize:10, fontWeight:600, color:"var(--charcoal-xl)" }}>Desde</label>
                  <input type="date" className="input" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    style={{ fontSize:12, padding:"6px 8px", marginTop:2 }} />
                </div>
                <div>
                  <label style={{ fontSize:10, fontWeight:600, color:"var(--charcoal-xl)" }}>Hasta</label>
                  <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    style={{ fontSize:12, padding:"6px 8px", marginTop:2 }} />
                </div>
              </div>
            </div>

            {/* Financials — filtered */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:16, alignItems:"stretch" }}>
              <div style={{ background:"var(--white)", borderRadius:"var(--radius)", padding:"14px 10px", textAlign:"center", display:"flex", flexDirection:"column", justifyContent:"center" }}>
                <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:6 }}>Vendido</div>
                <div style={{ fontFamily:"var(--font-d)", fontSize:18, fontWeight:800, color:"var(--charcoal)" }}>${fVendido.toLocaleString()}</div>
              </div>
              <div style={{ background:"var(--white)", borderRadius:"var(--radius)", padding:"14px 10px", textAlign:"center", display:"flex", flexDirection:"column", justifyContent:"center" }}>
                <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:6 }}>Cobrado</div>
                <div style={{ fontFamily:"var(--font-d)", fontSize:18, fontWeight:800, color:"var(--green)" }}>${fCobrado.toLocaleString()}</div>
              </div>
              <div style={{ background:"var(--white)", borderRadius:"var(--radius)", padding:"14px 10px", textAlign:"center" }}>
                <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:4 }}>Saldo</div>
                <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:800, color: fPeriodSaldo > 0 ? "var(--red)" : "var(--charcoal-xl)" }}>${fPeriodSaldo.toLocaleString()}</div>
                <div style={{ fontSize:9, color:"var(--charcoal-xl)", marginTop:1 }}>período</div>
                <div style={{ borderTop:"1px solid var(--border-lt)", marginTop:5, paddingTop:4 }}>
                  <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:800, color: patient.amountDue > 0 ? "var(--red)" : "var(--green)" }}>${patient.amountDue.toLocaleString()}</div>
                  <div style={{ fontSize:9, color:"var(--charcoal-xl)", marginTop:1 }}>actual</div>
                </div>
              </div>
            </div>

            {/* Attendance — filtered */}
            <div className="card" style={{ padding:14, marginBottom:16 }}>
              {(() => {
                const fTutor = filteredSessions.filter(s => isTutorSession(s)).length;
                const showTutor = !!patient.parent && fTutor > 0;
                return (
                <>
                <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:10 }}>Asistencia</div>
                <div style={{ display:"grid", gridTemplateColumns: showTutor ? "1fr 1fr" : "1fr 1fr 1fr", gap:8, marginBottom:10 }}>
                  <div style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"10px 8px", textAlign:"center" }}>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--charcoal)" }}>{fTotal}</div>
                    <div style={{ fontSize:9, color:"var(--charcoal-xl)", marginTop:2 }}>Programadas</div>
                  </div>
                  <div style={{ background:"var(--green-bg)", borderRadius:"var(--radius)", padding:"10px 8px", textAlign:"center" }}>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--green)" }}>{fCompleted}</div>
                    <div style={{ fontSize:9, color:"var(--charcoal-xl)", marginTop:2 }}>Asistió</div>
                  </div>
                  <div style={{ background:"var(--red-bg)", borderRadius:"var(--radius)", padding:"10px 8px", textAlign:"center" }}>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--red)" }}>{fCancelled + fCharged}</div>
                    <div style={{ fontSize:9, color:"var(--charcoal-xl)", marginTop:2 }}>No asistió</div>
                  </div>
                  {showTutor && (
                    <div style={{ background:"var(--purple-bg)", borderRadius:"var(--radius)", padding:"10px 8px", textAlign:"center" }}>
                      <div style={{ fontFamily:"var(--font-d)", fontSize:22, fontWeight:800, color:"var(--purple)" }}>{fTutor}</div>
                      <div style={{ fontSize:9, color:"var(--charcoal-xl)", marginTop:2 }}>Tutor</div>
                    </div>
                  )}
                </div>
                </>);
              })()}
              {fCharged > 0 && (
                <div style={{ fontSize:11, color:"var(--amber)", marginBottom:8 }}>
                  {fCharged} cancelada{fCharged !== 1 ? "s" : ""} cobrada{fCharged !== 1 ? "s" : ""}
                </div>
              )}
              {fAttendanceRate !== null && (
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ flex:1, height:6, background:"var(--cream-dark)", borderRadius:3, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${fAttendanceRate}%`, background:"var(--green)", borderRadius:3 }} />
                  </div>
                  <span style={{ fontSize:11, fontWeight:700, color:"var(--charcoal-md)" }}>{fAttendanceRate}%</span>
                </div>
              )}
            </div>

            <div className="card" style={{ padding:0 }}>
              {[
                { label:"Tutor", value: patient.parent || "—" },
                { label:"Sesión regular", value:`${patient.day} a las ${patient.time}` },
                { label:"Tarifa", value:`$${patient.rate} por sesión` },
              ].map((row, i, arr) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"13px 16px", borderBottom: i < arr.length - 1 ? "1px solid var(--border-lt)" : "none" }}>
                  <span style={{ fontSize:13, color:"var(--charcoal-xl)" }}>{row.label}</span>
                  <span style={{ fontSize:13, fontWeight:600, color:"var(--charcoal)" }}>{row.value}</span>
                </div>
              ))}
            </div>

            <div style={{ marginTop:16, display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
              <button className="btn" style={{ height:44, fontSize:12, background:"var(--teal)", color:"white", boxShadow:"none" }} onClick={() => onRecordPayment(patient)} disabled={mutating}>
                Pago
              </button>
              <button className="btn" style={{ height:44, fontSize:12, background:"var(--teal-light)", color:"white", boxShadow:"none" }} onClick={() => onScheduleSession(patient)}>
                Sesión
              </button>
              <button className="btn" style={{ height:44, fontSize:12, background:"var(--teal-pale)", color:"var(--teal-dark)", boxShadow:"none" }} onClick={() => openNewNote(null)}>
                Nota
              </button>
            </div>
          </div>
        )}

        {/* ── SESIONES ── */}
        {tab === "sesiones" && (
          <div style={{ padding:16 }}>
            {pSessions.length === 0
              ? <div className="card" style={{ padding:"32px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>
                  Sin sesiones registradas
                </div>
              : <div className="card">
                  {pSessions.map(s => {
                    const tutor = isTutorSession(s);
                    const hasNote = pNotes.some(n => n.session_id === s.id);
                    return (
                      <div className="row-item" key={s.id} onClick={() => openSessionNote(s)} style={{ cursor:"pointer" }}>
                        <div style={{ width:44, textAlign:"center", flex:"none" }}>
                          <div style={{ fontFamily:"var(--font-d)", fontSize:13, fontWeight:800, color:"var(--charcoal)" }}>{s.date}</div>
                          <div style={{ fontSize:10, color:"var(--charcoal-xl)" }}>{s.time}</div>
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:"var(--charcoal)", display:"flex", alignItems:"center", gap:4 }}>
                            {tutor && <span style={{ fontSize:9, fontWeight:700, color:"var(--purple)", textTransform:"uppercase" }}>Tutor</span>}
                            <span className={`session-status ${statusClass(s.status)}`} style={{ fontSize:10 }}>{statusLabel(s.status)}</span>
                          </div>
                          {hasNote && <div style={{ fontSize:11, color:"var(--teal-dark)", marginTop:2 }}>Nota adjunta</div>}
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                          <IconClipboard size={14} style={{ color: hasNote ? "var(--teal-dark)" : "var(--charcoal-xl)" }} />
                          <span className="row-chevron">›</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
            }
          </div>
        )}

        {/* ── NOTAS ── */}
        {tab === "notas" && (
          <div style={{ padding:16 }}>
            <button className="btn btn-primary" style={{ marginBottom:16 }} onClick={() => openNewNote(null)}>
              + Nueva nota
            </button>
            {pNotes.length === 0
              ? <div className="card" style={{ padding:"32px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>
                  Las notas del paciente aparecerán aquí
                </div>
              : <div className="card">
                  {pNotes.map(n => {
                    const linkedSession = n.session_id ? pSessions.find(s => s.id === n.session_id) : null;
                    return (
                      <div key={n.id}>
                        {linkedSession && (
                          <div style={{ padding:"6px 16px 0", fontSize:10, color:"var(--teal-dark)", fontWeight:600 }}>
                            Sesión {linkedSession.date} · {linkedSession.time}
                          </div>
                        )}
                        <NoteCard note={n} onClick={() => setEditingNote(n)} />
                      </div>
                    );
                  })}
                </div>
            }
          </div>
        )}
      </div>
    </div>
  );
}
