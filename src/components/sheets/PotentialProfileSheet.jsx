import { useState } from "react";
import { IconX, IconPhone, IconMail, IconTrash, IconCheck } from "../Icons";
import { Avatar } from "../Avatar";
import { useT } from "../../i18n/index";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useLayer } from "../../hooks/useLayer";
import { SESSION_STATUS, SESSION_TYPE } from "../../data/constants";
import { statusClass, statusLabel, railClass } from "../../utils/sessions";
import { formatPhoneMX } from "../../utils/contact";
import { formatMXN } from "../../utils/format";

/* ── PotentialProfileSheet ────────────────────────────────────────
   Slim profile for a 'potential' patient. Deliberately NOT the full
   PatientExpediente — potentials aren't real patients yet, and
   showing a full record (with sessions tabs, finanzas, archivo)
   would make the lane feel indistinguishable. The slim sheet
   surfaces just the interview + the two decisions: convert or
   discard.

   The interview session row is tappable and opens the standard
   SessionSheet via the `onOpenSession` callback (parent screen owns
   the SessionSheet rendering). When the interview is marked
   completed, an inline "¿Listos para convertir?" CTA appears as a
   gentle nudge — the same Convertir button is also at the bottom,
   so users who aren't ready yet aren't pressured.

   Discard uses an in-sheet confirmation swap (similar to the delete
   flow in Patients.jsx) rather than a separate ConfirmDialog —
   keeps the UX inside the same surface.

   Documents are intentionally hidden in v1 (avoids orphaned R2
   files when a potential is discarded; deletePatient's R2 cleanup
   only fires on hard-delete). */

