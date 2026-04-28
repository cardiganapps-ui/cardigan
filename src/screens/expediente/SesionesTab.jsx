import { useMemo, useState } from "react";
import { IconClipboard } from "../../components/Icons";
import { isTutorSession, statusClass } from "../../utils/sessions";
import { SegmentedControl } from "../../components/SegmentedControl";
import { todayISO } from "../../utils/dates";
import { useT } from "../../i18n/index";

const SESSIONS_COLLAPSED_COUNT = 5;

// Map a period key ("1m"/"3m"/"6m"/"1y") to a from-ISO date N months before
// today. Null is returned for "all". Mirrors the Pagos tab behavior.
function periodFromKey(key) {
  if (key === "all" || !key) return null;
  const months = { "1m": 1, "3m": 3, "6m": 6, "1y": 12 };
  const m = months[key];
  if (!m) return null;
  const d = new Date(); d.setMonth(d.getMonth() - m);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// Derive the active period chip from the current sessDateFrom/sessDateTo.
// Returns "" when the range was set to something other than a canonical
// period (e.g. navigated in from a Resumen tile with a custom earliest date).
function sessPeriodKey(from, to) {
  if (!from && !to) return "all";
  const today = todayISO();
  if (to !== today) return "";
  for (const k of ["1m", "3m", "6m", "1y"]) {
    if (from === periodFromKey(k)) return k;
  }
  return "";
}

function applySessPeriod(key, setFrom, setTo) {
  if (key === "all") { setFrom(null); setTo(null); return; }
  setFrom(periodFromKey(key));
  setTo(todayISO());
}

const FILTER_LABEL_STYLE = {
  fontSize: "10px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--charcoal-xl)",
  marginBottom: 6,
};

export function SesionesTab({
  pSessions, pNotes,
  sessStatusFilter, setSessStatusFilter,
  sessDateFrom, setSessDateFrom, sessDateTo, setSessDateTo,
  sessTutorOnly, setSessTutorOnly,
  filteredPSessions, upcomingPSessions, pastPSessions,
  onSelectSession, onOpenNote,
}) {
  const { t } = useT();

  /* Recurring-slot detection — same heuristic the Resumen Horarios
     section uses: a (day, time) slot is "recurring" iff there are
     ≥2 active (non-cancelled, non-charged) sessions on it. We can't
     trust `is_recurring=true` alone because migration 025 backfilled
     every legacy row to true. The badge below uses this set to spot
     legacy one-offs that the explicit flag would otherwise miss. */
  const recurringSlots = useMemo(() => {
    const counts = new Map();
    for (const s of pSessions) {
      if (s.status === "cancelled" || s.status === "charged") continue;
      if (s.is_recurring === false) continue;
      const key = `${s.day}|${s.time}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const out = new Set();
    for (const [k, c] of counts) if (c >= 2) out.add(k);
    return out;
  }, [pSessions]);

  if (pSessions.length === 0) {
    return (
      <div style={{ padding:"16px" }}>
        <div className="card empty-hint">{t("expediente.noSessions")}</div>
      </div>
    );
  }

  return (
    <div style={{ padding:"16px" }}>
      {/* Filters — Período (date range) + Estado (status). Each group
          is labeled and uses a single slider-style control per row. */}
      <div style={{ marginBottom:12, display:"flex", flexDirection:"column", gap:12 }}>
        <div>
          <div style={FILTER_LABEL_STYLE}>{t("expediente.period")}</div>
          <SegmentedControl
            value={sessPeriodKey(sessDateFrom, sessDateTo)}
            onChange={(k) => applySessPeriod(k, setSessDateFrom, setSessDateTo)}
            ariaLabel={t("expediente.period")}
            items={[
              { k: "all", l: t("periods.all") },
              { k: "1m",  l: t("periods.1m") },
              { k: "3m",  l: t("periods.3m") },
              { k: "6m",  l: t("periods.6m") },
              { k: "1y",  l: t("periods.1y") },
            ]}
          />
        </div>
        <div>
          <div style={FILTER_LABEL_STYLE}>{t("expediente.filterStatus")}</div>
          <SegmentedControl
            value={sessStatusFilter}
            onChange={setSessStatusFilter}
            ariaLabel={t("expediente.filterStatus")}
            items={[
              { k: "all",            l: t("expediente.allStatuses") },
              { k: "scheduled",      l: t("sessions.scheduled") },
              { k: "completed",      l: t("expediente.attended") },
              { k: "cancelled_any",  l: t("expediente.cancelled") },
            ]}
          />
        </div>
      </div>

      {/* Active tutor-only indicator. Surfaced because the Sesiones tab
          has no UI control for this filter — it's only triggered from
          the Resumen tutor tile, so the user needs a visible signal
          that the list is scoped. Reuses the purple accent so it reads
          as "tutor-flavoured" at a glance, matching the tile's color. */}
      {sessTutorOnly && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:12, padding:"6px 12px", background:"var(--purple-bg)", borderRadius:"var(--radius-pill)", fontSize:"var(--text-xs)", fontWeight:600, color:"var(--purple)" }}>
          <span>{t("expediente.tutorFilterActive")}</span>
          <button type="button"
            onClick={() => setSessTutorOnly(false)}
            style={{ background:"none", border:"none", color:"var(--purple)", fontWeight:700, cursor:"pointer", fontFamily:"var(--font)", fontSize:"var(--text-xs)", padding:0 }}>
            {t("expediente.clearDateRange")}
          </button>
        </div>
      )}

      {/* Session lists */}
      {filteredPSessions.length === 0 ? (
        <div className="card empty-hint">{t("sessions.noSessions")}</div>
      ) : (
        <>
          {upcomingPSessions.length > 0 && (
            <SessionsSection
              title={t("expediente.upcomingSessions")}
              emptyLabel={t("expediente.noUpcomingSessions")}
              sessions={upcomingPSessions}
              pNotes={pNotes}
              onSelect={onSelectSession}
              onOpenNote={onOpenNote}
              moreLabelKey="expediente.showMoreSessions"
              recurringSlots={recurringSlots}
              t={t}
            />
          )}
          {pastPSessions.length > 0 && (
            <div style={{ marginTop: upcomingPSessions.length > 0 ? 16 : 0 }}>
              <SessionsSection
                title={t("expediente.pastSessions")}
                emptyLabel={t("expediente.noPastSessions")}
                sessions={pastPSessions}
                pNotes={pNotes}
                onSelect={onSelectSession}
                onOpenNote={onOpenNote}
                moreLabelKey="expediente.showMorePastSessions"
                recurringSlots={recurringSlots}
                t={t}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

const SECTION_LABEL_STYLE = {
  fontSize: "var(--text-xs)",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  color: "var(--charcoal-xl)",
  marginBottom: 6,
};

function SessionsSection({ title, emptyLabel, sessions, pNotes, onSelect, onOpenNote, moreLabelKey, recurringSlots, t }) {
  const [visibleCount, setVisibleCount] = useState(SESSIONS_COLLAPSED_COUNT);
  // Reset to the initial window whenever the filtered list changes so
  // switching filters doesn't leave a stale expanded view visible.
  // Adjust-state-during-render pattern.
  const [prevSessions, setPrevSessions] = useState(sessions);
  if (sessions !== prevSessions) {
    setPrevSessions(sessions);
    setVisibleCount(SESSIONS_COLLAPSED_COUNT);
  }

  if (sessions.length === 0) {
    return (
      <>
        <div style={SECTION_LABEL_STYLE}>{title}</div>
        <div className="card empty-hint">{emptyLabel}</div>
      </>
    );
  }
  const hasMore = sessions.length > visibleCount;
  const canCollapse = visibleCount > SESSIONS_COLLAPSED_COUNT;
  const visible = hasMore ? sessions.slice(0, visibleCount) : sessions;
  const remaining = sessions.length - visibleCount;
  return (
    <>
      <div style={SECTION_LABEL_STYLE}>{title}</div>
      <div className="card">
        {visible.map(s => {
          const tutor = isTutorSession(s);
          const hasNote = pNotes.some(n => n.session_id === s.id);
          // Manual one-off detection. `is_recurring=false` is the
          // explicit signal for sessions created after migration 025.
          // For older rows (which were all backfilled to is_recurring=true)
          // we fall back to the slot-occupancy check: if this (day, time)
          // doesn't appear in the patient's set of recurring slots
          // (≥2 active sessions on the slot), it's effectively a one-off.
          // Tutor sessions are excluded — they already get their own
          // purple eyebrow.
          const slotKey = `${s.day}|${s.time}`;
          const oneOff = !tutor && (s.is_recurring === false || !recurringSlots?.has(slotKey));
          const hasSecondLine = tutor || oneOff || hasNote;
          return (
            <div className="row-item" key={s.id} onClick={() => onSelect(s)}>
              <div className="row-content">
                {/* Title row: time on the left, status pill pinned to the
                    right of the same line. Keeps the row a single line when
                    there's no tutor/note badge, so the list feels denser. */}
                <div style={{ display:"flex", alignItems:"center", gap:8, minHeight:22 }}>
                  <div className="row-title" style={{ fontFamily:"var(--font-d)", fontWeight:700, flex:1, minWidth:0 }}>
                    {s.date} · {s.time}
                  </div>
                  <span className={`session-status ${statusClass(s.status)}`} style={{ flexShrink:0 }}>
                    {t(`sessions.${s.status}`)}
                  </span>
                </div>
                {hasSecondLine && (
                  <div style={{ marginTop:3, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                    {tutor && (
                      <span style={{ fontSize:"var(--text-eyebrow)", fontWeight:700, color:"var(--purple)", textTransform:"uppercase" }}>
                        {t("sessions.tutor")}
                      </span>
                    )}
                    {oneOff && (
                      <span style={{ fontSize:"var(--text-eyebrow)", fontWeight:700, color:"var(--charcoal-xl)", textTransform:"uppercase", letterSpacing:"0.06em" }}>
                        {t("sessions.oneOffBadge")}
                      </span>
                    )}
                    {hasNote && (
                      onOpenNote ? (
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); onOpenNote(s); }}
                          aria-label={t("notes.noteAttached")}
                          style={{ fontSize:"var(--text-eyebrow)", color:"var(--teal-dark)", fontWeight:600, display:"inline-flex", alignItems:"center", gap:3, background:"none", border:"none", padding:0, margin:0, minHeight:"unset", cursor:"pointer", fontFamily:"var(--font)", WebkitTapHighlightColor:"transparent" }}>
                          <IconClipboard size={11} />
                          {t("notes.noteAttached")}
                        </button>
                      ) : (
                        <span style={{ fontSize:"var(--text-eyebrow)", color:"var(--teal-dark)", fontWeight:600, display:"inline-flex", alignItems:"center", gap:3 }}>
                          <IconClipboard size={11} />
                          {t("notes.noteAttached")}
                        </span>
                      )
                    )}
                  </div>
                )}
              </div>
              <span className="row-chevron">›</span>
            </div>
          );
        })}
        {hasMore && (
          <button type="button"
            onClick={() => setVisibleCount(n => n + SESSIONS_COLLAPSED_COUNT)}
            className="row-item"
            style={{ width:"100%", background:"none", border:"none", cursor:"pointer", fontFamily:"var(--font)", color:"var(--teal-dark)", fontWeight:700, fontSize:"var(--text-sm)", justifyContent:"center", textAlign:"center" }}>
            {t(moreLabelKey, { count: remaining })}
          </button>
        )}
        {!hasMore && canCollapse && (
          <button type="button"
            onClick={() => setVisibleCount(SESSIONS_COLLAPSED_COUNT)}
            className="row-item"
            style={{ width:"100%", background:"none", border:"none", cursor:"pointer", fontFamily:"var(--font)", color:"var(--teal-dark)", fontWeight:700, fontSize:"var(--text-sm)", justifyContent:"center", textAlign:"center" }}>
            {t("expediente.showLessSessions")}
          </button>
        )}
      </div>
    </>
  );
}
