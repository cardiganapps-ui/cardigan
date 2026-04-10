import { useState } from "react";
import { clientColors } from "../data/seedData";
import { shortDateToISO, isoToShortDate } from "../utils/dates";
import { IconX, IconClipboard } from "./Icons";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";

export function SessionSheet({ session, patients, notes, onClose, onCancelSession, onMarkCompleted, onDelete, onReschedule, onOpenNote, mutating }) {
  const { t } = useT();
  useEscape(session ? onClose : null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelCharge, setCancelCharge] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [rescheduleErr, setRescheduleErr] = useState("");
  if (!session) return null;
  const patientData = patients?.find(p => p.name === session.patient);
  const rate = patientData ? `$${patientData.rate.toLocaleString()}` : "—";
  const isCancelled = session.status === "cancelled" || session.status === "charged";
  const isCompleted = session.status === "completed";
  const isScheduled = session.status === "scheduled";
  const statusLbl = t(`sessions.${session.status}`);
  const isTutor = session.initials?.startsWith("T·");
  const displayInitials = isTutor ? session.initials.replace("T·", "") : session.initials;

  const startReschedule = () => {
    setNewDate(shortDateToISO(session.date));
    setNewTime(session.time);
    setRescheduleErr("");
    setRescheduling(true);
  };

  const submitReschedule = async () => {
    if (!newDate) { setRescheduleErr(t("sessions.selectDate")); return; }
    if (!newTime.trim()) { setRescheduleErr(t("sessions.selectTime")); return; }
    setRescheduleErr("");
    const ok = await onReschedule(session.id, isoToShortDate(newDate), newTime);
    if (ok) setRescheduling(false);
  };

  const startCancel = (charge) => {
    setCancelCharge(charge);
    setCancelReason("");
    setCancelling(true);
  };

  const submitCancel = async () => {
    const ok = await onCancelSession(session, cancelCharge, cancelReason.trim());
    if (ok) setCancelling(false);
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{ maxHeight:"92vh", overflowY:"auto" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("sessions.session")}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={onClose}><IconX size={14} /></button>
        </div>
        <div style={{ padding:"0 20px 20px" }}>
          <div className="flex items-center gap-3" style={{ marginBottom:20 }}>
            <div className="row-avatar" style={{ background: isTutor ? "var(--purple)" : clientColors[(session.colorIdx || 0) % clientColors.length], width:52, height:52, fontSize:16, border: isTutor ? "2px dashed var(--purple-bg)" : undefined }}>{displayInitials}</div>
            <div>
              <div style={{ fontFamily:"var(--font-d)", fontSize:17, fontWeight:800, color:"var(--charcoal)" }}>
                {session.patient}
                {isTutor && <span style={{ fontSize:11, fontWeight:700, color:"var(--purple)", marginLeft:6 }}>TUTOR</span>}
              </div>
              <div style={{ fontSize:13, color:"var(--charcoal-xl)", marginTop:2 }}>{session.day} {session.date} · {session.time}</div>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
            {[
              { label: t("sessions.status"), value: statusLbl, highlight: isScheduled },
              { label: t("sessions.rate"), value: rate },
            ].map((item,i) => (
              <div key={i} style={{ background:"var(--cream)", borderRadius:"var(--radius)", padding:"12px 14px" }}>
                <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:4 }}>{item.label}</div>
                <div style={{ fontFamily:"var(--font-d)", fontSize:15, fontWeight:700, color: item.highlight ? "var(--teal-dark)" : "var(--charcoal)" }}>{item.value}</div>
              </div>
            ))}
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
              {rescheduleErr && <div style={{ fontSize:12, color:"var(--red)", marginBottom:10 }}>{rescheduleErr}</div>}
              <button className="btn btn-primary" style={{ marginBottom:10 }} onClick={submitReschedule} disabled={mutating}>
                {mutating ? t("saving") : t("sessions.confirm")}
              </button>
              <button className="btn btn-secondary w-full" onClick={() => setRescheduling(false)}>{t("back")}</button>
            </div>
          ) : cancelling ? (
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:"var(--charcoal)", marginBottom:6 }}>
                {cancelCharge ? t("sessions.cancelAndCharge") : t("sessions.cancelNoCharge")}
              </div>
              <div style={{ fontSize:12, color:"var(--charcoal-xl)", marginBottom:12, lineHeight:1.5 }}>
                {cancelCharge ? t("sessions.cancelChargeExplain") : t("sessions.cancelNoChargeExplain")}
              </div>
              <div className="input-group">
                <label className="input-label">{t("sessions.cancelReason")}</label>
                <textarea className="input" value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                  placeholder={t("sessions.cancelReasonPlaceholder")}
                  rows={2} style={{ resize:"none", fontFamily:"var(--font)", fontSize:13 }} />
              </div>
              <button className="btn" style={{ width:"100%", height:44, marginBottom:10, background: cancelCharge ? "var(--amber)" : "var(--charcoal-lt)", color:"white", boxShadow:"none", fontWeight:700 }}
                onClick={submitCancel} disabled={mutating}>
                {mutating ? t("saving") : t("sessions.confirmCancel")}
              </button>
              <button className="btn btn-secondary w-full" onClick={() => setCancelling(false)}>{t("back")}</button>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {/* Status change actions — available for ALL statuses */}
              {!isCompleted && (
                <button className="btn btn-primary" style={{ height:44 }}
                  onClick={() => onMarkCompleted(session)} disabled={mutating}>
                  {t("sessions.markCompleted")}
                </button>
              )}
              {!isCancelled && (
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <button className="btn" style={{ height:44, fontSize:12, background:"var(--amber-bg)", color:"var(--amber)", boxShadow:"none" }}
                    onClick={() => startCancel(true)} disabled={mutating}>
                    {t("sessions.cancelAndCharge")}
                  </button>
                  <button className="btn" style={{ height:44, fontSize:12, background:"var(--cream)", color:"var(--charcoal-lt)", boxShadow:"none" }}
                    onClick={() => startCancel(false)} disabled={mutating}>
                    {t("sessions.cancelNoCharge")}
                  </button>
                </div>
              )}
              {/* Revert cancelled/completed back to scheduled */}
              {(isCompleted || isCancelled) && (
                <button className="btn" style={{ height:44, fontSize:12, background:"var(--teal-mist)", color:"var(--teal-dark)", boxShadow:"none" }}
                  onClick={() => onMarkCompleted(session, "scheduled")} disabled={mutating}>
                  {t("sessions.revertScheduled")}
                </button>
              )}
              {onOpenNote && (() => {
                const hasNote = notes?.some(n => n.session_id === session.id);
                return (
                  <button className="btn" style={{ height:44, fontSize:13, background:"var(--teal-pale)", color:"var(--teal-dark)", boxShadow:"none", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
                    onClick={() => onOpenNote(session)}>
                    <IconClipboard size={15} /> {hasNote ? t("notes.viewNote") : t("notes.addNote")}
                  </button>
                );
              })()}
              <button className="btn btn-primary" style={{ height:44 }} onClick={startReschedule}>
                {t("sessions.reschedule")}
              </button>
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
