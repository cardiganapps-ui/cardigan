import { useState } from "react";
import { getClientColor } from "../data/seedData";
import { isCancelledStatus, isTutorSession, tutorDisplayInitials, statusClass } from "../utils/sessions";
import { shortDateToISO, isoToShortDate } from "../utils/dates";
import { IconX, IconTrash } from "./Icons";
import { Avatar } from "./Avatar";
import { haptic } from "../utils/haptics";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useSheetDrag } from "../hooks/useSheetDrag";
import { useCardigan } from "../context/CardiganContext";
import { getModalitiesForProfession, MODALITY_I18N_KEY } from "../data/constants";
import { formatMXN } from "../utils/format";

export function SessionSheet({ session, patients, onClose, onCancelSession, onDelete, onReschedule, onUpdateModality, onUpdateRate, onUpdateCancelReason, mutating, initialMode }) {
  const { t } = useT();
  const { openExpediente, profession } = useCardigan();
  const modalities = getModalitiesForProfession(profession);
  useEscape(session ? onClose : null);
  const panelRef = useFocusTrap(!!session);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose);
  const setPanel = (el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };
  const [confirmDelete, setConfirmDelete] = useState(false);
  // initialMode="reschedule" opens the sheet directly in reschedule UI —
  // used by the long-press gesture on mobile week-view events so the
  // path from "I want to move this session" to the date/time form is
  // one gesture instead of tap → button.
  const [rescheduling, setRescheduling] = useState(initialMode === "reschedule");
  const [cancelling, setCancelling] = useState(false);
  const [cancelCharge, setCancelCharge] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  // Pre-fill the reschedule inputs with the session's current slot when
  // the sheet opens straight into reschedule mode. Otherwise they get
  // set lazily by startReschedule() once the user taps the button.
  const [newDate, setNewDate] = useState(() => (initialMode === "reschedule" && session) ? shortDateToISO(session.date) : "");
  const [newTime, setNewTime] = useState(() => (initialMode === "reschedule" && session?.time) ? session.time : "");
  const [newDuration, setNewDuration] = useState(() => (initialMode === "reschedule" && session?.duration) ? String(session.duration) : "60");
  const [rescheduleErr, setRescheduleErr] = useState("");
  const [editingRate, setEditingRate] = useState(false);
  const [rateInput, setRateInput] = useState("");
  const [editingReason, setEditingReason] = useState(false);
  const [reasonInput, setReasonInput] = useState("");
  if (!session) return null;
  const sessionRate = session.rate != null ? session.rate : (patients?.find(p => p.name === session.patient)?.rate || 0);
  const rateDisplay = `${formatMXN(sessionRate)}`;
  const isCancelled = isCancelledStatus(session.status);
  const statusLbl = t(`sessions.${session.status}`);
  const isTutor = isTutorSession(session);
  const displayInitials = isTutor ? tutorDisplayInitials(session) : session.initials;

  const dur = session.duration || 60;
  const [h, m] = (session.time || "0:0").split(":");
  const endDate = new Date(0, 0, 0, +h, +m);
  endDate.setMinutes(endDate.getMinutes() + dur);
  const endTime = `${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}`;

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
    if (ok) {
      haptic.success();
      // Mirror the cancel flow: reschedule is a terminal action on
      // this session view, so dismiss the sheet so the user lands
      // back on the screen that opened it instead of staring at a
      // now-stale session mid-sheet.
      setRescheduling(false);
      onClose();
    }
  };

  const startCancel = () => {
    setCancelCharge(null);
    setCancelReason("");
    setCancelling(true);
  };

  const submitCancel = async () => {
    const ok = await onCancelSession(session, cancelCharge, cancelReason.trim());
    if (ok) {
      haptic.warn();
      // Cancellation is a terminal action on this session — dismiss the
      // sheet so the user lands back on whichever screen opened it
      // (Home, Agenda, Patient expediente, etc.) instead of staring at
      // the now-cancelled session mid-sheet.
      setCancelling(false);
      onClose();
    }
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div ref={setPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...panelHandlers}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title" style={{ display:"flex", alignItems:"center", gap:8 }}>
            {t("sessions.session")}
            <span className={`session-status ${statusClass(session.status)}`}>{statusLbl}</span>
          </span>
          <button className="sheet-close" aria-label={t("close")} onClick={onClose}><IconX size={14} /></button>
        </div>
        <div style={{ padding:"0 20px 22px" }}>
          <div className="flex items-center gap-3" style={{ marginBottom:20, position:"relative" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"inherit", flex:1, minWidth:0, cursor:"pointer", WebkitTapHighlightColor:"transparent" }}
              onClick={() => { const p = patients?.find(p => p.id === session.patient_id); if (p) { onClose(); openExpediente(p); } }}>
              <Avatar initials={displayInitials}
                color={isTutor ? "var(--purple)" : getClientColor(session.colorIdx)} size="lg" />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-lg)", fontWeight:800, color:"var(--charcoal)" }}>
                  {session.patient}
                  {isTutor && <span style={{ fontSize:"var(--text-xs)", fontWeight:700, color:"var(--purple)", marginLeft:6, textTransform:"uppercase" }}>{t("sessions.tutor")}</span>}
                </div>
                <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)", marginTop:2 }}>{session.day} {session.date} · {session.time} - {endTime}</div>
              </div>
            </div>
            <button aria-label={t("delete")} onClick={() => setConfirmDelete(true)}
              style={{ width:30, height:30, borderRadius:"50%", background:"var(--red-bg)", color:"var(--red)", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0, minHeight:"unset", flexShrink:0 }}>
              <IconTrash size={14} />
            </button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
            <div role="button" tabIndex={0}
              onClick={() => { if (onUpdateRate && !editingRate) { setRateInput(String(sessionRate)); setEditingRate(true); } }}
              className="stat-tile"
              style={{ background:"var(--cream)", cursor: onUpdateRate ? "pointer" : undefined }}>
              <div className="stat-tile-label">{t("sessions.rate")}</div>
              {editingRate ? (
                <form onSubmit={async (e) => { e.preventDefault(); const ok = await onUpdateRate(session.id, rateInput); if (ok) setEditingRate(false); }}
                  style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <span style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:700, color:"var(--charcoal)" }}>$</span>
                  <input type="number" className="input" value={rateInput} onChange={e => setRateInput(e.target.value)}
                    autoFocus onBlur={async () => { const ok = await onUpdateRate(session.id, rateInput); if (ok) setEditingRate(false); else setEditingRate(false); }}
                    onClick={e => e.stopPropagation()}
                    style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:700, padding:"0 4px", height:22, width:"100%", minHeight:"unset" }} />
                </form>
              ) : (
                <div className="stat-tile-val" style={{ fontSize:"var(--text-md)", color:"var(--charcoal)" }}>{rateDisplay}</div>
              )}
            </div>
            {(() => {
              // Cycle through the active profession's allowed modalities.
              // Defensive: if the session's modality isn't in the current
              // set (e.g. an old row from a profession-switched account),
              // fall back to the first modality so the toggle still works.
              const mod = modalities.includes(session.modality) ? session.modality : modalities[0];
              const next = modalities[(modalities.indexOf(mod) + 1) % modalities.length];
              // Per-modality colour tints. a-domicilio reuses --amber to
              // suggest "going somewhere" without colliding with the
              // purple used for tutor-of-minor sessions.
              const TINT = {
                presencial:    { bg: "var(--cream)",      fg: "var(--charcoal)" },
                virtual:       { bg: "var(--blue-bg)",    fg: "var(--blue)" },
                telefonica:    { bg: "var(--green-bg)",   fg: "var(--green)" },
                "a-domicilio": { bg: "var(--amber-bg)",   fg: "var(--amber)" },
              };
              const tint = TINT[mod] ?? TINT.presencial;
              return (
                <div role="button" tabIndex={0} onClick={() => onUpdateModality && onUpdateModality(session.id, next)}
                  className={`stat-tile ${onUpdateModality ? "modality-toggle" : ""}`}
                  style={{ background: tint.bg, cursor: onUpdateModality ? "pointer" : undefined, transition:"background 0.5s ease, transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)", WebkitTapHighlightColor:"transparent", userSelect:"none" }}>
                  <div className="stat-tile-label">{t("sessions.modality")}</div>
                  <div className="stat-tile-val" style={{ fontSize:"var(--text-md)", color: tint.fg, transition:"color 0.5s ease" }}>
                    {t(`sessions.${MODALITY_I18N_KEY[mod]}`)}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Cancel reason for already-cancelled sessions — tap to add or
              edit. A session cancelled without a reason can still be
              annotated later without reverting its status. */}
          {isCancelled && onUpdateCancelReason && (
            <div style={{ background:"var(--amber-bg)", borderRadius:"var(--radius)", padding:"10px 14px", marginBottom:14, fontSize:"var(--text-sm)", color:"var(--charcoal-md)", lineHeight:1.5 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4 }}>
                <div style={{ fontSize:"var(--text-eyebrow)", fontWeight:700, textTransform:"uppercase", color:"var(--amber)" }}>{t("sessions.cancelMotivo")}</div>
                {!editingReason && (
                  <button type="button"
                    onClick={() => { setReasonInput(session.cancel_reason || ""); setEditingReason(true); }}
                    style={{ background:"transparent", border:"none", color:"var(--amber)", fontSize:"var(--text-eyebrow)", fontWeight:700, textTransform:"uppercase", cursor:"pointer", padding:0, minHeight:"unset" }}>
                    {session.cancel_reason ? t("edit") : t("add")}
                  </button>
                )}
              </div>
              {editingReason ? (
                <>
                  <textarea className="input" value={reasonInput} onChange={e => setReasonInput(e.target.value)}
                    placeholder={t("sessions.cancelReasonPlaceholder")}
                    rows={2} autoFocus
                    style={{ resize:"none", fontFamily:"var(--font)", fontSize:13, background:"var(--white)" }} />
                  <div style={{ display:"flex", gap:8, marginTop:8 }}>
                    <button className="btn btn-secondary" style={{ flex:1, height:36, fontSize:12 }}
                      onClick={() => setEditingReason(false)}>{t("cancel")}</button>
                    <button className="btn" style={{ flex:1, height:36, fontSize:12, background:"var(--amber)", color:"var(--white)", boxShadow:"none", fontWeight:700 }}
                      disabled={mutating}
                      onClick={async () => {
                        const ok = await onUpdateCancelReason(session.id, reasonInput);
                        if (ok) setEditingReason(false);
                      }}>{mutating ? t("saving") : t("save")}</button>
                  </div>
                </>
              ) : session.cancel_reason ? (
                <div>{session.cancel_reason}</div>
              ) : (
                <div style={{ color:"var(--charcoal-xl)", fontStyle:"italic" }}>{t("sessions.cancelReasonEmpty")}</div>
              )}
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
              <button className="btn btn-primary-teal" style={{ marginBottom:10 }} onClick={submitReschedule} disabled={mutating}>
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
                  <button className="btn" style={{ width:"100%", height:44, marginBottom:10, background: cancelCharge ? "var(--amber)" : "var(--charcoal-md)", color:"var(--white)", boxShadow:"none", fontWeight:700 }}
                    onClick={submitCancel} disabled={mutating}>
                    {mutating ? t("saving") : t("sessions.confirmCancel")}
                  </button>
                  <button className="btn btn-secondary w-full" onClick={() => setCancelCharge(null)}>{t("back")}</button>
                </>
              )}
            </div>
          ) : (
            <div style={{ display:"flex", gap:10 }}>
              <button className="btn btn-secondary" style={{ flex:1, height:44 }} onClick={startReschedule}>
                {t("sessions.reschedule")}
              </button>
              {!isCancelled && (
                <button
                  className="btn btn-secondary"
                  style={{ flex:1, height:44, color:"var(--red)", borderColor:"var(--red-bg)" }}
                  onClick={startCancel}
                  disabled={mutating}
                >
                  {t("sessions.cancelSession")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
