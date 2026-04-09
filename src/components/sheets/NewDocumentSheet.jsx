import { useState, useRef } from "react";
import { IconX, IconUpload } from "../Icons";
import { shortDateToISO, todayISO } from "../../utils/dates";
import { statusLabel } from "../../utils/sessions";

export function NewDocumentSheet({ onClose, patients, upcomingSessions, uploadDocument }) {
  const [patientId, setPatientId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const fileInputRef = useRef(null);

  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  const now = todayISO();
  const patientSessions = patientId
    ? (upcomingSessions || []).filter(s => s.patient_id === patientId)
        .sort((a, b) => {
          const da = shortDateToISO(a.date), db = shortDateToISO(b.date);
          return db.localeCompare(da);
        })
    : [];

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !patientId) return;
    const oversized = files.filter(f => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      alert(`${oversized.map(f => f.name).join(", ")} excede${oversized.length > 1 ? "n" : ""} el límite de 10 MB`);
    }
    const valid = files.filter(f => f.size <= MAX_FILE_SIZE);
    if (valid.length === 0) { if (fileInputRef.current) fileInputRef.current.value = ""; return; }
    setUploading(true);
    let count = 0;
    for (const file of valid) {
      const result = await uploadDocument({ patientId, file, sessionId: sessionId || null, name: file.name });
      if (result) count++;
    }
    setUploading(false);
    setUploadedCount(count);
    setDone(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const selectedPatient = patients.find(p => p.id === patientId);

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()} style={{ maxHeight:"92vh", overflowY:"auto" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">Subir documento</span>
          <button className="sheet-close" onClick={onClose}><IconX size={14} /></button>
        </div>
        <div style={{ padding:"0 20px 22px" }}>
          {done ? (
            <div style={{ textAlign:"center", padding:"16px 0" }}>
              <div style={{ fontSize:36, marginBottom:8 }}>&#10003;</div>
              <div style={{ fontSize:14, fontWeight:600, color:"var(--charcoal)", marginBottom:4 }}>
                {uploadedCount} documento{uploadedCount !== 1 ? "s" : ""} subido{uploadedCount !== 1 ? "s" : ""}
              </div>
              <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginBottom:16 }}>
                {selectedPatient?.name}
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button className="btn btn-secondary" style={{ flex:1 }} onClick={() => { setDone(false); setUploadedCount(0); }}>
                  Subir más
                </button>
                <button className="btn btn-primary" style={{ flex:1 }} onClick={onClose}>
                  Listo
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="input-group">
                <label className="input-label">Paciente</label>
                <select className="input" value={patientId} onChange={e => { setPatientId(e.target.value); setSessionId(""); }}>
                  <option value="">Seleccionar paciente...</option>
                  {(patients || []).filter(p => p.status === "active").sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              {patientId && patientSessions.length > 0 && (
                <div className="input-group">
                  <label className="input-label">Vincular a sesión (opcional)</label>
                  <select className="input" value={sessionId} onChange={e => setSessionId(e.target.value)}>
                    <option value="">Sin vincular</option>
                    {patientSessions.map(s => (
                      <option key={s.id} value={s.id}>{s.date} · {s.time} — {statusLabel(s.status)}</option>
                    ))}
                  </select>
                </div>
              )}
              {patientId && (
                <div style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 14px", marginBottom:14, fontSize:12, color:"var(--charcoal-md)", lineHeight:1.5 }}>
                  Paciente: <strong>{selectedPatient?.name}</strong><br />
                  Formatos: imágenes, PDF, Word · Máx. 10 MB por archivo
                </div>
              )}
              <input ref={fileInputRef} type="file" multiple
                accept="image/*,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                style={{ display:"none" }} onChange={handleUpload} />
              <button className="btn btn-primary" disabled={!patientId || uploading}
                onClick={() => fileInputRef.current?.click()}
                style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                <IconUpload size={16} />
                {uploading ? "Subiendo..." : "Seleccionar archivos"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
