import { useState, useMemo } from "react";
import { IconX, IconPlus, IconTrash, IconEdit, IconChevronRight } from "../components/Icons";
import { Avatar } from "../components/Avatar";
import { SegmentedControl } from "../components/SegmentedControl";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { MembersPickerSheet } from "../components/sheets/MembersPickerSheet";
import { GroupOccurrenceSheet } from "../components/sheets/GroupOccurrenceSheet";
import { GroupScheduleSheet } from "../components/sheets/GroupScheduleSheet";
import { NoteEditor } from "../components/NoteEditor";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";
import { useEscape } from "../hooks/useEscape";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useSheetDrag } from "../hooks/useSheetDrag";
import { useSheetExit } from "../hooks/useSheetExit";
import { useLayer } from "../hooks/useLayer";
import { getClientColor } from "../data/seedData";
import { buildGroupRoster, groupOccurrences, groupFinancesRollup, activeMemberCount } from "../utils/groups";
import { GROUP_STATUS, SESSION_STATUS, MODALITY_I18N_KEY } from "../data/constants";
import { formatMXN } from "../utils/format";
import { parseShortDate } from "../utils/dates";
import { haptic } from "../utils/haptics";

/* Group management overlay. Tabbed (Resumen / Integrantes / Sesiones /
   Finanzas), mirroring PatientExpediente so it feels native. Composes the
   member-picker, occurrence, and schedule sheets + destructive confirms. */
