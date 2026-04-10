import { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { clientColors, DAY_ORDER } from "../data/seedData";
import { IconSearch, IconX, IconUsers } from "../components/Icons";
import { todayISO, isoToShortDate, shortDateToISO, parseLocalDate } from "../utils/dates";
import { useEscape } from "../hooks/useEscape";
import { Toggle } from "../components/Toggle";
import { PatientExpediente } from "./PatientExpediente";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";

export function Patients() {
  const { patients, upcomingSessions, notes, payments, documents, openRecordPaymentModal, updatePatient, deletePatient, createSession, createNote, updateNote, deleteNote, uploadDocument, renameDocument, tagDocumentSession, deleteDocument, getDocumentUrl, generateRecurringSessions, applyScheduleChange, finalizePatient, mutating, setHideFab } = useCardigan();
  const { t, strings } = useT();
  const [search, setSearch]     = useState("");
  const [filter, setFilter]     = useState("all");
  const [sort, setSort]         = useState("name");
  const [selected, setSelected] = useState(null);
  const [editing, setEditing]   = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const closeSheet = useCallback(() => { setSelected(null); setEditing(false); setConfirmDelete(false); }, []);
  useEscape(selected ? closeSheet : null);
  const [expediente, setExpediente] = useState(null);
  // Edit form state
  const [editName, setEditName]       = useState("");
  const [editIsMinor, setEditIsMinor] = useState(false);
  const [editParent, setEditParent]   = useState("");
  const [editRate, setEditRate]       = useState("");
  const [editStatus, setEditStatus]   = useState("");
  const [editSchedules, setEditSchedules] = useState([{ day: "Lunes", time: "16:00" }]);
  const [effectiveDate, setEffectiveDate] = useState(todayISO());
  const [hasEndDate, setHasEndDate]       = useState(false);
  const [endDate, setEndDate]             = useState("");
  const [finishDate, setFinishDate]         = useState(todayISO());
  // Track originals to detect changes
  const [origRate, setOrigRate]           = useState(0);
  const [origSchedules, setOrigSchedules] = useState("[]");

  const openDetail = (p) => {
    setExpediente(p);
    setHideFab?.(true);
  };

  const openEditSheet = (p) => {
    setExpediente(null);
    setSelected(p);
    setEditing(false);
    setConfirmDelete(false);
  };

  const startEdit = () => {
    const scheds = [{ day: selected.day, time: selected.time }];
    setEditName(selected.name);
    setEditIsMinor(!!selected.parent);
    setEditParent(selected.parent || "");
    setEditRate(String(selected.rate));
    setEditStatus(selected.status);
    setEditSchedules(scheds);
    setOrigRate(selected.rate);
    setOrigSchedules(JSON.stringify(scheds));
    setEffectiveDate(todayISO());
    setHasEndDate(false);
    setEndDate("");
    setFinishDate(todayISO());
    setEditing(true);
  };

  const updateEditSched = (i, f, v) => setEditSchedules(prev => prev.map((s, idx) => idx === i ? { ...s, [f]: v } : s));

  const scheduleOrRateChanged = () => {
    const rateChanged = Number(editRate) !== origRate;
    const schedChanged = JSON.stringify(editSchedules) !== origSchedules;
    return rateChanged || schedChanged;
  };

  const isFinalizingPatient = editStatus === "ended" && selected?.status === "active";

  const saveEdit = async () => {
    // Finalizing a patient — delete future sessions and set inactive
    if (isFinalizingPatient) {
      const ok = await finalizePatient(selected.id, finishDate);
      if (ok) {
        // Also save any basic info changes
        await updatePatient(selected.id, {
          name: editName.trim(),
          parent: editIsMinor ? editParent.trim() : "",
        });
        setSelected(null);
        setEditing(false);
      }
      return;
    }

    if (scheduleOrRateChanged()) {
      // Schedule or rate changed — apply with effective date
      const ok = await applyScheduleChange(selected.id, {
        schedules: editSchedules,
        rate: Number(editRate) || 0,
        effectiveDate,
        endDate: hasEndDate ? endDate : null,
      });
      if (ok) {
        // Also save basic info
        await updatePatient(selected.id, {
          name: editName.trim(),
          parent: editIsMinor ? editParent.trim() : "",
          status: editStatus,
        });
        setSelected(null);
        setEditing(false);
      }
    } else {
      // Only basic info changed
      const ok = await updatePatient(selected.id, {
        name: editName.trim(),
        parent: editIsMinor ? editParent.trim() : "",
        rate: Number(editRate) || 0,
        status: editStatus,
      });
      if (ok) {
        setSelected(null);
        setEditing(false);
      }
    }
  };

  const handleDelete = async () => {
    const ok = await deletePatient(selected.id);
    if (ok) {
      setSelected(null);
      setConfirmDelete(false);
    }
  };

  const filters = [
    {k:"all",l:t("patients.all")},{k:"active",l:t("patients.active")},{k:"ended",l:t("patients.ended")},
    {k:"owes",l:t("patients.withBalance")},{k:"paid",l:t("patients.upToDate")},
  ];
  const sorts = [
    {k:"name",l:t("patients.name")},{k:"day",l:t("patients.sessionDay")},
    {k:"sessions",l:t("patients.sessions")},{k:"rate",l:t("patients.rate")},
  ];

  const applyFilter = (p) => {
    if (filter==="active") return p.status==="active";
    if (filter==="ended")  return p.status==="ended";
    if (filter==="owes")   return p.amountDue>0;
    if (filter==="paid")   return p.amountDue<=0;
    return true;
  };
  const applySort = (a,b) => {
    if (sort==="name")     return a.name.localeCompare(b.name);
    if (sort==="day")      return DAY_ORDER.indexOf(a.day)-DAY_ORDER.indexOf(b.day);
    if (sort==="sessions") return b.sessions-a.sessions;
    if (sort==="rate")     return b.rate-a.rate;
    return 0;
  };
  const filtered = patients.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) && applyFilter(p)).sort(applySort);

  // Empty state
  if (patients.length === 0) {
    return (
      <div className="page" style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", padding:"40px 24px" }}>
        <div style={{ width:56, height:56, background:"var(--teal-pale)", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:16, color:"var(--teal)" }}>
          <IconUsers size={26} />
        </div>
        <div style={{ fontFamily:"var(--font-d)", fontSize:17, fontWeight:800, color:"var(--charcoal)", marginBottom:6 }}>{t("patients.noPatients")}</div>
        <div style={{ fontSize:13, color:"var(--charcoal-xl)", lineHeight:1.5 }}>{t("patients.addFirst")}</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div style={{ padding:"16px 16px 10px" }}>
        <div className="search-bar">
          <span style={{ color:"var(--charcoal-xl)" }}><IconSearch size={16} /></span>
          <input placeholder={t("patients.searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="filter-chips">
        {filters.map(f => <button key={f.k} className={`chip ${filter===f.k?"active":""}`} onClick={() => setFilter(f.k)}>{f.l}</button>)}
      </div>
      <div className="sort-row">
        <span style={{ fontSize:12, color:"var(--charcoal-xl)", fontWeight:600 }}>{t("patients.count", { count: filtered.length })}</span>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <span className="sort-label">{t("patients.sortBy")}</span>
          <select className="sort-select" value={sort} onChange={e => setSort(e.target.value)}>
            {sorts.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}
          </select>
        </div>
      </div>
      <div style={{ padding:"0 16px 12px" }}>
        <div className="card">
          {filtered.length === 0
            ? <div style={{ padding:"28px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>{t("patients.noResults")}</div>
            : filtered.map((p,i) => (
              <div className="row-item" key={p.id} onClick={() => openDetail(p)}>
                <div className="row-avatar" style={{ background: clientColors[i%clientColors.length] }}>{p.initials}</div>
                <div className="row-content">
                  <div className="row-title">{p.name}</div>
                  <div className="row-sub">{p.day} · {p.time}</div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:5, flexShrink:0 }}>
                  <span className={`badge ${p.status==="active"?"badge-teal":"badge-gray"}`}>{p.status==="active"?t("patients.statusActive"):t("patients.statusEnded")}</span>
                  <span style={{ fontSize:11, color:"var(--charcoal-xl)", fontWeight:600 }}>{p.sessions} ses. · ${p.rate}/ses</span>
                </div>
                <span className="row-chevron">›</span>
              </div>
            ))
          }
        </div>
      </div>

      {selected && (
        <div className="sheet-overlay" onClick={() => { setSelected(null); setEditing(false); setConfirmDelete(false); }}>
          <div className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">{editing ? t("patients.editPatient") : selected.name}</span>
              <button className="sheet-close" aria-label={t("close")} onClick={() => { setSelected(null); setEditing(false); setConfirmDelete(false); }}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 24px" }}>
              {editing ? (
                /* ── EDIT MODE ── */
                <div>
                  {/* Basic info */}
                  <div className="input-group">
                    <label className="input-label">{t("patients.name")}</label>
                    <input className="input" value={editName} onChange={e => setEditName(e.target.value)} />
                  </div>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: editIsMinor ? 6 : 14 }}>
                    <span style={{ fontSize:12, fontWeight:600, color:"var(--charcoal-md)" }}>{t("patients.isMinor")}</span>
                    <Toggle on={editIsMinor} onToggle={() => setEditIsMinor(v => !v)} />
                  </div>
                  {editIsMinor && (
                    <div className="input-group">
                      <label className="input-label">{t("patients.tutor")}</label>
                      <input className="input" value={editParent} onChange={e => setEditParent(e.target.value)} />
                    </div>
                  )}
                  <div className="input-group">
                    <label className="input-label">{t("patients.status")}</label>
                    <select className="input" value={editStatus} onChange={e => setEditStatus(e.target.value)}>
                      <option value="active">{t("patients.statusActive")}</option>
                      <option value="ended">{t("patients.statusEnded")}</option>
                    </select>
                  </div>

                  {/* Finalize patient */}
                  {isFinalizingPatient && (() => {
                    const cutoff = parseLocalDate(finishDate);
                    const sessionsToRemove = upcomingSessions.filter(s =>
                      s.patient_id === selected.id && s.status === "scheduled" && new Date(shortDateToISO(s.date)) > cutoff
                    ).length;
                    return (
                      <div style={{ background:"var(--amber-bg)", borderRadius:"var(--radius)", padding:"14px", marginBottom:14 }}>
                        <div style={{ fontSize:12, fontWeight:700, color:"var(--amber)", marginBottom:6 }}>{t("patients.finalizeTitle")}</div>
                        <div style={{ fontSize:11, color:"var(--charcoal-md)", lineHeight:1.5, marginBottom:10 }}>
                          {t("patients.finalizeWarning")}
                        </div>
                        <div className="input-group" style={{ marginBottom:6 }}>
                          <label className="input-label">{t("patients.lastSession")}</label>
                          <input className="input" type="date" value={finishDate} onChange={e => setFinishDate(e.target.value)} />
                        </div>
                        {sessionsToRemove > 0 && (
                          <div style={{ fontSize:11, fontWeight:600, color:"var(--red)", marginTop:4 }}>
                            {t("patients.sessionsToRemove", { count: sessionsToRemove })}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Rate & Schedules — hidden when finalizing */}
                  {!isFinalizingPatient && <>
                  <div style={{ borderTop:"1px solid var(--border-lt)", marginTop:4, paddingTop:14 }}>
                    <div className="input-group">
                      <label className="input-label">{t("patients.ratePerSession")}</label>
                      <input className="input" type="number" min="0" step="50" value={editRate} onChange={e => setEditRate(e.target.value)} placeholder={t("patients.ratePlaceholder")} />
                    </div>
                  </div>

                  {/* Schedules */}
                  <div style={{ borderTop:"1px solid var(--border-lt)", marginTop:4, paddingTop:14, marginBottom:8 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:"var(--charcoal)", marginBottom:10 }}>{t("patients.schedules")}</div>
                    {editSchedules.map((s, i) => (
                      <div key={i} style={{ display:"grid", gridTemplateColumns: editSchedules.length > 1 ? "1fr 1fr 28px" : "1fr 1fr", gap:8, marginBottom:8, alignItems:"end" }}>
                        <div className="input-group" style={{ marginBottom:0 }}>
                          {i === 0 && <label className="input-label">{t("patients.day")}</label>}
                          <select className="input" value={s.day} onChange={e => updateEditSched(i, "day", e.target.value)}>
                            {DAY_ORDER.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>
                        <div className="input-group" style={{ marginBottom:0 }}>
                          {i === 0 && <label className="input-label">{t("patients.time")}</label>}
                          <input className="input" type="time" value={s.time} onChange={e => updateEditSched(i, "time", e.target.value)} />
                        </div>
                        {editSchedules.length > 1 && (
                          <button type="button" onClick={() => setEditSchedules(prev => prev.filter((_, idx) => idx !== i))}
                            style={{ width:28, height:28, borderRadius:"50%", border:"none", background:"var(--red-bg)", color:"var(--red)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                            <IconX size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button type="button" onClick={() => setEditSchedules(prev => [...prev, { day: "Lunes", time: "16:00" }])}
                      style={{ fontSize:12, fontWeight:600, color:"var(--teal-dark)", background:"none", border:"none", cursor:"pointer", padding:"4px 0 8px", fontFamily:"var(--font)" }}>
                      {t("patients.addSchedule")}
                    </button>
                  </div>

                  {/* Effective date — only when schedule or rate changed */}
                  {scheduleOrRateChanged() && (
                    <div style={{ background:"var(--amber-bg)", borderRadius:"var(--radius)", padding:"14px", marginBottom:14 }}>
                      <div style={{ fontSize:12, fontWeight:700, color:"var(--amber)", marginBottom:8 }}>
                        {Number(editRate) !== origRate && JSON.stringify(editSchedules) !== origSchedules
                          ? t("patients.bothChanged")
                          : Number(editRate) !== origRate ? t("patients.rateChanged") : t("patients.scheduleChanged")}
                      </div>
                      <div style={{ fontSize:11, color:"var(--charcoal-md)", lineHeight:1.5, marginBottom:10 }}>
                        {t("patients.changeWarning")}
                      </div>
                      <div className="input-group" style={{ marginBottom:8 }}>
                        <label className="input-label">{t("patients.effectiveFrom")}</label>
                        <input className="input" type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} />
                      </div>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: hasEndDate ? 8 : 0 }}>
                        <span style={{ fontSize:12, fontWeight:600, color:"var(--charcoal-md)" }}>{t("patients.endDate")}</span>
                        <Toggle on={hasEndDate} onToggle={() => setHasEndDate(v => !v)} />
                      </div>
                      {hasEndDate ? (
                        <div className="input-group" style={{ marginBottom:0 }}>
                          <input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                        </div>
                      ) : (
                        <div style={{ fontSize:11, color:"var(--charcoal-xl)", marginTop:4 }}>{t("patients.permanent")}</div>
                      )}
                    </div>
                  )}
                  </>}

                  <button className="btn btn-primary" style={{ marginBottom:10 }} onClick={saveEdit} disabled={mutating}>
                    {mutating ? t("saving") : isFinalizingPatient ? t("patients.finalize") : scheduleOrRateChanged() ? t("apply") : t("save")}
                  </button>
                  <button className="btn btn-secondary w-full" onClick={() => setEditing(false)}>{t("cancel")}</button>
                </div>
              ) : confirmDelete ? (
                /* ── DELETE CONFIRMATION ── */
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontFamily:"var(--font-d)", fontSize:16, fontWeight:800, color:"var(--charcoal)", marginBottom:8 }}>{t("patients.deleteConfirm", { name: selected.name })}</div>
                  <div style={{ fontSize:13, color:"var(--charcoal-xl)", lineHeight:1.5, marginBottom:20 }}>{t("patients.deleteWarning")}</div>
                  <button className="btn btn-danger" style={{ marginBottom:10 }} onClick={handleDelete} disabled={mutating}>
                    {mutating ? t("patients.deleting") : t("patients.yesDelete")}
                  </button>
                  <button className="btn btn-secondary w-full" onClick={() => setConfirmDelete(false)}>{t("cancel")}</button>
                </div>
              ) : (
                /* ── QUICK ACTIONS (from sheet) ── */
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  <button className="btn btn-primary" style={{ height:48 }} onClick={() => { setSelected(null); openDetail(selected); }}>
                    {t("patients.viewExpediente")}
                  </button>
                  <button className="btn btn-secondary" style={{ height:44, fontSize:13 }} onClick={startEdit}>{t("edit")}</button>
                  <button className="btn" style={{ height:44, fontSize:13, background:"var(--red-bg)", color:"var(--red)", boxShadow:"none" }} onClick={() => setConfirmDelete(true)}>{t("delete")}</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {expediente && createPortal(
        <PatientExpediente
          patient={patients.find(p => p.id === expediente.id) || expediente}
          upcomingSessions={upcomingSessions}
          notes={notes}
          payments={payments}
          documents={documents}
          uploadDocument={uploadDocument}
          renameDocument={renameDocument}
          tagDocumentSession={tagDocumentSession}
          deleteDocument={deleteDocument}
          getDocumentUrl={getDocumentUrl}
          onClose={() => { setExpediente(null); setHideFab?.(false); }}
          onRecordPayment={openRecordPaymentModal}
          onEdit={(p) => {
            setExpediente(null);
            setHideFab?.(false);
            setSelected(p);
            const scheds = [{ day: p.day, time: p.time }];
            setEditName(p.name);
            setEditIsMinor(!!p.parent);
            setEditParent(p.parent || "");
            setEditRate(String(p.rate));
            setEditStatus(p.status);
            setEditSchedules(scheds);
            setOrigRate(p.rate);
            setOrigSchedules(JSON.stringify(scheds));
            setEffectiveDate(todayISO());
            setHasEndDate(false);
            setEndDate("");
            setEditing(true);
            setConfirmDelete(false);
          }}
          createSession={createSession}
          createNote={createNote}
          updateNote={updateNote}
          deleteNote={deleteNote}
          mutating={mutating}
        />,
        document.body
      )}
    </div>
  );
}
