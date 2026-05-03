import { useState, useCallback } from "react";
import { IconUser, IconCalendar, IconChevron, IconX } from "../Icons";
import { useT } from "../../i18n/index";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useEscape } from "../../hooks/useEscape";

/* ── Cardigan notes — patient/session chip ──────────────────────────
   Replaces the expandable accordion context bar with a single
   tappable pill at the top of the editor body. Tapping opens a
   bottom sheet (mobile) / compact dialog (desktop) with the two
   selects. Saves ~60 px of vertical space and matches the rest of
   the Phase-3 chip/pill vocabulary. */

export function NoteContextChip({ patients, sessions, patientId, sessionId, onChange, readOnly }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useEscape(open ? close : null);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(close, { isOpen: open });
  const setPanel = (el) => { scrollRef.current = el; setPanelEl(el); };

  const patient = patientId ? (patients || []).find(p => p.id === patientId) : null;
  const session = sessionId ? (sessions || []).find(s => s.id === sessionId) : null;

  const patientSessions = patientId
    ? (sessions || [])
        .filter(s => s.patient_id === patientId)
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    : [];

  const isLinked = !!patient;

  return (
    <>
      <button
        type="button"
        className={"mde-context-chip" + (isLinked ? " is-linked" : "")}
        onClick={() => !readOnly && setOpen(true)}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={readOnly && !isLinked}
      >
        <IconUser size={13} className="mde-context-icon" />
        <span className="mde-context-label">
          {patient ? patient.name : (t("notes.generalNote") || "Nota general")}
        </span>
        {session && (
          <>
            <span className="mde-context-sep" aria-hidden="true">·</span>
            <IconCalendar size={12} className="mde-context-icon" />
            <span className="mde-context-label" style={{ maxWidth: 120 }}>{session.date} · {session.time}</span>
          </>
        )}
        {!readOnly && <IconChevron size={14} style={{ color: "var(--charcoal-xl)", marginLeft: 2, transform: "rotate(90deg)" }} />}
      </button>

      {open && !readOnly && (
        <div className="sheet-overlay" onClick={close}>
          <div
            ref={setPanel}
            className="sheet-panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("notes.linkToPatient")}
            onClick={(e) => e.stopPropagation()}
            {...panelHandlers}
          >
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{t("notes.context") || "Vincular nota"}</span>
              <button className="sheet-close" aria-label={t("close") || "Cerrar"} onClick={close}>
                <IconX size={14} />
              </button>
            </div>
            <div className="mde-context-sheet">
              <div className="input-group">
                <label className="input-label">{t("sessions.patient") || "Paciente"}</label>
                <select
                  className="input"
                  value={patientId || ""}
                  onChange={e => onChange({ patientId: e.target.value || null, sessionId: null })}
                >
                  <option value="">{t("notes.generalNote") || "Nota general"}</option>
                  {(patients || []).filter(p => p.status === "active")
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              {patientId && patientSessions.length > 0 && (
                <div className="input-group">
                  <label className="input-label">{t("notes.linkToSession") || "Sesión (opcional)"}</label>
                  <select
                    className="input"
                    value={sessionId || ""}
                    onChange={e => onChange({ patientId, sessionId: e.target.value || null })}
                  >
                    <option value="">{t("notes.generalPatientNote")}</option>
                    {patientSessions.map(s => (
                      <option key={s.id} value={s.id}>{s.date} · {s.time} — {t(`sessions.${s.status}`) || s.status}</option>
                    ))}
                  </select>
                </div>
              )}
              <div style={{ marginTop: 14 }}>
                <button className="btn btn-primary-teal" style={{ width: "100%" }} onClick={close}>
                  {t("done") || "Listo"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
