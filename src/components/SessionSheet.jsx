import { useState } from "react";
import { getClientColor } from "../data/seedData";
import { SESSION_STATUS } from "../data/constants";
import { isCancelledStatus } from "../utils/sessions";
import { shortDateToISO, isoToShortDate } from "../utils/dates";
import { IconX, IconClipboard, IconUpload } from "./Icons";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";

export function SessionSheet({ session, patients, notes, onClose, onCancelSession, onMarkCompleted, onDelete, onReschedule, onUpdateModality, onOpenNote, onAttachDocument, mutating }) {
  const { t } = useT();
  useEscape(session ? onClose : null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelCharge, setCancelCharge] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newDuration, setNewDuration] = useState("60");
  const [rescheduleErr, setRescheduleErr] = useState("");
  if (!session) return null;
  const patientData = patients?.find(p => p.name === session.patient);
  const rate = patientData ? `$${patientData.rate.toLocaleString()}` : "—";
  const isCancelled = isCancelledStatus(session.status);
  const isCompleted = session.status === SESSION_STATUS.COMPLETED;
  const isScheduled = session.status === SESSION_STATUS.SCHEDULED;
  const statusLbl = t(`sessions.${session.status}`);
  const isTutor = session.initials?.startsWith("T·");
  const displayInitials = isTutor ? session.initials.replace("T·", "") : session.initials;

  const dur = session.duration || 60;
  const [h, m] = (session.time || "0:0").split(":");
  const endDate = new Date(0, 0, 0, +h, +m);
  endDate.setMinutes(endDate.getMinutes() + dur);
  const endTime = `${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}`;

  const statusPillColors = {
    [SESSION_STATUS.SCHEDULED]: { bg: "var(--teal-pale)", color: "var(--teal-dark)" },
    [SESSION_STATUS.COMPLETED]: { bg: "var(--green-bg)", color: "var(--green)" },
    [SESSION_STATUS.CANCELLED]: { bg: "var(--cream-dark)", color: "var(--charcoal-lt)" },
    [SESSION_STATUS.CHARGED]:   { bg: "var(--amber-bg)", color: "var(--amber)" },
  };
  const pillStyle = statusPillColors[session.status] || statusPillColors[SESSION_STATUS.SCHEDULED];

  const startReschedule = () => {
    setNewDate(shortDateToISO(session.date));
    setNewTime(session.time);
    setNewDuration(String(dur));
    setRescheduleErr("");
    setRescheduling(true);
  };

  const submitReschedule = async () => {
    if (!newDate) { setRescheduleErr(t("sessions.selectDate")); return; }
    if (!newTime.trim()) { setRescheduleErr(t("sessions.selectTime")); return; }
    setRescheduleErr("");
    const ok = await onReschedule(session.id, isoToShortDate(newDate), newTime, Number(newDuration) || 60);
    if (ok) setRescheduling(false);
  };

  const startCancel = () => {
    setCancelCharge(null);
    setCancelReason("");
    setCancelling(true);
  };

  const submitCancel = async () => {
    const ok = await onCancelSession(session, cancelCharge, cancelReason.trim());
    if (ok) setCancelling(false);
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title" style={{ display:"flex", alignItems:"center", gap:8 }}>
            {t("sessions.session")}
            <span style={{ fontSize:11, fontWeight:700, padding:"2px 10px", borderRadius:"var(--radius-pill)", background: pillStyle.bg, color: pillStyle.color }}>{statusLbl}</span>
          </span>
          <button className="sheet-close" aria-label={t("close")} onClick={onClose}><IconX size={14} /></button>
        </div>
        <div style={{ padding:"0 20px 20px" }}>
          <div className="flex items-center gap-3" style={{ marginBottom:20 }}>
            <div className="row-avatar" style={{ background: isTutor ? "var(--purple)" : getClientColor(session.colorIdx), width:52, height:52, fontSize:16, border: isTutor ? "2px dashed var(--purple-bg)" : undefined }}>{displayInitials}</div>
            <div>
              <div style={{ fontFamily:"var(--font-d)", fontSize:17, fontWeight:800, color:"var(--charcoal)" }}>
                {session.patient}
                {isTutor && <span style={{ fontSize:11, fontWeight:700, color:"var(--purple)", marginLeft:6 }}>TUTOR</span>}
              </div>
              <div style={{ fontSize:13, color:"var(--charcoal-xl)", marginTop:2 }}>{session.day} {session.date} · {session.time} - {endTime}</div>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
            <div style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 14px" }}>
              <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:4 }}>{t("sessions.rate")}</div>
              <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:700, color:"var(--charcoal)" }}>{rate}</div>
            </div>
            <div role="button" tabIndex={0} onClick={() => onUpdateModality && onUpdateModality(session.id, session.modality === "virtual" ? "presencial" : "virtual")}
              style={{ background: session.modality === "virtual" ? "var(--blue-bg)" : "var(--cream)", borderRadius:"var(--radius)", padding:"12px 14px", cursor: onUpdateModality ? "pointer" : undefined }}>
              <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:4 }}>{t("sessions.modality")}</div>
              <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:700, color: session.modality === "virtual" ? "var(--blue)" : "var(--charcoal)" }}>
                {session.modality === "virtual" ? t("sessions.virtual") : t("sessions.presencial")}
              </div>
            </div>
          </div>

          {/* Cancel reason display for already-cancelled sessions */}
          {isCancelled && session.cancel_reason && (
            <div style={{ background:"var(--amber-bg)", borderRadius:"var(--radius)", padding:"10px 14px", marginBottom:14, fontSize:12, color:"var(--charcoal-md)", lineHeight:1.5 }}>
              <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", color:"var(--amber)", marginBottom:4 }}>{t("sessions.cancelMotivo")}</div>
              {session.cancel_reason}
            </div>
          )}

          {confirmDelete ? (
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:14, fontWeight:600, color:"var(--charcoal)", marginBottom:14 }}>{t("sessions.deleteConfirm")}</div>
              <button className="btn btn-danger" style={{ marginBottom:10 }} onClick={async () => { await onDelete(session.id); onClose(); }} disabled={mutating}>
                {mutating ? t("patients.deleting") : t("sessions.yesDelete")}
              </button>
              <button className="btn btn-secondary w-full" onClick={() => setConfirmDelete(false)}>{t("cancel")}</button>
            </div>
          ) : rescheduling ? (
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:"var(--charcoal)", marginBottom:12 }}>{t("sessions.reschedule")}</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div className="input-group">
                  <label className="input-label">{t("finances.paymentDate")}</label>
                  <input className="input" type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
                </div>
                <div className="input-group">
                  <label className="input-label">{t("patients.time")}</label>
                  <input className="input" type="time" value={newTime} onChange={e => setNewTime(e.target.value)} />
                </div>
              </div>
              <div className="input-group">
                <label className="input-label">{t("sessions.duration")}</label>
                <select className="input" value={newDuration} onChange={e => setNewDuration(e.target.value)}>
                  <option value="30">30 min</option>
                  <option value="45">45 min</option>
                  <option value="60">1 hora</option>
                  <option value="90">1½ horas</option>
                  <option value="120">2 horas</option>
                </select>
              </div>
              {rescheduleErr && <div className="form-error">{rescheduleErr}</div>}
              <button className="btn btn-primary" style={{ marginBottom:10 }} onClick={submitReschedule} disabled={mutating}>
                {mutating ? t("saving") : t("sessions.confirm")}
              </button>
              <button className="btn btn-secondary w-full" onClick={() => setRescheduling(false)}>{t("back")}</button>
            </div>
          ) : cancelling ? (
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:"var(--charcoal)", marginBottom:12 }}>{t("sessions.cancelSession")}</div>
              {cancelCharge === null ? (
                <>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                    <button className="btn" style={{ height:44, fontSize:12, background:"var(--amber-bg)", color:"var(--amber)", boxShadow:"none" }}
                      onClick={() => setCancelCharge(true)}>
                      {t("sessions.cancelAndCharge")}
                    </button>
                    <button className="btn" style={{ height:44, fontSize:12, background:"var(--cream)", color:"var(--charcoal-lt)", boxShadow:"none" }}
                      onClick={() => setCancelCharge(false)}>
                      {t("sessions.cancelNoCharge")}
                    </button>
                  </div>
                  <button className="btn btn-secondary w-full" onClick={() => setCancelling(false)}>{t("back")}</button>
                </>
              ) : (
                <>
                  <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginBottom:12, lineHeight:1.5 }}>
                    {cancelCharge ? t("sessions.cancelChargeExplain") : t("sessions.cancelNoChargeExplain")}
                  </div>
                  <div className="input-group">
                    <label className="input-label">{t("sessions.cancelReason")}</label>
                    <textarea className="input" value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                      placeholder={t("sessions.cancelReasonPlaceholder")}
                      rows={2} style={{ resize:"none", fontFamily:"var(--font)", fontSize:13 }} />
                  </div>
                  <button className="btn" style={{ width:"100%", height:44, marginBottom:10, background: cancelCharge ? "var(--amber)" : "var(--charcoal-md)", color:"white", boxShadow:"none", fontWeight:700 }}
                    onClick={submitCancel} disabled={mutating}>
                    {mutating ? t("saving") : t("sessions.confirmCancel")}
                  </button>
                  <button className="btn btn-secondary w-full" onClick={() => setCancelCharge(null)}>{t("back")}</button>
                </>
              )}
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {/* Reschedule — primary action */}
              <button className="btn btn-primary" style={{ height:44 }} onClick={startReschedule}>
                {t("sessions.reschedule")}
              </button>

              {/* Cancel — single button for both charge/no-charge */}
              {!isCancelled && (
                <button className="btn" style={{ height:44, fontSize:13, background:"var(--amber-bg)", color:"var(--amber)", boxShadow:"none" }}
                  onClick={startCancel} disabled={mutating}>
                  {t("sessions.cancelSession")}
                </button>
              )}

              {/* Note + Document side by side */}
              <div style={{ display:"grid", gridTemplateColumns: onAttachDocument ? "1fr 1fr" : "1fr", gap:10 }}>
                {onOpenNote && (() => {
                  const hasNote = notes?.some(n => n.session_id === session.id);
                  return (
                    <button className="btn" style={{ height:44, fontSize:13, background:"var(--teal-pale)", color:"var(--teal-dark)", boxShadow:"none", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
                      onClick={() => onOpenNote(session)}>
                      <IconClipboard size={15} /> {hasNote ? t("notes.viewNote") : t("notes.addNote")}
                    </button>
                  );
                })()}
                {onAttachDocument && (
                  <button className="btn" style={{ height:44, fontSize:13, background:"var(--teal-pale)", color:"var(--teal-dark)", boxShadow:"none", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
                    onClick={() => onAttachDocument(session)}>
                    <IconUpload size={15} /> {t("sessions.attachDoc")}
                  </button>
                )}
              </div>

              {/* Delete — least prominent */}
              <button className="btn" style={{ height:44, fontSize:13, background:"var(--red-bg)", color:"var(--red)", boxShadow:"none" }}
                onClick={() => setConfirmDelete(true)}>
                {t("delete")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
