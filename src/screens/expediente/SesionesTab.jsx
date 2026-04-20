import { useState, useEffect } from "react";
import { IconClipboard } from "../../components/Icons";
import { isTutorSession, statusClass } from "../../utils/sessions";
import { SegmentedControl } from "../../components/SegmentedControl";
import { useT } from "../../i18n/index";

const SESSIONS_COLLAPSED_COUNT = 5;

const FILTER_LABEL_STYLE = {
  fontSize: "10px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--charcoal-xl)",
  marginBottom: 6,
};

export function SesionesTab({
  pSessions, pNotes, sessCounts,
  sessTypeFilter, setSessTypeFilter, sessStatusFilter, setSessStatusFilter,
  sessDateFrom, setSessDateFrom, sessDateTo, setSessDateTo,
  filteredPSessions, upcomingPSessions, pastPSessions,
  onSelectSession, onOpenNote,
}) {
  const { t } = useT();

  if (pSessions.length === 0) {
    return (
      <div style={{ padding:"16px" }}>
        <div className="card empty-hint">{t("expediente.noSessions")}</div>
      </div>
    );
  }

  return (
    <div style={{ padding:"16px" }}>
      {/* Filters — two clearly-grouped segmented controls. The previous
          double-row of identical chips read as "a bunch of random
          buttons"; labeling each group (Tipo / Estado) and swapping the
          loose chips for a single slider-style control per row makes the
          relationship obvious. Tipo only appears when the patient has
          any tutor sessions. */}
      <div style={{ marginBottom:12, display:"flex", flexDirection:"column", gap:12 }}>
        {sessCounts.tutor > 0 && (
          <div>
            <div style={FILTER_LABEL_STYLE}>{t("expediente.type")}</div>
            <SegmentedControl
              value={sessTypeFilter}
              onChange={setSessTypeFilter}
              ariaLabel={t("expediente.type")}
              items={[
                { k: "all",     l: t("expediente.allTypes") },
                { k: "patient", l: t("expediente.patientType") },
                { k: "tutor",   l: t("expediente.tutorType") },
              ]}
            />
          </div>
        )}
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

      {/* Active date range indicator */}
      {(sessDateFrom || sessDateTo) && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:12, padding:"6px 12px", background:"var(--teal-pale)", borderRadius:"var(--radius-pill)", fontSize:"var(--text-xs)", fontWeight:600, color:"var(--teal-dark)" }}>
          <span>{t("expediente.dateRangeApplied", {
            from: sessDateFrom ? sessDateFrom.slice(5) : "—",
            to: sessDateTo ? sessDateTo.slice(5) : "—",
          })}</span>
          <button type="button"
            onClick={() => { setSessDateFrom(null); setSessDateTo(null); }}
            style={{ background:"none", border:"none", color:"var(--teal-dark)", fontWeight:700, cursor:"pointer", fontFamily:"var(--font)", fontSize:"var(--text-xs)", padding:0 }}>
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

function SessionsSection({ title, emptyLabel, sessions, pNotes, onSelect, onOpenNote, t }) {
  const [expanded, setExpanded] = useState(false);
  // Collapse again whenever the filtered list changes so switching filters
  // doesn't leave a stale "expanded" view visible.
  useEffect(() => { setExpanded(false); }, [sessions]);

  if (sessions.length === 0) {
    return (
      <>
        <div style={SECTION_LABEL_STYLE}>{title}</div>
        <div className="card empty-hint">{emptyLabel}</div>
      </>
    );
  }
  const canCollapse = sessions.length > SESSIONS_COLLAPSED_COUNT;
  const visible = canCollapse && !expanded
    ? sessions.slice(0, SESSIONS_COLLAPSED_COUNT)
    : sessions;
  return (
    <>
      <div style={SECTION_LABEL_STYLE}>{title}</div>
      <div className="card">
        {visible.map(s => {
          const tutor = isTutorSession(s);
          const hasNote = pNotes.some(n => n.session_id === s.id);
          const hasSecondLine = tutor || hasNote;
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
        {canCollapse && (
          <button type="button"
            onClick={() => setExpanded(e => !e)}
            className="row-item"
            style={{ width:"100%", background:"none", border:"none", cursor:"pointer", fontFamily:"var(--font)", color:"var(--teal-dark)", fontWeight:700, fontSize:"var(--text-sm)", justifyContent:"center", textAlign:"center" }}>
            {expanded
              ? t("expediente.showLessSessions")
              : t("expediente.showMoreSessions", { count: sessions.length - SESSIONS_COLLAPSED_COUNT })}
          </button>
        )}
      </div>
    </>
  );
}
