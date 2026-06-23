import { useState } from "react";
import { IconX } from "../Icons";
import { Avatar } from "../Avatar";
import { useT } from "../../i18n/index";
import { useCardiganMain } from "../../context/CardiganContext";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useSheetExit } from "../../hooks/useSheetExit";
import { useLayer } from "../../hooks/useLayer";
import { getClientColor } from "../../data/seedData";
import { SESSION_STATUS } from "../../data/constants";

// Same status vocabulary + colors as the individual SessionSheet (the
// canonical sessions.* labels and the .status-* color system), so a group
// occurrence reads and works like any other session.
const STATUS_OPTS = [
  { k: SESSION_STATUS.SCHEDULED, labelKey: "sessions.scheduled",    c: "var(--teal-dark)",    bg: "var(--teal-pale)" },
  { k: SESSION_STATUS.COMPLETED, labelKey: "sessions.completed",    c: "var(--green)",        bg: "var(--green-bg)" },
  { k: SESSION_STATUS.CANCELLED, labelKey: "sessions.cancelled",    c: "var(--charcoal-lt)",  bg: "var(--cream-dark)" },
  { k: SESSION_STATUS.CHARGED,   labelKey: "sessions.chargedShort", c: "var(--amber)",        bg: "var(--amber-bg)" },
];

/* One group occurrence: per-member attendance toggles (each wired to the
   ordinary updateSessionStatus on that member's session row) + a whole-group
   "Cancelar toda la sesión" action with sin-cargo / con-cargo choice. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed group/session rows
type Row = any;

export function GroupOccurrenceSheet({ group, occurrence, onClose }: {
  group: Row;
  occurrence: { date?: string; time?: string };
  onClose: () => void;
}) {
  const { t } = useT();
  const { upcomingSessions, patients, updateSessionStatus, cancelGroupOccurrence, mutating } = useCardiganMain();
  const { exiting, animatedClose } = useSheetExit(true, onClose);
  useEscape(animatedClose);
  useLayer("group-occurrence", animatedClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose);
  const setPanel = (el: HTMLElement | null) => { panelRef.current = el; scrollRef.current = el; setPanelEl(el); };

  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reason, setReason] = useState("");

  // Live attendee rows for this (group, date, time) — read from the
  // enriched session list so status edits reflect immediately.
  const attendees = upcomingSessions.filter((s: Row) =>
    s.group_id === group.id && s.date === occurrence.date && s.time === occurrence.time);
  const patientsById = new Map<string, Row>(patients.map((p: Row): [string, Row] => [p.id, p]));

  // `attendees` come from the enriched session list, where a past
  // still-scheduled row is auto-displayed as "completed" (_autoCompleted).
  // Those DB rows are genuinely still 'scheduled' and cancellable, so the
  // whole-group cancel must offer for them too — cancelGroupOccurrence
  // filters the RAW 'scheduled' rows in the hook regardless.
  const anyScheduled = attendees.some((a: Row) => a.status === SESSION_STATUS.SCHEDULED || a._autoCompleted);

  const doGroupCancel = async (status: string) => {
    await cancelGroupOccurrence(group.id, occurrence.date, occurrence.time, { status, reason: reason.trim() || null });
    animatedClose();
  };

  return (
    <div className={`sheet-overlay ${exiting ? "sheet-overlay--exit" : ""}`} onClick={animatedClose}>
      <div ref={setPanel} className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`} role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...panelHandlers} style={{ maxHeight:"min(90lvh, calc(100lvh - var(--sat) - 16px))" }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{group.name}</span>
          <button className="sheet-close" aria-label={t("close")} onClick={animatedClose}><IconX size={14} /></button>
        </div>
        <div style={{ padding:"0 20px 22px" }}>
          <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-md)", fontWeight:600, marginBottom:14 }}>
            {occurrence.date} · {occurrence.time}
          </div>

          <div className="section-sub" style={{ marginBottom:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>{t("groups.attendance")}</div>
          <div className="card" style={{ marginBottom:18 }}>
            {attendees.map((s: Row) => {
              const p = patientsById.get(s.patient_id);
              const idx = p?.colorIdx ?? 0;
              return (
                <div key={s.id} className="row-item" style={{ flexDirection:"column", alignItems:"stretch", gap:8 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <Avatar initials={s.initials || p?.initials || "?"} color={getClientColor(idx)} size="sm" />
                    <div className="row-content"><div className="row-title">{s.patient || p?.name}</div></div>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:6 }}>
                    {STATUS_OPTS.map(opt => {
                      const on = s.status === opt.k;
                      return (
                        <button key={opt.k} type="button" disabled={mutating}
                          onClick={() => updateSessionStatus(s.id, opt.k)}
                          className="btn-tap"
                          style={{ padding:"7px 4px", fontSize:11, fontWeight:700, borderRadius:"var(--radius-sm)",
                            border: on ? `2px solid ${opt.c}` : "1.5px solid var(--border)",
                            background: on ? opt.bg : "var(--white)", color: on ? opt.c : "var(--charcoal-lt)",
                            cursor:"pointer", fontFamily:"var(--font)" }}>
                          {t(opt.labelKey)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {anyScheduled && (
            confirmCancel ? (
              <div className="card" style={{ padding:14, background:"var(--red-bg)", border:"1px solid var(--red)" }}>
                <div style={{ fontWeight:700, marginBottom:10, color:"var(--red)" }}>{t("groups.cancelOccurrenceTitle")}</div>
                <div className="input-group">
                  <label className="input-label">{t("groups.cancelReason")}</label>
                  <input className="input" value={reason} onChange={e => setReason(e.target.value)} />
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  <button type="button" className="btn btn-secondary" disabled={mutating} onClick={() => doGroupCancel(SESSION_STATUS.CANCELLED)}>{t("groups.cancelNoCharge")}</button>
                  <button type="button" className="btn btn-warning" disabled={mutating} onClick={() => doGroupCancel(SESSION_STATUS.CHARGED)}>{t("groups.cancelWithCharge")}</button>
                </div>
                <button type="button" className="btn btn-ghost" style={{ width:"100%", marginTop:8 }} onClick={() => setConfirmCancel(false)}>{t("cancel")}</button>
              </div>
            ) : (
              <button type="button" className="btn btn-danger" style={{ width:"100%" }} onClick={() => setConfirmCancel(true)}>
                {t("groups.cancelOccurrence")}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
