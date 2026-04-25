import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { getClientColor, DAY_ORDER } from "../data/seedData";
import { IconSearch, IconX, IconUsers, IconTrash, IconPlus, IconEdit, IconDollar } from "../components/Icons";
import { haptic } from "../utils/haptics";
import ContextMenu, { useContextMenu } from "../components/ContextMenu";
import { todayISO, shortDateToISO, parseLocalDate } from "../utils/dates";
import { formatPhoneMX, phoneDigits } from "../utils/contact";
import { useEscape } from "../hooks/useEscape";
import { useSheetDrag } from "../hooks/useSheetDrag";
import { useViewport } from "../hooks/useViewport";
import { Toggle } from "../components/Toggle";
import { MoneyInput } from "../components/MoneyInput";
import { Avatar } from "../components/Avatar";
import { PatientExpediente } from "./PatientExpediente";
import { EmptyState } from "../components/EmptyState";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";

/* ── Collapsible section for the edit form ──
   Hides secondary info by default so the sheet doesn't overwhelm. The
   header is a tappable row with the section title + a chevron that
   rotates when open. Callers pass `forceOpen` when contextual state
   (e.g. finalize warning) needs the section expanded. */
function EditSection({ title, open, onToggle, forceOpen = false, children }) {
  const isOpen = open || forceOpen;
  return (
    <div style={{ borderTop:"1px solid var(--border-lt)", marginTop:4 }}>
      <button type="button"
        onClick={forceOpen ? undefined : onToggle}
        style={{
          width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"12px 0", background:"none", border:"none", cursor: forceOpen ? "default" : "pointer",
          fontFamily:"var(--font)", color:"var(--charcoal)",
          minHeight: 40,
        }}>
        <span style={{ fontSize:"var(--text-sm)", fontWeight:700, color:"var(--charcoal)" }}>{title}</span>
        {!forceOpen && (
          <span style={{ color:"var(--charcoal-xl)", fontSize:14, transform: isOpen ? "rotate(90deg)" : undefined, transition:"transform 0.4s" }}>›</span>
        )}
      </button>
      {isOpen && <div style={{ paddingBottom:4 }}>{children}</div>}
    </div>
  );
}

