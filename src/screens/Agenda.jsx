import { useState, useMemo, useCallback, useEffect } from "react";
import { TODAY } from "../data/seedData";
import { haptic } from "../utils/haptics";
import { SessionSheet } from "../components/SessionSheet";
import { GroupOccurrenceSheet } from "../components/sheets/GroupOccurrenceSheet";
import { NoteEditor } from "../components/NoteEditor";
import { NewSessionSheet } from "../components/sheets/NewSessionSheet";
import { CalendarLinkSheet } from "../components/sheets/CalendarLinkSheet";
import { IconCheck, IconX, IconTrash, IconCalendar, IconPlus } from "../components/Icons";
import ContextMenu, { useContextMenu } from "../components/ContextMenu";
import { BulkActionsSheet } from "../components/sheets/BulkActionsSheet";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { formatShortDate, toISODate } from "../utils/dates";
import { isCancelledStatus } from "../utils/sessions";
import { useViewport } from "../hooks/useViewport";
import { useCalendarToken, isCalendarPromptDismissed, dismissCalendarPrompt } from "../hooks/useCalendarToken";
import { useCardigan } from "../context/CardiganContext";
import { useT } from "../i18n/index";
import { SegmentedControl } from "../components/SegmentedControl";
import { EmptyState } from "../components/EmptyState";
import { DayView } from "./agenda/DayView";
import { WeekView } from "./agenda/WeekView";
import { MonthView } from "./agenda/MonthView";

