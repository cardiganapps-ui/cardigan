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
      <div style={{ padding:16 }}>
        <div className="card" style={{ padding:"32px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>
          {t("expediente.noSessions")}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding:16 }}>
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
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:12, padding:"8px 12px", background:"var(--teal-pale)", borderRadius:"var(--radius-pill)", fontSize:11, fontWeight:600, color:"var(--teal-dark)" }}>
          <span>{t("expediente.dateRangeApplied", {
            from: sessDateFrom ? sessDateFrom.slice(5) : "—",
            to: sessDateTo ? sessDateTo.slice(5) : "—",
          })}</span>
          <button type="button"
            onClick={() => { setSessDateFrom(null); setSessDateTo(null); }}
            style={{ background:"none", border:"none", color:"var(--teal-dark)", fontWeight:700, cursor:"pointer", fontFamily:"var(--font)", fontSize:11, padding:0 }}>
            {t("expediente.clearDateRange")}
          </button>
        </div>
      )}

      {/* Session lists */}
      {filteredPSessions.length === 0 ? (
        <div className="card" style={{ padding:"20px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:12 }}>
          {t("sessions.noSessions")}
        </div>
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

function SessionsSection({ title, emptyLabel, sessions, pNotes, onSelect, t }) {
  if (sessions.length === 0) {
    return (
      <>
        <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:6 }}>{title}</div>
        <div className="card" style={{ padding:"20px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:12 }}>
          {emptyLabel}
        </div>
      </>
    );
  }
  return (
    <>
      <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--charcoal-xl)", marginBottom:6 }}>{title}</div>
      <div className="card">
        {sessions.map(s => {
          const tutor = isTutorSession(s);
          const hasNote = pNotes.some(n => n.session_id === s.id);
          return (
            <div className="row-item" key={s.id} onClick={() => onSelect(s)} style={{ cursor:"pointer" }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{
                  fontFamily:"var(--font-d)", fontSize:13, fontWeight:700, color:"var(--charcoal)",
                  whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                }}>
                  {s.date} · {s.time}
                </div>
                <div style={{ marginTop:3, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                  <span className={`session-status ${statusClass(s.status)}`} style={{ fontSize:10 }}>
                    {t(`sessions.${s.status}`)}
                  </span>
                  {tutor && (
                    <span style={{ fontSize:9, fontWeight:700, color:"var(--purple)", textTransform:"uppercase" }}>
                      {t("sessions.tutor")}
                    </span>
                  )}
                  {hasNote && (
                    <span style={{ fontSize:10, color:"var(--teal-dark)", fontWeight:600, display:"inline-flex", alignItems:"center", gap:3 }}>
                      <IconClipboard size={11} />
                      {t("notes.noteAttached")}
                    </span>
                  )}
                </div>
              </div>
              <span className="row-chevron" style={{ flexShrink:0 }}>›</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