export function Patients() {
  const { patients, upcomingSessions, notes, payments, documents, openRecordPaymentModal, updatePatient, deletePatient, createSession, createNote, updateNote, deleteNote, uploadDocument, renameDocument, tagDocumentSession, deleteDocument, getDocumentUrl, applyScheduleChange, finalizePatient, mutating, setHideFab, consumeExpediente, requestFabAction, showSuccess, readOnly, navigate } = useCardigan();
  const { isTabletSplit } = useViewport();
  const ctxMenu = useContextMenu();
  const { t } = useT();
  const [search, setSearch]     = useState("");
  const [filter, setFilter]     = useState("all");
  const [selected, setSelected] = useState(null);
  const [editing, setEditing]   = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  // Collapsible sub-sections of the edit form. Defaults keep the sheet
  // short: secondary info is hidden until the user asks for it.
  const [openContact, setOpenContact] = useState(false);
  const [openDates, setOpenDates] = useState(false);
  const closeSheet = useCallback(() => { setSelected(null); setEditing(false); setConfirmDelete(false); setDeleteConfirmText(""); setOpenContact(false); setOpenDates(false); }, []);
  useEscape(selected ? closeSheet : null);
  const { scrollRef: editScrollRef, setPanelEl: setEditPanelEl, panelHandlers: editPanelHandlers } = useSheetDrag(closeSheet);
  const setEditPanel = (el) => { editScrollRef.current = el; setEditPanelEl(el); };
  const [expediente, setExpediente] = useState(null);
  // When Patients is opened via openExpediente() from another screen
  // (e.g. tapping a patient on Home), remember that origin so closing
  // the expediente can send the user back there instead of stranding
  // them on Pacientes.
  const [expedienteOrigin, setExpedienteOrigin] = useState(null);
  // Edit form state
  const [editName, setEditName]       = useState("");
  const [editIsMinor, setEditIsMinor] = useState(false);
  const [editParent, setEditParent]   = useState("");
  const [editRate, setEditRate]       = useState("");
  const [editTutorFrequency, setEditTutorFrequency] = useState("");
  const [editPhone, setEditPhone]     = useState("");
  const [editEmail, setEditEmail]     = useState("");
  const [editWhatsappEnabled, setEditWhatsappEnabled] = useState(false);
  const [editWhatsappConsentAt, setEditWhatsappConsentAt] = useState(null);
  const [editBirthdate, setEditBirthdate] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editStatus, setEditStatus]   = useState("");
  const [editSchedules, setEditSchedules] = useState([{ day: "Lunes", time: "16:00", modality: "presencial" }]);
  const [effectiveDate, setEffectiveDate] = useState(todayISO());
  const [hasEndDate, setHasEndDate]       = useState(false);
  const [endDate, setEndDate]             = useState("");
  const [finishDate, setFinishDate]         = useState(todayISO());
  // Track originals to detect changes
  const [origRate, setOrigRate]           = useState(0);
  const [origSchedules, setOrigSchedules] = useState("[]");

  const openDetail = (p) => {
    setExpediente(p);
    // Desktop split view keeps the topbar + FAB visible; the expediente
    // renders inline alongside the list so nothing is covered.
    if (!isTabletSplit) setHideFab?.(true);
  };

  // Close helper — also sends the user back to the screen that opened
  // the expediente (e.g. Home) when one was recorded. Without this the
  // user lands on Pacientes, which is disorienting when they never
  // navigated there themselves.
  const closeExpediente = () => {
    setExpediente(null);
    if (!isTabletSplit) setHideFab?.(false);
    const origin = expedienteOrigin;
    setExpedienteOrigin(null);
    if (origin && origin !== "patients") navigate(origin);
  };

  // Right-click menu for patient rows. Desktop-only affordance —
  // contextmenu events don't fire for normal mobile long-presses so
  // the mobile long-press/swipe gestures are untouched.
  const openPatientContextMenu = (e, p) => {
    if (readOnly) return;
    ctxMenu.openAt(e, [
      { key: "open",    label: t("patients.viewExpediente") || "Ver expediente", icon: <IconUsers size={15} />, onSelect: () => openDetail(p) },
      { key: "payment", label: t("finances.recordPayment"), icon: <IconDollar size={15} />, onSelect: () => openRecordPaymentModal(p) },
      { divider: true },
      { key: "edit",    label: t("edit"),   icon: <IconEdit size={15} />,  onSelect: () => openEditForPatient(p) },
      { key: "delete",  label: t("patients.deleteButton"), icon: <IconTrash size={15} />, onSelect: () => openEditForPatient(p, { confirmDelete: true }), destructive: true },
    ]);
  };

  const openEditForPatient = (p, opts = {}) => {
    const scheds = [{ day: p.day, time: p.time }];
    setEditName(p.name);
    setEditIsMinor(!!p.parent);
    setEditParent(p.parent || "");
    setEditRate(String(p.rate));
    setEditPhone(formatPhoneMX(p.phone));
    setEditEmail(p.email || "");
    setEditWhatsappEnabled(!!p.whatsapp_enabled);
    setEditWhatsappConsentAt(p.whatsapp_consent_at || null);
    setEditBirthdate(p.birthdate || "");
    setEditStartDate(p.start_date || "");
    setEditStatus(p.status);
    setEditSchedules(scheds);
    setOrigRate(p.rate);
    setOrigSchedules(JSON.stringify(scheds));
    setEffectiveDate(todayISO());
    setHasEndDate(false);
    setEndDate("");
    setSelected(p);
    setEditing(true);
    setConfirmDelete(!!opts.confirmDelete);
  };

  // Open expediente when navigated from another screen. Mount-only
  // consume pattern — consumeExpediente returns the pending patient
  // once and nulls it, so running this on every render would break
  // the contract.
  useEffect(() => {
    const pending = consumeExpediente?.();
    if (pending) {
      const match = patients.find(p => p.id === pending.patient.id) || pending.patient;
      setExpedienteOrigin(pending.origin || null);
      openDetail(match);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        haptic.success();
        // Also save any basic info changes
        await updatePatient(selected.id, {
          name: editName.trim(),
          parent: editIsMinor ? editParent.trim() : "",
          tutor_frequency: editIsMinor && editTutorFrequency ? Number(editTutorFrequency) : null,
          phone: phoneDigits(editPhone), email: editEmail.trim(),
          birthdate: editBirthdate || null, start_date: editStartDate || null,
          whatsapp_enabled: !!editWhatsappEnabled && !!phoneDigits(editPhone),
          whatsapp_consent_at: (editWhatsappEnabled && phoneDigits(editPhone)) ? (editWhatsappConsentAt || new Date().toISOString()) : null,
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
          tutor_frequency: editIsMinor && editTutorFrequency ? Number(editTutorFrequency) : null,
          phone: phoneDigits(editPhone), email: editEmail.trim(),
          birthdate: editBirthdate || null, start_date: editStartDate || null,
          status: editStatus,
          whatsapp_enabled: !!editWhatsappEnabled && !!phoneDigits(editPhone),
          whatsapp_consent_at: (editWhatsappEnabled && phoneDigits(editPhone)) ? (editWhatsappConsentAt || new Date().toISOString()) : null,
        });
        setSelected(null);
        setEditing(false);
      }
    } else {
      // Only basic info changed
      const ok = await updatePatient(selected.id, {
        name: editName.trim(),
        parent: editIsMinor ? editParent.trim() : "",
        tutor_frequency: editIsMinor && editTutorFrequency ? Number(editTutorFrequency) : null,
        phone: phoneDigits(editPhone), email: editEmail.trim(),
        birthdate: editBirthdate || null, start_date: editStartDate || null,
        rate: Number(editRate) || 0,
        status: editStatus,
        whatsapp_enabled: !!editWhatsappEnabled && !!phoneDigits(editPhone),
        whatsapp_consent_at: (editWhatsappEnabled && phoneDigits(editPhone)) ? (editWhatsappConsentAt || new Date().toISOString()) : null,
      });
      if (ok) {
        setSelected(null);
        setEditing(false);
      }
    }
  };

  const handleDelete = async () => {
    const name = selected?.name || "";
    const ok = await deletePatient(selected.id);
    if (ok) {
      setSelected(null);
      setConfirmDelete(false);
      setDeleteConfirmText("");
      showSuccess?.(t("patients.deletedToast", { name }));
    }
  };

  // Accept either the literal word "ELIMINAR" (simpler, and also
  // robust against long or accented names) or the patient's name. Users
  // pick whichever feels safer.
  const deleteConfirmMatches = selected
    ? (deleteConfirmText.trim().toUpperCase() === "ELIMINAR" ||
       deleteConfirmText.trim().toLowerCase() === selected.name.trim().toLowerCase())
    : false;

  const startDelete = () => {
    setConfirmDelete(true);
    setDeleteConfirmText("");
  };

  const finalizeInstead = () => {
    // Close delete confirm, return to edit form, jump to the status field
    setConfirmDelete(false);
    setDeleteConfirmText("");
    setEditStatus("ended");
  };

  const filters = [
    {k:"owes",l:t("patients.withDebt")},{k:"paid",l:t("patients.upToDate")},
    {k:"active",l:t("patients.active")},{k:"ended",l:t("patients.ended")},
  ];

  const applyFilter = (p) => {
    if (filter==="active") return p.status==="active";
    if (filter==="ended")  return p.status==="ended";
    if (filter==="owes")   return p.amountDue>0;
    if (filter==="paid")   return p.amountDue<=0;
    return true;
  };
  const applySort = (a,b) => {
    if (a.status !== b.status) {
      if (a.status === "active") return -1;
      if (b.status === "active") return 1;
    }
    return a.name.localeCompare(b.name);
  };
  const filtered = patients.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) && applyFilter(p)).sort(applySort);

  // Empty state
  if (patients.length === 0) {
    return (
      <div className="page" data-tour="patients-list" style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"24px" }}>
        <EmptyState
          kind="patients"
          title={t("patients.noPatients")}
          body={t("patients.addFirst")}
          cta={!readOnly && (
            <button
              type="button"
              onClick={() => requestFabAction?.("patient")}
              className="btn btn-primary"
              style={{ display:"inline-flex", alignItems:"center", gap:8, width:"auto", padding:"10px 22px", height:"auto", minHeight:0 }}>
              <IconPlus size={16} /> {t("patients.addFirstCta")}
            </button>
          )}
        />
      </div>
    );
  }

  const splitMode = isTabletSplit && !!expediente;

  const listJSX = (
    <>
      <div style={{ padding:"16px 16px 10px" }}>
        <div className="search-bar">
          <span style={{ color:"var(--charcoal-xl)" }}><IconSearch size={16} /></span>
          <input placeholder={t("patients.searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="filter-chips">
        {filters.map(f => <button key={f.k} className={`chip ${filter===f.k?"active":""}`} onClick={() => setFilter(prev => prev === f.k ? "all" : f.k)}>{f.l}</button>)}
      </div>
      <div className="sort-row">
        <span style={{ fontSize:12, color:"var(--charcoal-xl)", fontWeight:600 }}>{t("patients.count", { count: filtered.length })}</span>
      </div>
      <div style={{ padding:"0 16px 12px" }}>
        <div className="card">
          {filtered.length === 0
            ? <div style={{ padding:"28px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>{t("patients.noResults")}</div>
            : filtered.map((p,i) => (
              <div
                className={`row-item list-entry-stagger ${splitMode && expediente?.id === p.id ? "row-item--selected" : ""}`}
                style={{ "--stagger-i": Math.min(i, 12) }}
                key={p.id} onClick={() => openDetail(p)} onContextMenu={(e) => openPatientContextMenu(e, p)}>
                <Avatar initials={p.initials} color={getClientColor(i)} size="md" />
                <div className="row-content">
                  <div className="row-title">{p.name}</div>
                  <div className="row-sub">
                    {p.parent && (
                      <>
                        <span style={{ color:"var(--purple)", fontWeight:700 }}>{t("sessions.tutor")}: {p.parent}</span>
                        {" · "}
                      </>
                    )}
                    ${p.rate.toLocaleString()} {t("expediente.perSession")}
                  </div>
                </div>
                <div style={{ flexShrink:0 }}>
                  {filter === "owes"
                    ? <span style={{ fontSize:"var(--text-sm)", fontWeight:800, fontFamily:"var(--font-d)", color:"var(--red)" }}>${p.amountDue.toLocaleString()}</span>
                    : <span className={`badge ${p.status==="active"?"badge-teal":"badge-gray"}`}>{p.status==="active"?t("patients.statusActive"):t("patients.statusEnded")}</span>
                  }
                </div>
                <span className="row-chevron">›</span>
              </div>
            ))
          }
        </div>
      </div>
    </>
  );

  return (
    <div className={isTabletSplit ? "patients-split-view" : "page"} data-tour="patients-list">
      {isTabletSplit ? (
        <div className="patients-list-pane">{listJSX}</div>
      ) : listJSX}
      {isTabletSplit && (
        <div className="patients-detail-pane">
          {expediente ? (
            <PatientExpediente
              layout="inline"
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
              onClose={closeExpediente}
              onRecordPayment={openRecordPaymentModal}
              onEdit={(p) => {
                const scheds = [{ day: p.day, time: p.time }];
                setEditName(p.name);
                setEditIsMinor(!!p.parent);
                setEditParent(p.parent || "");
                setEditRate(String(p.rate));
                setEditPhone(formatPhoneMX(p.phone));
                setEditEmail(p.email || "");
                setEditWhatsappEnabled(!!p.whatsapp_enabled);
                setEditWhatsappConsentAt(p.whatsapp_consent_at || null);
                setEditBirthdate(p.birthdate || "");
                setEditStartDate(p.start_date || "");
                setEditStatus(p.status);
                setEditSchedules(scheds);
                setOrigRate(p.rate);
                setOrigSchedules(JSON.stringify(scheds));
                setEffectiveDate(todayISO());
                setHasEndDate(false);
                setEndDate("");
                setSelected(p);
                setEditing(true);
                setConfirmDelete(false);
              }}
              createSession={createSession}
              createNote={createNote}
              updateNote={updateNote}
              deleteNote={deleteNote}
              mutating={mutating}
            />
          ) : (
            <div className="patients-split-view-empty">
              <div className="patients-split-view-empty-icon"><IconUsers size={30} /></div>
              <div className="patients-split-view-empty-title">{t("patients.selectPrompt") || "Selecciona un paciente"}</div>
              <div className="patients-split-view-empty-hint">{t("patients.selectHint") || "Elige un paciente de la lista para ver su expediente."}</div>
            </div>
          )}
        </div>
      )}

      {selected && (
        <div className="sheet-overlay" onClick={closeSheet}>
          <div ref={setEditPanel} className="sheet-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} {...editPanelHandlers}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">
                {confirmDelete
                  ? t("patients.deleteButton")
                  : editing ? t("patients.editPatient") : selected.name}
              </span>
              <button className="sheet-close" aria-label={t("close")} onClick={closeSheet}><IconX size={14} /></button>
            </div>
            <div style={{ padding:"0 20px 22px" }}>
              {editing && !confirmDelete ? (
                /* ── EDIT MODE ──
                   Structure: essentials up top (name, minor, rate,
                   schedules), secondary info tucked into collapsible
                   "Contacto" and "Fechas y estado" sections. Contextual
                   warnings (finalize, effective date) appear inline
                   when relevant. */
                <div>
                  {/* ── Essentials ── */}
                  <div className="input-group">
                    <label className="input-label">{t("patients.name")}</label>
                    <input className="input" value={editName} onChange={e => setEditName(e.target.value)} />
                  </div>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: editIsMinor ? 6 : 14 }}>
                    <span style={{ fontSize:"var(--text-sm)", fontWeight:600, color:"var(--charcoal-md)" }}>{t("patients.isMinor")}</span>
                    <Toggle on={editIsMinor} onToggle={() => setEditIsMinor(v => !v)} />
                  </div>
                  {editIsMinor && (<>
                    <div className="input-group">
                      <label className="input-label">{t("patients.tutor")}</label>
                      <input className="input" value={editParent} onChange={e => setEditParent(e.target.value)} />
                    </div>
                    <div className="input-group">
                      <label className="input-label">{t("patients.tutorFrequency")}</label>
                      <select className="input" value={editTutorFrequency} onChange={e => setEditTutorFrequency(e.target.value)}>
                        <option value="">{t("patients.frequencyNone")}</option>
                        <option value="4">{t("patients.everyNWeeks", { count: 4 })}</option>
                        <option value="6">{t("patients.everyNWeeks", { count: 6 })}</option>
                        <option value="8">{t("patients.everyNWeeks", { count: 8 })}</option>
                        <option value="12">{t("patients.everyNWeeks", { count: 12 })}</option>
                      </select>
                      <div style={{ fontSize:"var(--text-xs)", color:"var(--charcoal-xl)", marginTop:2 }}>{t("patients.tutorFrequencyHint")}</div>
                    </div>
                  </>)}

                  {/* Rate & Schedules — the most commonly edited fields,
                      always visible. Hidden only while finalizing
                      (status=ended) since schedules no longer apply. */}
                  {!isFinalizingPatient && (
                    <div style={{ borderTop:"1px solid var(--border-lt)", marginTop:4, paddingTop:14 }}>
                      <div className="input-group">
                        <label className="input-label">{t("patients.ratePerSession")}</label>
                        <MoneyInput min="0" step="50" value={editRate} onChange={e => setEditRate(e.target.value)} placeholder={t("patients.ratePlaceholder")} />
                      </div>
                      <div style={{ fontSize:"var(--text-sm)", fontWeight:700, color:"var(--charcoal)", marginBottom:8 }}>{t("patients.schedules")}</div>
                      {editSchedules.map((s, i) => (
                        <div key={i} style={{ border:"1px solid var(--border-lt)", borderRadius:"var(--radius)", padding:"10px 10px 6px", marginBottom:8, position:"relative" }}>
                          {editSchedules.length > 1 && (
                            <button type="button" onClick={() => setEditSchedules(prev => prev.filter((_, idx) => idx !== i))}
                              aria-label={t("delete")}
                              style={{ position:"absolute", top:6, right:6, width:24, height:24, minHeight:24, borderRadius:"50%", border:"none", background:"var(--red-bg)", color:"var(--red)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0 }}>
                              <IconX size={11} />
                            </button>
                          )}
                          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                            <div className="input-group" style={{ marginBottom:8 }}>
                              <label className="input-label">{t("patients.day")}</label>
                              <select className="input" value={s.day} onChange={e => updateEditSched(i, "day", e.target.value)}>
                                {DAY_ORDER.map(d => <option key={d} value={d}>{d}</option>)}
                              </select>
                            </div>
                            <div className="input-group" style={{ marginBottom:8 }}>
                              <label className="input-label">{t("patients.time")}</label>
                              <input className="input" type="time" value={s.time} onChange={e => updateEditSched(i, "time", e.target.value)} />
                            </div>
                            <div className="input-group" style={{ marginBottom:0 }}>
                              <label className="input-label">{t("sessions.duration")}</label>
                              <select className="input" value={s.duration || "60"} onChange={e => updateEditSched(i, "duration", e.target.value)}>
                                <option value="30">30m</option>
                                <option value="45">45m</option>
                                <option value="60">1h</option>
                                <option value="90">1½h</option>
                                <option value="120">2h</option>
                              </select>
                            </div>
                            <div className="input-group" style={{ marginBottom:0 }}>
                              <label className="input-label">{t("sessions.modality")}</label>
                              <select className="input" value={s.modality || "presencial"} onChange={e => updateEditSched(i, "modality", e.target.value)}>
                                <option value="presencial">{t("sessions.presencial")}</option>
                                <option value="virtual">{t("sessions.virtual")}</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      ))}
                      <button type="button" onClick={() => setEditSchedules(prev => [...prev, { day: "Lunes", time: "16:00", duration: "60", modality: "presencial" }])}
                        style={{ fontSize:"var(--text-sm)", fontWeight:600, color:"var(--teal-dark)", background:"none", border:"none", cursor:"pointer", padding:"4px 0 10px", fontFamily:"var(--font)" }}>
                        {t("patients.addSchedule")}
                      </button>

                      {/* Effective date — only when schedule or rate changed */}
                      {scheduleOrRateChanged() && (
                        <div style={{ background:"var(--amber-bg)", borderRadius:"var(--radius)", padding:"14px", marginBottom:14 }}>
                          <div style={{ fontSize:"var(--text-sm)", fontWeight:700, color:"var(--amber)", marginBottom:8 }}>
                            {Number(editRate) !== origRate && JSON.stringify(editSchedules) !== origSchedules
                              ? t("patients.bothChanged")
                              : Number(editRate) !== origRate ? t("patients.rateChanged") : t("patients.scheduleChanged")}
                          </div>
                          <div style={{ fontSize:"var(--text-xs)", color:"var(--charcoal-md)", lineHeight:1.5, marginBottom:10 }}>
                            {t("patients.changeWarning")}
                          </div>
                          <div className="input-group" style={{ marginBottom:8 }}>
                            <label className="input-label">{t("patients.effectiveFrom")}</label>
                            <input className="input" type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} />
                          </div>
                          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: hasEndDate ? 8 : 0 }}>
                            <span style={{ fontSize:"var(--text-sm)", fontWeight:600, color:"var(--charcoal-md)" }}>{t("patients.endDate")}</span>
                            <Toggle on={hasEndDate} onToggle={() => setHasEndDate(v => !v)} />
                          </div>
                          {hasEndDate ? (
                            <div className="input-group" style={{ marginBottom:0 }}>
                              <input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                            </div>
                          ) : (
                            <div style={{ fontSize:"var(--text-xs)", color:"var(--charcoal-xl)", marginTop:4 }}>{t("patients.permanent")}</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Contacto (collapsible) ── */}
                  <EditSection title={t("patients.sectionContact")} open={openContact} onToggle={() => setOpenContact(v => !v)}>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                      <div className="input-group">
                        <label className="input-label">{t("patients.phone")}</label>
                        <input className="input" type="tel" inputMode="tel" autoComplete="tel"
                          value={editPhone}
                          onChange={e => setEditPhone(formatPhoneMX(e.target.value))}
                          placeholder={t("patients.phonePlaceholder")} />
                      </div>
                      <div className="input-group">
                        <label className="input-label">{t("settings.email")}</label>
                        <input className="input" type="email" inputMode="email" autoComplete="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder={t("patients.emailPlaceholder")} />
                      </div>
                    </div>
                    {/* WhatsApp opt-in — gated until Meta setup is live.
                        See NewPatientSheet for the same gate + comment. */}
                    {import.meta.env.VITE_WHATSAPP_UI_ENABLED === "true" && (
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:12, gap:12 }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:"var(--text-sm)", fontWeight:600, color:"var(--charcoal-md)" }}>
                            {t("patients.whatsappReminders")}
                          </div>
                          <div style={{ fontSize:"var(--text-xs)", color:"var(--charcoal-xl)", marginTop:2 }}>
                            {phoneDigits(editPhone) ? t("patients.whatsappRemindersHint") : t("patients.whatsappRemindersDisabledHint")}
                          </div>
                        </div>
                        <Toggle
                          on={editWhatsappEnabled && !!phoneDigits(editPhone)}
                          disabled={!phoneDigits(editPhone)}
                          ariaLabel={t("patients.whatsappReminders")}
                          onToggle={() => {
                            const next = !editWhatsappEnabled;
                            setEditWhatsappEnabled(next);
                            if (next && !editWhatsappConsentAt) {
                              setEditWhatsappConsentAt(new Date().toISOString());
                            } else if (!next) {
                              setEditWhatsappConsentAt(null);
                            }
                          }}
                        />
                      </div>
                    )}
                  </EditSection>

                  {/* ── Fechas y estado (collapsible; force-open while finalizing) ── */}
                  <EditSection title={t("patients.sectionDates")}
                    open={openDates} onToggle={() => setOpenDates(v => !v)}
                    forceOpen={isFinalizingPatient}>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                      <div className="input-group">
                        <label className="input-label">{t("patients.birthdate")}</label>
                        <input className="input" type="date" value={editBirthdate} onChange={e => setEditBirthdate(e.target.value)} />
                      </div>
                      <div className="input-group">
                        <label className="input-label">{t("patients.startDate")}</label>
                        <input className="input" type="date" value={editStartDate} onChange={e => setEditStartDate(e.target.value)} />
                      </div>
                    </div>
                    <div className="input-group">
                      <label className="input-label">{t("patients.status")}</label>
                      <select className="input" value={editStatus} onChange={e => setEditStatus(e.target.value)}>
                        <option value="active">{t("patients.statusActive")}</option>
                        <option value="ended">{t("patients.statusEnded")}</option>
                      </select>
                    </div>

                    {isFinalizingPatient && (() => {
                      const cutoff = parseLocalDate(finishDate);
                      const sessionsToRemove = upcomingSessions.filter(s =>
                        s.patient_id === selected.id && s.status === "scheduled" && new Date(shortDateToISO(s.date)) > cutoff
                      ).length;
                      return (
                        <div style={{ background:"var(--amber-bg)", borderRadius:"var(--radius)", padding:"14px", marginBottom:14 }}>
                          <div style={{ fontSize:"var(--text-sm)", fontWeight:700, color:"var(--amber)", marginBottom:6 }}>{t("patients.finalizeTitle")}</div>
                          <div style={{ fontSize:"var(--text-xs)", color:"var(--charcoal-md)", lineHeight:1.5, marginBottom:10 }}>
                            {t("patients.finalizeWarning")}
                          </div>
                          <div className="input-group" style={{ marginBottom:6 }}>
                            <label className="input-label">{t("patients.lastSession")}</label>
                            <input className="input" type="date" value={finishDate} onChange={e => setFinishDate(e.target.value)} />
                          </div>
                          {sessionsToRemove > 0 && (
                            <div style={{ fontSize:"var(--text-xs)", fontWeight:600, color:"var(--red)", marginTop:4 }}>
                              {t("patients.sessionsToRemove", { count: sessionsToRemove })}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </EditSection>

                  <div style={{ marginTop:20 }} />

                  <button className="btn btn-primary-teal" style={{ marginBottom:10 }} onClick={saveEdit} disabled={mutating || !editName.trim()}>
                    {mutating ? t("saving") : isFinalizingPatient ? t("patients.finalize") : scheduleOrRateChanged() ? t("apply") : t("save")}
                  </button>
                  <button className="btn btn-secondary w-full" onClick={closeSheet}>{t("cancel")}</button>

                  {/* ── Danger zone ── */}
                  <div style={{ marginTop:24, paddingTop:16, borderTop:"1px solid var(--border-lt)" }}>
                    <button type="button"
                      onClick={startDelete}
                      className="btn"
                      style={{ width:"100%", height:44, fontSize:"var(--text-sm)", background:"var(--red-bg)", color:"var(--red)", boxShadow:"none", gap:8 }}>
                      <IconTrash size={14} /> {t("patients.deleteButton")}
                    </button>
                  </div>
                </div>
              ) : confirmDelete ? (
                /* ── STRONG DELETE CONFIRMATION ── */
                <div>
                  {/* Red warning icon */}
                  <div style={{ textAlign:"center", marginBottom:14 }}>
                    <div style={{ width:56, height:56, borderRadius:"50%", background:"var(--red-bg)", color:"var(--red)", display:"inline-flex", alignItems:"center", justifyContent:"center" }}>
                      <IconTrash size={24} />
                    </div>
                  </div>

                  <div style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-lg)", fontWeight:800, color:"var(--charcoal)", textAlign:"center", marginBottom:8, letterSpacing:"-0.2px" }}>
                    {t("patients.deleteConfirm", { name: selected.name })}
                  </div>
                  <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-md)", lineHeight:1.5, textAlign:"center", marginBottom:16 }}>
                    {t("patients.deleteWarning")}
                  </div>

                  {/* What will be lost */}
                  <div style={{ background:"var(--red-bg)", borderRadius:"var(--radius)", padding:"12px 14px", marginBottom:12 }}>
                    <div style={{ fontSize:"var(--text-xs)", fontWeight:700, color:"var(--red)", marginBottom:6 }}>
                      {t("patients.deleteLost")}
                    </div>
                    <ul style={{ margin:0, paddingLeft:18, fontSize:"var(--text-sm)", color:"var(--charcoal-md)", lineHeight:1.6 }}>
                      <li>{t("patients.deleteLostSessions")}</li>
                      <li>{t("patients.deleteLostNotes")}</li>
                      <li>{t("patients.deleteLostPayments")}</li>
                      <li>{t("patients.deleteLostHistory")}</li>
                    </ul>
                  </div>

                  {/* Alternative: finalize (only surfaced for active patients;
                      if already ended, the finalize option is a no-op) */}
                  {selected.status === "active" && (
                    <div style={{ background:"var(--teal-pale)", borderRadius:"var(--radius)", padding:"12px 14px", marginBottom:16 }}>
                      <div style={{ fontSize:"var(--text-xs)", fontWeight:700, color:"var(--teal-dark)", marginBottom:4 }}>
                        {t("patients.deleteAlternativeTitle")}
                      </div>
                      <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-md)", lineHeight:1.5, marginBottom:10 }}>
                        {t("patients.deleteAlternativeBody")}
                      </div>
                      <button type="button" onClick={finalizeInstead}
                        className="btn btn-secondary" style={{ width:"100%", height:40, fontSize:"var(--text-sm)" }}>
                        {t("patients.deleteAlternativeCta")}
                      </button>
                    </div>
                  )}

                  {/* Type-to-confirm — accepts "ELIMINAR" or the patient's name */}
                  <div className="input-group">
                    <label className="input-label">{t("patients.deleteTypeToConfirm")}</label>
                    <input className="input"
                      value={deleteConfirmText}
                      onChange={e => setDeleteConfirmText(e.target.value)}
                      placeholder={t("patients.deleteTypePlaceholder")}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="characters"
                      spellCheck={false} />
                  </div>

                  <button className="btn btn-danger" style={{ marginBottom:10 }}
                    onClick={handleDelete}
                    disabled={mutating || !deleteConfirmMatches}>
                    {mutating ? t("patients.deleting") : t("patients.yesDelete")}
                  </button>
                  <button className="btn btn-secondary w-full"
                    onClick={() => { setConfirmDelete(false); setDeleteConfirmText(""); }}>
                    {t("cancel")}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {expediente && !isTabletSplit && createPortal(
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
          onClose={closeExpediente}
          onRecordPayment={openRecordPaymentModal}
          onEdit={(p) => {
            // "Editar" jumps into the edit sheet in-place on Pacientes
            // — don't forward the user back to the origin (e.g. Home)
            // in that case, they need to stay here to finish editing.
            setExpediente(null);
            setExpedienteOrigin(null);
            setHideFab?.(false);
            setSelected(p);
            const scheds = [{ day: p.day, time: p.time }];
            setEditName(p.name);
            setEditIsMinor(!!p.parent);
            setEditParent(p.parent || "");
            setEditRate(String(p.rate));
            setEditPhone(formatPhoneMX(p.phone));
            setEditEmail(p.email || "");
            setEditWhatsappEnabled(!!p.whatsapp_enabled);
            setEditWhatsappConsentAt(p.whatsapp_consent_at || null);
            setEditBirthdate(p.birthdate || "");
            setEditStartDate(p.start_date || "");
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
      <ContextMenu {...ctxMenu.state} onClose={ctxMenu.close} />
    </div>
  );
}
