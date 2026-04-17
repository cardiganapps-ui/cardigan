import { IconClipboard } from "../../components/Icons";
import { isTutorSession, statusClass } from "../../utils/sessions";
import { useT } from "../../i18n/index";

export function SesionesTab({
  pSessions, pNotes, sessCounts,
  sessTypeFilter, setSessTypeFilter, sessStatusFilter, setSessStatusFilter,
  sessDateFrom, setSessDateFrom, sessDateTo, setSessDateTo,
  filteredPSessions, upcomingPSessions, pastPSessions,
  onSelectSession,
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
      {/* Filters */}
      <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap" }}>
        {/* Type filter */}
        {sessCounts.tutor > 0 && (
          <div style={{ display:"flex", gap:4 }}>
            {[
              { key: "all", label: t("expediente.allTypes") },
              { key: "patient", label: t("expediente.patientType") },
              { key: "tutor", label: t("expediente.tutorType") },
            ].map(f => (
              <button key={f.key} type="button"
                className={`chip ${sessTypeFilter === f.key ? "active" : ""}`}
                style={sessTypeFilter === f.key && f.key === "tutor" ? { background:"var(--purple)", borderColor:"var(--purple)", color:"white" } : undefined}
                onClick={() => setSessTypeFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
        )}
        {/* Status filter */}
        <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
          {[
            { key: "all", label: t("expediente.allStatuses") },
            { key: "completed", label: t("expediente.attended") },
            { key: "cancelled_any", label: t("expediente.cancelled") },
            { key: "scheduled", label: t("sessions.scheduled") },
          ].map(f => (
            <button key={f.key} type="button"
              className={`chip ${sessStatusFilter === f.key ? "active" : ""}`}
              onClick={() => setSessStatusFilter(f.key)}>
              {f.label}
            </button>
          ))}
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

function SessionsSection({ title, emptyLabel, sessions, pNotes, onSelect, t }) {
  if (sessions.length === 0) {
    return (
      <>
        <div style={SECTION_LABEL_STYLE}>{title}</div>
        <div className="card empty-hint">{emptyLabel}</div>
      </>
    );
  }
  return (
    <>
      <div style={SECTION_LABEL_STYLE}>{title}</div>
      <div className="card">
        {sessions.map(s => {
          const tutor = isTutorSession(s);
          const hasNote = pNotes.some(n => n.session_id === s.id);
          return (
            <div className="row-item" key={s.id} onClick={() => onSelect(s)}>
              <div className="row-content">
                <div className="row-title" style={{ fontFamily:"var(--font-d)", fontWeight:700 }}>
                  {s.date} · {s.time}
                </div>
                <div style={{ marginTop:3, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                  <span className={`session-status ${statusClass(s.status)}`}>
                    {t(`sessions.${s.status}`)}
                  </span>
                  {tutor && (
                    <span style={{ fontSize:"var(--text-eyebrow)", fontWeight:700, color:"var(--purple)", textTransform:"uppercase" }}>
                      {t("sessions.tutor")}
                    </span>
                  )}
                  {hasNote && (
                    <span style={{ fontSize:"var(--text-eyebrow)", color:"var(--teal-dark)", fontWeight:600, display:"inline-flex", alignItems:"center", gap:3 }}>
                      <IconClipboard size={11} />
                      {t("notes.noteAttached")}
                    </span>
                  )}
                </div>
              </div>
              <span className="row-chevron">›</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