/* ── AGENDA ROOT ── */
export function Agenda() {
  const { upcomingSessions, patients, groups, createSession, onCancelSession, onMarkCompleted, deleteSession, rescheduleSession, rescheduleGroupOccurrence, updateSessionModality, updateSessionRate, updateCancelReason, notes, createNote, updateNote, deleteNote, mutating, consumeAgendaView, readOnly, showSuccess, showToast, requestFabAction, setHideFab, setHideBottomTabs, user } = useCardigan();
  const groupsById = useMemo(() => new Map((groups || []).map(g => [g.id, g])), [groups]);
  const { t } = useT();
  const { isTabletSplit } = useViewport();
  // Default to week view on desktop (more horizontal room) and day view on
  // mobile. A cross-screen pending view (consumeAgendaView) always wins.
  // iPad portrait/landscape (820+) gets the week view by default — there's
  // room for it, and the week is the most useful agenda layout when not
  // strictly mobile. Phone stays on day view.
  const [view, setView] = useState(() => consumeAgendaView?.() || (isTabletSplit ? "week" : "day"));
  const [selectedDate, setSelectedDate] = useState(new Date(TODAY));
  const [selectedSession, setSelectedSession] = useState(null);
  const [selectedGroupOcc, setSelectedGroupOcc] = useState(null);
  // Bulk selection mode — only the day view participates today (the
  // place a therapist actually goes to "cancel everything next week").
  // Week + Month would require richer hit-testing on the event chips
  // and are an obvious follow-up.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedSet, setSelectedSet] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkSheetOpen, setBulkSheetOpen] = useState(false);
  const onToggleSelect = useCallback((s) => {
    haptic.tap();
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
      return next;
    });
  }, []);
  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedSet(new Set());
  }, []);

  // Apply a bulk action (cancel without charge / cancel with charge /
  // delete) to every session in the current selection. Each action is
  // routed through the existing per-session handlers so accounting
  // semantics stay identical to the single-session flow — we don't
  // bypass the predicate that decides whether `cancelled` counts. The
  // batch is Promise.allSettled so one failure doesn't block the rest;
  // the toast summarises ok / failed counts.
  const bulkApply = useCallback(async (kind) => {
    if (bulkBusy) return;
    if (selectedSet.size === 0) return;
    const ids = Array.from(selectedSet);
    const list = upcomingSessions.filter((s) => selectedSet.has(s.id));
    setBulkBusy(true);
    try {
      const tasks = list.map((s) => {
        if (kind === "delete") return deleteSession(s.id);
        if (kind === "complete") return onMarkCompleted(s);
        if (kind === "cancel-charge") return onCancelSession(s, true, t("agenda.bulkChargeReason"));
        return onCancelSession(s, false, null);
      });
      const results = await Promise.allSettled(tasks);
      const ok = results.filter((r) => r.status === "fulfilled" && r.value !== false).length;
      const failed = ids.length - ok;
      if (failed === 0) {
        showSuccess?.(t("agenda.bulkSuccess", { n: ok }));
      } else {
        showToast?.(t("agenda.bulkPartial", { n: ok, failed }), "info");
      }
      exitSelection();
    } finally {
      setBulkBusy(false);
    }
  }, [bulkBusy, selectedSet, upcomingSessions, deleteSession, onCancelSession, onMarkCompleted, t, showSuccess, showToast, exitSelection]);
  // When the user leaves the day view OR enters readOnly, abort
  // selection so the bar doesn't outlive its context.
  useEffect(() => {
    if (selectionMode && (view !== "day" || readOnly)) exitSelection();
  }, [view, readOnly, selectionMode, exitSelection]);
  // Selection mode owns the bottom of the screen with the action pill, so
  // hide the FAB + bottom-tab pill (they'd overlap the bar and bury its exit
  // button). Restored on exit / unmount.
  useEffect(() => {
    setHideFab?.(selectionMode);
    setHideBottomTabs?.(selectionMode);
    return () => { setHideFab?.(false); setHideBottomTabs?.(false); };
  }, [selectionMode, setHideFab, setHideBottomTabs]);
  // "reschedule" when the sheet was opened via a long-press on a week
  // event (mobile drag-reschedule replacement); cleared on close. Null
  // for all other entry points.
  const [selectedSessionMode, setSelectedSessionMode] = useState(null);
  // Unified tap router for all three views: a collapsed group occurrence
  // opens the group sheet; an ordinary session opens the session sheet.
  const selectItem = useCallback((item, mode) => {
    if (item?._groupOccurrence) { setSelectedGroupOcc(item); return; }
    setSelectedSession(item); setSelectedSessionMode(mode || null);
  }, []);
  const [editingNote, setEditingNote] = useState(null);
  const [filterPatientId, setFilterPatientId] = useState("");
  const [newSessionPrefill, setNewSessionPrefill] = useState(null);
  const [calendarSheetOpen, setCalendarSheetOpen] = useState(false);
  // Hide the CTA pill once the user has linked their calendar. Until
  // the first /api/calendar-token GET resolves we suppress the pill
  // too — flashing it in for one frame before hiding it again would
  // be more disruptive than waiting a beat.
  const calendarFeed = useCalendarToken();
  // Dismissible: the user can hide the sync nudge. Shares the same flag as
  // the Home discovery card, so dismissing it in either place hides it
  // everywhere (it's the same nudge).
  const [calendarCtaDismissed, setCalendarCtaDismissed] = useState(() => isCalendarPromptDismissed(user?.id));
  const showCalendarCTA = !readOnly && calendarFeed.loaded && !calendarFeed.hasToken && !calendarCtaDismissed;

  // "Ahora" tick — re-render every minute so the now-line stays current
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const filteredSessions = useMemo(() => {
    if (!filterPatientId) return upcomingSessions;
    return upcomingSessions.filter(s => s.patient_id === filterPatientId);
  }, [upcomingSessions, filterPatientId]);

  const filterPatientName = filterPatientId ? patients.find(p => p.id === filterPatientId)?.name || "" : "";

  const handleCellTap = useCallback((date, hour) => {
    setNewSessionPrefill({ date: toISODate(date), time: hour });
  }, []);

  // Drag-and-drop reschedule (desktop week view): accept drops on any
  // hour cell, move the session to that slot. Keeps duration intact;
  // uses formatShortDate + the hour string which already matches the
  // project's "D MMM" + "HH:MM" format.
  const handleDropSession = useCallback(async (sessionId, date, hour) => {
    const newShortDate = formatShortDate(date);
    // Group occurrence drag: id is "grp:<groupId>|<fromDate>|<fromTime>".
    // Move the WHOLE occurrence (all member rows) to the dropped slot.
    if (typeof sessionId === "string" && sessionId.startsWith("grp:")) {
      const [groupId, fromDate, fromTime] = sessionId.slice(4).split("|");
      if (fromDate === newShortDate && fromTime === hour) return;
      await rescheduleGroupOccurrence(groupId, fromDate, fromTime, newShortDate, hour);
      return;
    }
    const sess = upcomingSessions.find(s => s.id === sessionId);
    if (!sess) return;
    if (sess.date === newShortDate && sess.time === hour) return;
    await rescheduleSession(sessionId, newShortDate, hour, sess.duration || 60);
  }, [upcomingSessions, rescheduleSession, rescheduleGroupOccurrence]);

  // ── Month-view "move whole day" ──
  // The MonthGridPanel emits (srcDayIso, targetDayIso) when the user
  // drops a day onto another. We confirm before applying because a
  // single drag mutates N sessions; an accidental drop could move a
  // dozen rows. The actual writes go through the same
  // rescheduleSession path, in a Promise.allSettled batch so a single
  // failure doesn't half-apply.
  const [moveDayPair, setMoveDayPair] = useState(null); // { srcIso, tgtIso, sessions }
  const [moveDayBusy, setMoveDayBusy] = useState(false);
  const handleMonthMoveDay = useCallback((srcIso, tgtIso) => {
    if (!srcIso || !tgtIso || srcIso === tgtIso) return;
    // Resolve src + tgt to the formatShortDate strings the rest of the
    // app uses, then collect the sessions the user is about to move.
    const srcDate = new Date(srcIso + "T00:00:00");
    const srcShort = formatShortDate(srcDate);
    const sessions = upcomingSessions.filter((s) => s.date === srcShort);
    if (sessions.length === 0) return;
    setMoveDayPair({ srcIso, tgtIso, sessions });
  }, [upcomingSessions]);
  const confirmMonthMoveDay = useCallback(async () => {
    if (!moveDayPair || moveDayBusy) return;
    setMoveDayBusy(true);
    try {
      const { tgtIso, sessions } = moveDayPair;
      const newShortDate = formatShortDate(new Date(tgtIso + "T00:00:00"));
      const tasks = sessions.map((s) =>
        rescheduleSession(s.id, newShortDate, s.time, s.duration || 60)
      );
      const results = await Promise.allSettled(tasks);
      const ok = results.filter((r) => r.status === "fulfilled" && r.value !== false).length;
      const failed = sessions.length - ok;
      if (failed === 0) {
        showSuccess?.(t("agenda.moveDaySuccess", { n: ok }));
      } else {
        showToast?.(t("agenda.moveDayPartial", { n: ok, failed }), "info");
      }
      setMoveDayPair(null);
    } finally {
      setMoveDayBusy(false);
    }
  }, [moveDayPair, moveDayBusy, rescheduleSession, t, showSuccess, showToast]);

  const ctxMenu = useContextMenu();
  const handleEventContextMenu = useCallback((e, sess) => {
    const isCancelled = isCancelledStatus(sess.status);
    const isCompleted = sess.status === "completed";
    const items = [
      { key: "open", label: t("sessions.session"), icon: <IconCalendar size={15} />, onSelect: () => setSelectedSession(sess) },
      { divider: true },
    ];
    if (!isCompleted) {
      items.push({ key: "complete", label: t("sessions.markCompleted"), icon: <IconCheck size={15} />,
        onSelect: async () => { await onMarkCompleted(sess); } });
    }
    if (!isCancelled) {
      items.push({ key: "cancel", label: t("sessions.markCancelled") || "Cancelar sesión", icon: <IconX size={15} />,
        onSelect: async () => { await onCancelSession(sess, false, null); } });
    }
    items.push({ divider: true });
    items.push({ key: "delete", label: t("delete"), icon: <IconTrash size={15} />, destructive: true,
      onSelect: async () => { await deleteSession(sess.id); } });
    ctxMenu.openAt(e, items);
  }, [ctxMenu, onMarkCompleted, onCancelSession, deleteSession, t]);

  const jumpToToday = useCallback(() => {
    setSelectedDate(new Date(TODAY));
  }, []);

  const handleOpenNote = async (session) => {
    const existing = notes?.find(n => n.session_id === session.id);
    if (existing) {
      setEditingNote(existing);
    } else {
      const patient = patients?.find(p => p.name === session.patient);
      const note = await createNote({ patientId: patient?.id || session.patient_id, sessionId: session.id });
      if (note) setEditingNote(note);
    }
    setSelectedSession(null);
  };

  return (
    <>
    {editingNote && (
      <NoteEditor
        note={editingNote}
        onSave={async ({ title, content }) => await updateNote(editingNote.id, { title, content })}
        onDelete={async () => { await deleteNote(editingNote.id); }}
        onClose={() => setEditingNote(null)}
      />
    )}
    <div className="page">
      <div style={{ paddingTop:16 }}>
        {showCalendarCTA && (
          <div style={{ padding:"0 16px 12px" }}>
            <div className="agenda-calendar-link">
              <button
                type="button"
                className="agenda-calendar-link-main"
                onClick={() => setCalendarSheetOpen(true)}
                aria-label={t("agenda.calendarSyncCTA")}
              >
                <span className="agenda-calendar-link-icon"><IconCalendar size={16} /></span>
                <span className="agenda-calendar-link-label">{t("agenda.calendarSyncCTA")}</span>
              </button>
              <button
                type="button"
                className="agenda-calendar-link-dismiss"
                onClick={() => { dismissCalendarPrompt(user?.id); setCalendarCtaDismissed(true); }}
                aria-label={t("agenda.calendarSyncDismiss")}
              >
                <IconX size={16} />
              </button>
            </div>
          </div>
        )}
        <div style={{ padding:"0 16px 14px" }}>
          <SegmentedControl
            value={view}
            onChange={setView}
            items={[
              { k: "day",   l: t("agenda.dayView") },
              { k: "week",  l: t("agenda.weekView") },
              { k: "month", l: t("agenda.monthView") },
            ]}
          />
        </div>
        {/* Patient filter + "Seleccionar varias" share one row. The
            select takes the available width; the button sits on the
            right at the same height. Selection mode is day-view only
            (the button hides on week/month, since bulk-edit operates
            on the day list). When the user enters selection mode the
            button disappears and the bulk bar takes over. Renders
            only if either control has something to show — empty rows
            would leave a phantom gap above the calendar grid. */}
        {selectionMode && view === "day" && !readOnly ? (
          /* Selection header — replaces the filter row while selecting.
             Clear in-page exit (Cancelar) + live count, styled like the
             rest of the app (no dark slab). */
          <div style={{ padding:"0 16px 10px", display:"flex", gap:8, alignItems:"center", justifyContent:"space-between" }}>
            <button type="button" className="btn btn-ghost"
              onClick={() => { haptic.tap(); exitSelection(); }}
              style={{ width:"auto", height:"auto", padding:"6px 12px", fontSize:"var(--text-sm)", fontWeight:700 }}>
              {t("cancel")}
            </button>
            <span style={{ fontFamily:"var(--font-d)", fontWeight:800, fontSize:"var(--text-md)", color:"var(--charcoal)", fontVariantNumeric:"tabular-nums" }}>
              {selectedSet.size > 0 ? t("agenda.bulkBarCount", { n: selectedSet.size }) : t("agenda.bulkBarHint")}
            </span>
          </div>
        ) : (patients.length > 0 || (view === "day" && !readOnly)) && (
          <div style={{ padding:"0 16px 10px", display:"flex", gap:8, alignItems:"center" }}>
            {patients.length > 0 && (
              <select
                value={filterPatientId}
                onChange={e => setFilterPatientId(e.target.value)}
                style={{ flex:1, minWidth:0, fontSize:"var(--text-sm)", fontWeight:600, fontFamily:"var(--font)", padding:"8px 12px", borderRadius:"var(--radius-pill)", border:"1.5px solid var(--border)", background:"var(--white)", color:"var(--charcoal-md)", cursor:"pointer", appearance:"auto" }}
              >
                <option value="">{t("agenda.allPatients")}</option>
                {patients.filter(p => p.status === "active").sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            {view === "day" && !readOnly && (
              <button type="button" className="btn btn-ghost"
                onClick={() => { haptic.tap(); setSelectionMode(true); }}
                style={{ flexShrink:0, display:"inline-flex", alignItems:"center", gap:6, width:"auto", height:"auto", padding:"6px 12px", fontSize:12, whiteSpace:"nowrap" }}>
                {t("agenda.bulkSelectCta")}
              </button>
            )}
          </div>
        )}
      </div>
      {view==="day"   && <DayView   selectedDate={selectedDate} setSelectedDate={setSelectedDate} onSelectSession={selectItem} upcomingSessions={filteredSessions} jumpToToday={jumpToToday} filterPatientName={filterPatientName} selectionMode={selectionMode} selectedSet={selectedSet} onToggleSelect={onToggleSelect} onSwipeComplete={readOnly ? undefined : onMarkCompleted} groupsById={groupsById} />}
      {view==="week"  && <WeekView  selectedDate={selectedDate} setSelectedDate={setSelectedDate} setView={setView} onSelectSession={selectItem} onCellTap={handleCellTap} onDropSession={handleDropSession} canDrag={isTabletSplit} onEventContextMenu={isTabletSplit ? handleEventContextMenu : undefined} upcomingSessions={filteredSessions} now={now} jumpToToday={jumpToToday} groupsById={groupsById} />}
      {view==="month" && <MonthView selectedDate={selectedDate} setSelectedDate={setSelectedDate} onSelectSession={selectItem} upcomingSessions={filteredSessions} jumpToToday={jumpToToday} filterPatientName={filterPatientName} onMoveDay={handleMonthMoveDay} canMoveDay={!readOnly} onSwipeComplete={readOnly ? undefined : onMarkCompleted} groupsById={groupsById} />}
      {upcomingSessions.length === 0 && (() => {
        // Two flavours of "no sessions": brand-new user with zero
        // patients, or an existing user whose calendar is genuinely
        // empty for the period. The CTA differs — first patient
        // creation vs schedule a session — so the affordance points
        // at the right next step instead of dropping the user on a
        // dead end. readOnly suppresses both (demo / admin view-as).
        const noPatients = (patients || []).length === 0;
        const action = readOnly ? null : (
          <button
            type="button"
            onClick={() => requestFabAction?.(noPatients ? "patient" : "session")}
            className="btn btn-primary"
            style={{ display:"inline-flex", alignItems:"center", gap:8, width:"auto", padding:"10px 22px", height:"auto", minHeight:0 }}>
            <IconPlus size={16} />
            {noPatients ? t("patients.addFirstCta") : t("sessions.scheduleFirst")}
          </button>
        );
        return (
          <EmptyState
            kind="agenda"
            title={t("sessions.noSessions")}
            body={noPatients ? t("agenda.emptyHintNoPatients") : t("agenda.emptyHint")}
            cta={action}
          />
        );
      })()}
      {newSessionPrefill && (
        <NewSessionSheet
          onClose={() => setNewSessionPrefill(null)}
          onSubmit={createSession}
          patients={patients}
          sessions={upcomingSessions}
          mutating={mutating}
          initialDate={newSessionPrefill.date}
          initialTime={newSessionPrefill.time}
        />
      )}
      {selectedGroupOcc && selectedGroupOcc.group && (
        <GroupOccurrenceSheet
          group={selectedGroupOcc.group}
          occurrence={selectedGroupOcc}
          onClose={() => setSelectedGroupOcc(null)}
        />
      )}
      {calendarSheetOpen && (
        <CalendarLinkSheet onClose={() => setCalendarSheetOpen(false)} readOnly={readOnly} />
      )}
      <SessionSheet
        session={selectedSession}
        patients={patients}
        notes={notes}
        initialMode={selectedSessionMode}
        onClose={() => { setSelectedSession(null); setSelectedSessionMode(null); }}
        onOpenNote={handleOpenNote}
        onCancelSession={async (session, charge, reason) => {
          const ok = await onCancelSession(session, charge, reason);
          if (ok) setSelectedSession(prev => (prev ? { ...prev, status: charge ? "charged" : "cancelled", cancel_reason: reason || null } : prev));
          return ok;
        }}
        onMarkCompleted={async (session, overrideStatus) => {
          const st = overrideStatus || "completed";
          const ok = await onMarkCompleted(session, overrideStatus);
          if (ok) setSelectedSession(prev => (prev ? { ...prev, status: st, cancel_reason: null } : prev));
          return ok;
        }}
        onDelete={async (id) => { await deleteSession(id); setSelectedSession(null); }}
        onReschedule={async (id, date, time, duration) => {
          const ok = await rescheduleSession(id, date, time, duration);
          if (ok) setSelectedSession(prev => prev ? { ...prev, date, time, duration, status: "scheduled" } : prev);
          return ok;
        }}
        onUpdateModality={async (id, modality) => {
          const ok = await updateSessionModality(id, modality);
          if (ok) setSelectedSession(prev => prev ? { ...prev, modality } : prev);
          return ok;
        }}
        onUpdateRate={async (id, rate) => {
          const ok = await updateSessionRate(id, rate);
          if (ok) setSelectedSession(prev => prev ? { ...prev, rate: Number(rate) } : prev);
          return ok;
        }}
        onUpdateCancelReason={async (id, reason) => {
          const ok = await updateCancelReason(id, reason);
          if (ok) setSelectedSession(prev => prev ? { ...prev, cancel_reason: reason.trim() || null } : prev);
          return ok;
        }}
        mutating={mutating}
      />
      <ContextMenu {...ctxMenu.state} onClose={ctxMenu.close} />
      {/* Bulk action launcher — a single elevated primary pill (the FAB +
          bottom tabs are hidden in selection mode). Disabled until ≥1
          selected; opens the canonical action sheet. */}
      {selectionMode && view === "day" && !readOnly && (
        <div style={{ position:"fixed", left:0, right:0, bottom:"calc(16px + var(--sab, env(safe-area-inset-bottom, 0px)))", display:"flex", justifyContent:"center", padding:"0 16px", zIndex:"var(--z-banner, 30)", pointerEvents:"none" }}>
          <button type="button"
            disabled={selectedSet.size === 0 || bulkBusy}
            onClick={() => { haptic.tap(); setBulkSheetOpen(true); }}
            className="btn btn-primary-teal btn-tap"
            style={{ pointerEvents:"auto", width:"auto", minWidth:200, height:52, gap:8, boxShadow:"var(--shadow-lg)", opacity: (selectedSet.size === 0 || bulkBusy) ? 0.55 : 1 }}>
            {t("agenda.bulkActionsCta")}{selectedSet.size > 0 ? ` · ${selectedSet.size}` : ""}
          </button>
        </div>
      )}
      {bulkSheetOpen && (
        <BulkActionsSheet
          count={selectedSet.size}
          busy={bulkBusy}
          onClose={() => setBulkSheetOpen(false)}
          onComplete={() => bulkApply("complete")}
          onCancelNoCharge={() => bulkApply("cancel")}
          onCancelCharge={() => bulkApply("cancel-charge")}
          onDelete={() => bulkApply("delete")}
        />
      )}
      {moveDayPair && (
        <ConfirmDialog
          open
          title={t("agenda.moveDayTitle", { n: moveDayPair.sessions.length })}
          body={t("agenda.moveDayBody", {
            src: formatShortDate(new Date(moveDayPair.srcIso + "T00:00:00")),
            tgt: formatShortDate(new Date(moveDayPair.tgtIso + "T00:00:00")),
            n: moveDayPair.sessions.length,
          })}
          confirmLabel={t("agenda.moveDayConfirm")}
          cancelLabel={t("cancel")}
          busy={moveDayBusy}
          onConfirm={confirmMonthMoveDay}
          onCancel={() => setMoveDayPair(null)}
        />
      )}
    </div>
    </>
  );
}
