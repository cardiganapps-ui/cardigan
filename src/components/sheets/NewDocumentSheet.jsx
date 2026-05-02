import { useState, useRef } from "react";
import { IconX, IconUpload } from "../Icons";
import { shortDateToISO } from "../../utils/dates";
import { useT } from "../../i18n/index";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useCardigan } from "../../context/CardiganContext";

export function NewDocumentSheet({ onClose, patients, upcomingSessions, uploadDocument }) {
  const { t } = useT();
  const { showToast } = useCardigan();
  useEscape(onClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose);
  const setPanel = (el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };
  const [patientId, setPatientId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const fileInputRef = useRef(null);

  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  const patientSessions = patientId
    ? (upcomingSessions || []).filter(s => s.patient_id === patientId)
        .sort((a, b) => {
          const da = shortDateToISO(a.date), db = shortDateToISO(b.date);
          return db.localeCompare(da);
        })
    : [];

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    // patientId="" is the "Documento general" option — explicitly
    // valid (uploadDocument coerces empty → null below). The earlier
    // `!patientId` guard silently dropped general-doc uploads.
    if (files.length === 0) return;
    const oversized = files.filter(f => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      showToast?.(t("docs.sizeLimit", { names: oversized.map(f => f.name).join(", "), count: oversized.length }), "warning");
    }
    const valid = files.filter(f => f.size <= MAX_FILE_SIZE);
    if (valid.length === 0) { if (fileInputRef.current) fileInputRef.current.value = ""; return; }
    setUploading(true);
    let count = 0;
    for (const file of valid) {
      const result = await uploadDocument({ patientId: patientId || null, file, sessionId: sessionId || null, name: file.name });
      if (result) count++;
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    // When NOTHING succeeded, surface an error toast and stay on the
    // form so the user can retry — the "0 documentos subidos" success
    // panel was confusingly upbeat about a complete failure. When at
    // least one file landed, the existing success-count panel still
    // tells the story (we add a partial-failure toast on top).
    const total = valid.length;
    const failed = total - count;
    if (count === 0) {
      showToast?.(total === 1 ? t("docs.uploadFailedOne") : t("docs.uploadFailedMany"), "error");
      return;
    }
    if (failed > 0) {
      showToast?.(
        failed === 1
          ? t("docs.uploadPartial", { ok: count, total, failed })
          : t("docs.uploadPartialMany", { ok: count, total, failed }),
        "warning"
      );
    }
    setUploadedCount(count);
    setDone(true);
  };

  const selectedPatient = patients.find(p => p.id === patientId);

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div ref={setPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...panelHandlers} style={{ maxHeight:"92vh", overflowY:"auto" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("docs.upload")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={onClose}><IconX size={14} /></button>
        </div>
        <div style={{ padding:"0 20px 22px" }}>
          {done ? (
            <div style={{ textAlign:"center", padding:"16px 0" }}>
              <div style={{ fontSize:36, marginBottom:8 }}>&#10003;</div>
              <div style={{ fontSize:14, fontWeight:600, color:"var(--charcoal)", marginBottom:4 }}>
                {t("docs.uploaded", { count: uploadedCount })}
              </div>
              <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginBottom:16 }}>
                {selectedPatient?.name}
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <button className="btn btn-secondary" style={{ flex:1 }} onClick={() => { setDone(false); setUploadedCount(0); }}>
                  {t("uploadMore")}
                </button>
                <button className="btn btn-primary-teal" style={{ flex:1 }} onClick={onClose}>
                  {t("done")}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="input-group">
                <label className="input-label">{t("sessions.patient")}</label>
                <select className="input" value={patientId} onChange={e => { setPatientId(e.target.value); setSessionId(""); }}>
                  <option value="">{t("docs.general")}</option>
                  {(patients || []).filter(p => p.status === "active").sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              {patientId && patientSessions.length > 0 && (
                <div className="input-group">
                  <label className="input-label">{t("notes.linkToSession")}</label>
                  <select className="input" value={sessionId} onChange={e => setSessionId(e.target.value)}>
                    <option value="">{t("docs.unlink")}</option>
                    {patientSessions.map(s => (
                      <option key={s.id} value={s.id}>{s.date} · {s.time} — {t(`sessions.${s.status}`)}</option>
                    ))}
                  </select>
                </div>
              )}
              <div style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 14px", marginBottom:14, fontSize:12, color:"var(--charcoal-md)", lineHeight:1.5 }}>
                {patientId ? <>{t("notes.patientLabel")} <strong>{selectedPatient?.name}</strong></> : <strong>{t("docs.generalDoc")}</strong>}<br />
                {t("docs.formats")}
              </div>
              <input ref={fileInputRef} type="file" multiple
                accept="image/*,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                style={{ display:"none" }} onChange={handleUpload} />
              <button className="btn btn-primary-teal" disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                <IconUpload size={16} />
                {uploading ? t("docs.uploading") : t("docs.selectFiles")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