export function GroupDetail({ group, onClose }) {
  const { t } = useT();
  const {
    groups, groupMembers, patients, upcomingSessions, notes, readOnly,
    deleteGroup, endGroup, removeMember, createNote, updateNote, deleteNote, mutating,
  } = useCardigan();
  const { exiting, animatedClose } = useSheetExit(true, onClose);
  useEscape(animatedClose);
  useLayer("group-detail", animatedClose);
  const panelRef = useFocusTrap(true);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose);
  const setPanel = (el) => { panelRef.current = el; scrollRef.current = el; setPanelEl(el); };

  const [tab, setTab] = useState("resumen");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [occurrence, setOccurrence] = useState(null);
  const [confirm, setConfirm] = useState(null); // { type, member? }
  const [editingNote, setEditingNote] = useState(null);

  // Always read the live group from context so edits reflect immediately.
  const g = groups.find(x => x.id === group.id) || group;
  const patientsById = useMemo(() => new Map(patients.map(p => [p.id, p])), [patients]);
  const roster = useMemo(() => buildGroupRoster(g, groupMembers, patientsById), [g, groupMembers, patientsById]);
  const occurrences = useMemo(() => groupOccurrences(g, upcomingSessions), [g, upcomingSessions]);
  const rollup = useMemo(() => groupFinancesRollup(g, groupMembers, upcomingSessions, patientsById), [g, groupMembers, upcomingSessions, patientsById]);
  const memberCount = activeMemberCount(g, groupMembers);

  const nextOcc = occurrences.filter(o => o.status === SESSION_STATUS.SCHEDULED)
    .sort((a, b) => parseShortDate(a.date) - parseShortDate(b.date))[0];

  const tabs = [
    { k: "resumen", l: t("groups.tabResumen") },
    { k: "integrantes", l: t("groups.tabIntegrantes") },
    { k: "sesiones", l: t("groups.tabSesiones") },
    { k: "finanzas", l: t("groups.tabFinanzas") },
    { k: "notas", l: t("nav.notes") },
  ];

  const groupNotes = (notes || [])
    .filter(n => n.group_id === g.id && !n._deleted_at)
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));

  const newGroupNote = async () => {
    const n = await createNote({ groupId: g.id, title: "", content: "" });
    if (n) setEditingNote(n);
  };

  const existingActiveIds = groupMembers.filter(m => m.group_id === g.id && m.left_at == null).map(m => m.patient_id);

  const doConfirm = async () => {
    if (!confirm) return;
    if (confirm.type === "delete") { await deleteGroup(g.id); animatedClose(); }
    else if (confirm.type === "end") { await endGroup(g.id); setConfirm(null); }
    else if (confirm.type === "remove") { await removeMember(g.id, confirm.member.patient_id); setConfirm(null); }
  };

  return (
    <div className={`sheet-overlay ${exiting ? "sheet-overlay--exit" : ""}`} onClick={animatedClose}>
      <div ref={setPanel} className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`} role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...panelHandlers}
        style={{ maxHeight:"min(94lvh, calc(100lvh - var(--sat) - 12px))" }}>
        <div className="sheet-handle" />
        <div className="sheet-header" style={{ gap:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
            <Avatar initials={(g.name || "?").slice(0, 2).toUpperCase()} color={getClientColor(g.colorIdx ?? g.color_idx ?? 0)} size="md" />
            <div style={{ minWidth:0 }}>
              <div className="sheet-title" style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{g.name}</div>
              <div style={{ fontSize:"var(--text-xs)", color:"var(--charcoal-xl)", fontWeight:700 }}>
                {memberCount === 1 ? t("groups.memberCountOne") : t("groups.membersCount", { count: memberCount })}
                {g.status === GROUP_STATUS.ENDED && ` · ${t("groups.ended")}`}
              </div>
            </div>
          </div>
          <button className="sheet-close" aria-label={t("close")} onClick={animatedClose}><IconX size={14} /></button>
        </div>

        <div style={{ padding:"4px 20px 0" }}>
          <SegmentedControl items={tabs} value={tab} onChange={setTab} size="md" ariaLabel={t("groups.title")} />
        </div>

        <div style={{ padding:"16px 20px 24px", overflowY:"auto" }}>
          {/* ── Resumen ── */}
          {tab === "resumen" && (
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <div className="card" style={{ padding:14 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                  <span className="section-sub" style={{ textTransform:"uppercase", letterSpacing:"0.06em" }}>{t("groups.schedule")}</span>
                  {!readOnly && g.status === GROUP_STATUS.ACTIVE && g.day && (
                    <button className="btn-tap" style={{ background:"none", border:"none", color:"var(--teal-dark)", fontWeight:700, fontSize:"var(--text-sm)", cursor:"pointer", display:"inline-flex", alignItems:"center", gap:4 }}
                      onClick={() => setScheduleOpen(true)}><IconEdit size={14} /> {t("edit")}</button>
                  )}
                </div>
                {g.day && g.time ? (
                  <div style={{ fontSize:"var(--text-md)", fontWeight:700 }}>{g.day} · {g.time}</div>
                ) : (
                  <div style={{ fontSize:"var(--text-md)", fontWeight:700 }}>{t("groups.oneOff")}</div>
                )}
                <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-md)", marginTop:4 }}>
                  {g.duration || 60} min · {t(`sessions.${MODALITY_I18N_KEY[g.modality] || "presencial"}`)} · {g.rate != null ? formatMXN(g.rate) : "—"}
                </div>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div className="kpi-card">
                  <div className="kpi-label">{t("groups.nextSession")}</div>
                  <div className="kpi-value" style={{ fontSize:"var(--text-lg)" }}>{nextOcc ? nextOcc.date : "—"}</div>
                  {nextOcc && <div className="kpi-meta">{nextOcc.time}</div>}
                </div>
                <div className="kpi-card">
                  <div className="kpi-label">{t("groups.consumed")}</div>
                  <div className="kpi-value" style={{ fontSize:"var(--text-lg)", fontVariantNumeric:"tabular-nums" }}>{formatMXN(rollup.totalConsumed)}</div>
                </div>
              </div>

              {!readOnly && (
                <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:6 }}>
                  {g.status === GROUP_STATUS.ACTIVE && (
                    <button className="btn btn-secondary" onClick={() => setConfirm({ type: "end" })}>{t("groups.end")}</button>
                  )}
                  <button className="btn btn-danger" onClick={() => setConfirm({ type: "delete" })}>
                    <IconTrash size={15} /> {t("groups.delete")}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Integrantes ── */}
          {tab === "integrantes" && (
            <div>
              {!readOnly && (
                <button className="btn btn-primary-teal" style={{ width:"100%", marginBottom:14 }} onClick={() => setPickerOpen(true)}>
                  <IconPlus size={16} /> {t("groups.addMembers")}
                </button>
              )}
              {roster.members.filter(m => m.active).length === 0 ? (
                <EmptyState kind="patients" title={t("groups.noMembers")} body="" />
              ) : (
                <div className="card">
                  {roster.members.filter(m => m.active).map((m, i) => {
                    const p = m.patient;
                    return (
                      <div key={m.id} className="row-item">
                        <Avatar initials={p?.initials || "?"} color={getClientColor(p?.colorIdx ?? i)} size="sm" />
                        <div className="row-content">
                          <div className="row-title">{p?.name || "—"}</div>
                          {p && <div className="row-sub" style={{ fontVariantNumeric:"tabular-nums" }}>{p.amountDue > 0 ? `${t("patients.withDebt")}: ${formatMXN(p.amountDue)}` : t("patients.upToDate")}</div>}
                        </div>
                        {!readOnly && (
                          <button className="btn-tap" aria-label={t("groups.removeMember")} onClick={() => setConfirm({ type: "remove", member: m })}
                            style={{ background:"none", border:"none", color:"var(--red)", cursor:"pointer", padding:8 }}>
                            <IconTrash size={16} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Sesiones ── */}
          {tab === "sesiones" && (
            occurrences.length === 0 ? (
              <EmptyState kind="agenda" title={t("groups.noUpcoming")} body="" />
            ) : (
              <div className="card">
                {occurrences.map((o) => {
                  const rail = o.status === SESSION_STATUS.CANCELLED ? "cancelled" : o.status === SESSION_STATUS.COMPLETED ? "completed" : "scheduled";
                  return (
                    <button key={`${o.date}|${o.time}`} className="row-item session-row btn-tap" style={{ width:"100%", border:"none", background:"transparent", textAlign:"left", cursor:"pointer" }}
                      onClick={() => { haptic.tap(); setOccurrence(o); }} data-rail={rail}>
                      <span className={`session-rail rail-${rail}`} aria-hidden style={{ width:4, alignSelf:"stretch", borderRadius:4, background: rail==="cancelled" ? "var(--red)" : rail==="completed" ? "var(--green)" : "var(--teal)" }} />
                      <div className="row-content">
                        <div className="row-title">{o.date} · {o.time}</div>
                        <div className="row-sub">{o.count === 1 ? t("groups.memberCountOne") : t("groups.membersCount", { count: o.count })}</div>
                      </div>
                      <span className="row-chevron" aria-hidden><IconChevronRight size={16} /></span>
                    </button>
                  );
                })}
              </div>
            )
          )}

          {/* ── Finanzas ── */}
          {tab === "finanzas" && (
            <div>
              <div className="kpi-card" style={{ marginBottom:14 }}>
                <div className="kpi-label">{t("groups.consumed")}</div>
                <div className="kpi-value" style={{ fontVariantNumeric:"tabular-nums" }}>{formatMXN(rollup.totalConsumed)}</div>
              </div>
              <div className="card">
                {rollup.perMember.map((m) => (
                  <div key={m.patientId} className="row-item">
                    <div className="row-content">
                      <div className="row-title">{m.name}</div>
                      <div className="row-sub">{m.sessions} {t("groups.tabSesiones").toLowerCase()}</div>
                    </div>
                    <span style={{ fontWeight:700, fontVariantNumeric:"tabular-nums" }}>{formatMXN(m.consumed)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Notas ── */}
          {tab === "notas" && (
            <div>
              {!readOnly && (
                <button className="btn btn-primary-teal" style={{ width:"100%", marginBottom:14 }} onClick={newGroupNote}>
                  <IconPlus size={16} /> {t("notes.createNote")}
                </button>
              )}
              {groupNotes.length === 0 ? (
                <EmptyState kind="notes" title={t("nav.notes")} body="" />
              ) : (
                <div className="card">
                  {groupNotes.map((n) => (
                    <button key={n.id} className="row-item btn-tap" style={{ width:"100%", border:"none", background:"transparent", textAlign:"left", cursor:"pointer" }}
                      onClick={() => setEditingNote(n)}>
                      <div className="row-content">
                        <div className="row-title">{n.title?.trim() || "Sin título"}</div>
                        <div className="row-sub" style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                          {n.encrypted ? "•••" : (n.content || "").replace(/\s+/g, " ").slice(0, 80)}
                        </div>
                      </div>
                      <span className="row-chevron" aria-hidden><IconChevronRight size={16} /></span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {editingNote && (
        <NoteEditor
          note={editingNote}
          onSave={async ({ title, content }) => await updateNote(editingNote.id, { title, content })}
          onDelete={async () => { await deleteNote(editingNote.id); setEditingNote(null); }}
          onClose={() => setEditingNote(null)}
        />
      )}
      {pickerOpen && <MembersPickerSheet groupId={g.id} existingPatientIds={existingActiveIds} onClose={() => setPickerOpen(false)} />}
      {scheduleOpen && <GroupScheduleSheet group={g} onClose={() => setScheduleOpen(false)} />}
      {occurrence && <GroupOccurrenceSheet group={g} occurrence={occurrence} onClose={() => setOccurrence(null)} />}
      <ConfirmDialog
        open={!!confirm}
        destructive={confirm?.type !== "end"}
        busy={mutating}
        title={confirm?.type === "delete" ? t("groups.delete") : confirm?.type === "end" ? t("groups.end") : t("groups.removeMember")}
        body={confirm?.type === "delete" ? t("groups.deleteConfirm") : confirm?.type === "end" ? t("groups.endConfirm") : (confirm?.member ? t("groups.removeMemberConfirm", { name: confirm.member.patient?.name || "" }) : "")}
        confirmLabel={confirm?.type === "delete" ? t("groups.delete") : confirm?.type === "end" ? t("groups.end") : t("groups.removeMember")}
        onConfirm={doConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