export function PotentialProfileSheet({
  patient, interviewSession, onClose,
  onConvert, onDiscard, onOpenSession, mutating,
}) {
  const { t } = useT();
  useEscape(onClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose);
  useLayer("potential-profile", onClose);
  const setPanel = (el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  const [confirmDiscard, setConfirmDiscard] = useState(false);

  if (!patient) return null;

  const interviewCompleted = interviewSession && (
    interviewSession.status === SESSION_STATUS.COMPLETED
    || interviewSession.status === SESSION_STATUS.CHARGED
  );
  const interviewIsScheduled = interviewSession?.status === SESSION_STATUS.SCHEDULED;

  // End-time of the interview slot, for the row sub-text. Mirrors the
  // session-row math used elsewhere; small enough that re-deriving it
  // inline is cheaper than a memo.
  const endTime = (() => {
    if (!interviewSession?.time) return null;
    const [h, m] = interviewSession.time.split(":");
    const dur = interviewSession.duration || 60;
    const end = new Date(0, 0, 0, +h || 0, +m || 0);
    end.setMinutes(end.getMinutes() + dur);
    return `${String(end.getHours()).padStart(2,"0")}:${String(end.getMinutes()).padStart(2,"0")}`;
  })();

  const handleDiscard = async () => {
    if (!onDiscard) return;
    const ok = await onDiscard(patient.id);
    if (ok) onClose();
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div ref={setPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...panelHandlers} style={{ maxHeight:"92vh" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">
            {confirmDiscard ? t("patients.discardPotential") : patient.name}
          </span>
          <button className="sheet-close" aria-label={t("close")} onClick={onClose}><IconX size={14} /></button>
        </div>

        <div style={{ padding:"0 20px 22px" }}>
          {confirmDiscard ? (
            /* ── DISCARD CONFIRMATION ── */
            <div>
              <div style={{ textAlign:"center", marginBottom:14 }}>
                <div style={{ width:56, height:56, borderRadius:"50%", background:"var(--rose-bg)", color:"var(--rose)", display:"inline-flex", alignItems:"center", justifyContent:"center" }}>
                  <IconTrash size={24} />
                </div>
              </div>
              <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-lg)", fontWeight:800, color:"var(--charcoal)", textAlign:"center", marginBottom:8, letterSpacing:"-0.2px" }}>
                {t("patients.discardConfirmTitle", { name: patient.name })}
              </div>
              <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-md)", lineHeight:1.5, textAlign:"center", marginBottom:18 }}>
                {t("patients.discardConfirmBody")}
              </div>
              <button className="btn" type="button"
                onClick={handleDiscard}
                disabled={mutating}
                style={{ width:"100%", marginBottom:10, background:"var(--rose)", color:"var(--white)", boxShadow:"none" }}>
                {mutating ? t("patients.deleting") : t("patients.discardCta")}
              </button>
              <button className="btn btn-secondary w-full" type="button"
                onClick={() => setConfirmDiscard(false)}>
                {t("cancel")}
              </button>
            </div>
          ) : (
            /* ── PROFILE VIEW ── */
            <div>
              {/* Header card: avatar + name + Potencial pill + rate + contact */}
              <div style={{ display:"flex", alignItems:"center", gap:12, padding:"6px 0 14px", borderBottom:"1px solid var(--border-lt)", marginBottom:14 }}>
                <Avatar initials={patient.initials} color="var(--rose)" size="lg" />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:2 }}>
                    <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:800, color:"var(--charcoal)", letterSpacing:"-0.2px" }}>{patient.name}</div>
                    <span className="badge badge-rose" style={{ fontSize:"var(--text-eyebrow)", textTransform:"uppercase", letterSpacing:0.3 }}>
                      {t("patients.statusPotential")}
                    </span>
                  </div>
                  <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-lt)" }}>
                    {formatMXN(patient.rate)} {t("expediente.perSession")}
                  </div>
                  {patient.parent && (
                    <div style={{ fontSize:"var(--text-xs)", color:"var(--purple)", fontWeight:700, marginTop:2 }}>
                      {t("sessions.tutor")}: {patient.parent}
                    </div>
                  )}
                </div>
              </div>

              {/* Contact strip — only when there's something to show */}
              {(patient.phone || patient.email) && (
                <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:16 }}>
                  {patient.phone && (
                    <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:"var(--text-sm)", color:"var(--charcoal-md)" }}>
                      <IconPhone size={14} /> <span>{formatPhoneMX(patient.phone)}</span>
                    </div>
                  )}
                  {patient.email && (
                    <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:"var(--text-sm)", color:"var(--charcoal-md)" }}>
                      <IconMail size={14} /> <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{patient.email}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Interview session — single row, tappable, opens SessionSheet */}
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:"var(--text-eyebrow)", textTransform:"uppercase", letterSpacing:0.3, fontWeight:700, color:"var(--charcoal-xl)", marginBottom:8 }}>
                  {t("sessions.interview")}
                </div>
                {interviewSession ? (
                  <div className="card" style={{ overflow:"hidden" }}>
                    <div
                      className={`row-item session-row ${railClass(interviewSession.status)} ${interviewSession.session_type === SESSION_TYPE.INTERVIEW ? "rail-interview" : ""}`}
                      onClick={() => onOpenSession?.(interviewSession)}
                      role="button" tabIndex={0}>
                      <Avatar initials={patient.initials} color="var(--rose)" size="md" />
                      <div className="row-content">
                        <div className="row-title">{interviewSession.date}</div>
                        <div className="row-sub">
                          {interviewSession.time}{endTime ? ` - ${endTime}` : ""}
                        </div>
                      </div>
                      <span className={`session-status ${statusClass(interviewSession.status)}`}>{statusLabel(interviewSession.status)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="card" style={{ padding:"18px 16px", color:"var(--charcoal-xl)", fontSize:"var(--text-sm)", textAlign:"center" }}>
                    —
                  </div>
                )}
              </div>

              {/* Convert nudge — appears once the interview is marked
                  completed (or charged). Pure encouragement; the same
                  Convertir button stays at the bottom regardless. */}
              {interviewCompleted && (
                <div style={{ background:"var(--teal-pale)", borderRadius:"var(--radius)", padding:"14px", marginBottom:14, display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ width:36, height:36, borderRadius:"50%", background:"var(--teal)", color:"var(--white)", display:"inline-flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <IconCheck size={18} />
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:"var(--text-sm)", fontWeight:700, color:"var(--teal-dark)" }}>
                      {t("patients.readyToConvertCta")}
                    </div>
                  </div>
                </div>
              )}

              {/* Pending notice — when the interview hasn't happened
                  yet. Sets expectations: "this is still in evaluation". */}
              {interviewIsScheduled && (
                <div style={{ background:"var(--rose-bg)", borderRadius:"var(--radius)", padding:"12px 14px", marginBottom:14 }}>
                  <div style={{ fontSize:"var(--text-sm)", fontWeight:700, color:"var(--rose)", marginBottom:4 }}>
                    {t("patients.interviewNoticeTitle")}
                  </div>
                  <div style={{ fontSize:"var(--text-xs)", color:"var(--charcoal-md)", lineHeight:1.5 }}>
                    {t("patients.interviewNoticeBody")}
                  </div>
                </div>
              )}

              <div style={{ marginTop:18 }} />

              {/* Convert (primary) */}
              <button className="btn btn-primary-teal" type="button"
                onClick={() => onConvert?.(patient)}
                disabled={mutating}
                style={{ marginBottom:10 }}>
                {t("patients.convertToPatient")}
              </button>

              {/* Discard (secondary, rose-tinted to signal lane) */}
              <button className="btn" type="button"
                onClick={() => setConfirmDiscard(true)}
                disabled={mutating}
                style={{ width:"100%", height:44, fontSize:"var(--text-sm)", background:"var(--rose-bg)", color:"var(--rose)", boxShadow:"none", gap:8 }}>
                <IconTrash size={14} /> {t("patients.discardPotential")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
