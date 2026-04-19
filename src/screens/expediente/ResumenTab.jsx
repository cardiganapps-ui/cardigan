import { useMemo } from "react";
import { shortDateToISO, todayISO } from "../../utils/dates";
import { isTutorSession, getLastTutorSession, getNextTutorSession } from "../../utils/sessions";
import { SegmentedControl } from "../../components/SegmentedControl";
import { DAY_ORDER } from "../../data/seedData";
import { useT } from "../../i18n/index";

// ── Date helpers ──
// Both display formats render in Spanish and are used in the patient's
// recurring-schedule rows on the Resumen card.
function formatISODateLong(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

// Derive the patient's active recurring schedule(s) from their
// non-cancelled sessions. Returns an array of { day, time } pairs sorted
// Monday→Sunday, time ascending, deduped. Prefers future sessions; falls
// back to all sessions for ended patients so the historical schedule
// still shows on the expediente.
function derivePatientSchedules(sessions, patientId, includePast) {
  const today = todayISO();
  const seen = new Set();
  const result = [];
  for (const s of sessions) {
    if (s.patient_id !== patientId) continue;
    if (s.status === "cancelled" || s.status === "charged") continue;
    if (!includePast) {
      const iso = shortDateToISO(s.date);
      if (iso < today) continue;
    }
    const key = `${s.day}|${s.time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ day: s.day, time: s.time });
  }
  result.sort((a, b) => {
    const di = DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day);
    if (di !== 0) return di;
    return (a.time || "").localeCompare(b.time || "");
  });
  return result;
}

const SECTION_LABEL_STYLE = {
  fontSize: "var(--text-xs)",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  color: "var(--charcoal-xl)",
};

export function ResumenTab({
  patient, upcomingSessions,
  dateFrom, setDateFrom, dateTo, setDateTo, earliestISO,
  filteredSessions,
  onRecordPayment, onGoToSesiones, onGoToArchivo, mutating,
}) {
  const { t } = useT();

  const { fTotal, fCompleted, fCancelledTotal } = useMemo(() => {
    let completed = 0, cancelled = 0, charged = 0;
    for (const s of filteredSessions) {
      if (s.status === "completed") completed++;
      else if (s.status === "cancelled") cancelled++;
      else if (s.status === "charged") charged++;
    }
    return {
      fTotal: filteredSessions.length,
      fCompleted: completed,
      fCancelledTotal: cancelled + charged,
    };
  }, [filteredSessions]);

  // ── Recurring schedule rows ──
  // Active patients show their current/upcoming (day, time) pairs; ended
  // patients fall back to the historical schedule so the card still has
  // context. The last-session date becomes the effective "end date" for
  // ended patients (we don't store end_date on the row).
  const isEnded = patient.status === "ended";
  const schedules = useMemo(
    () => derivePatientSchedules(upcomingSessions || [], patient.id, isEnded),
    [upcomingSessions, patient.id, isEnded]
  );

  const lastSessionDate = useMemo(() => {
    let latestIso = null;
    for (const s of (upcomingSessions || [])) {
      if (s.patient_id !== patient.id) continue;
      if (s.status === "cancelled" || s.status === "charged") continue;
      const iso = shortDateToISO(s.date);
      if (iso > todayISO()) continue;
      if (!latestIso || iso > latestIso) latestIso = iso;
    }
    return latestIso;
  }, [upcomingSessions, patient.id]);

  const nextSessionDate = useMemo(() => {
    let earliestIso = null;
    const today = todayISO();
    for (const s of (upcomingSessions || [])) {
      if (s.patient_id !== patient.id) continue;
      if (s.status === "cancelled" || s.status === "charged") continue;
      const iso = shortDateToISO(s.date);
      if (iso < today) continue;
      if (!earliestIso || iso < earliestIso) earliestIso = iso;
    }
    return earliestIso;
  }, [upcomingSessions, patient.id]);

  return (
    <div style={{ padding:"16px" }}>
      {/* General info */}
      <div className="card" style={{ padding:0, marginBottom:10 }}>
        {(() => {
          const scheduleValue = schedules.length === 0
            ? t("patients.notRecurring") || "Sin recurrencia"
            : schedules.map(s => `${s.day} · ${s.time}`).join("\n");
          const rows = [
            ...(patient.birthdate ? [{ label: t("patients.birthdate"), value: (() => {
              const birth = new Date(patient.birthdate + "T00:00:00");
              const today = new Date();
              let age = today.getFullYear() - birth.getFullYear();
              const m = today.getMonth() - birth.getMonth();
              if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
              return `${birth.toLocaleDateString("es-MX", { day:"numeric", month:"short", year:"numeric" })} (${age} ${t("patients.yearsOld")})`;
            })() }] : []),
            { label: t("patients.rate"), value:`$${patient.rate} ${t("expediente.perSession")}` },
            { label: t("patients.schedules"), value: scheduleValue, multiline: schedules.length > 1 },
            ...(patient.start_date ? [{ label: t("patients.startDate"), value: formatISODateLong(patient.start_date) }] : []),
            ...(!isEnded && nextSessionDate ? [{ label: t("home.nextSession"), value: formatISODateLong(nextSessionDate) }] : []),
            ...(isEnded && lastSessionDate ? [{ label: t("patients.endDate"), value: formatISODateLong(lastSessionDate) }] : []),
            ...(patient.parent ? [{ label: t("sessions.tutor"), value: patient.parent }] : []),
            ...(patient.tutor_frequency ? [{ label: t("expediente.tutorFrequencyRow"), value: t("patients.everyNWeeks", { count: patient.tutor_frequency }) }] : []),
          ];
          return (
            <>
              {rows.map((row, i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems: row.multiline ? "flex-start" : "center", minHeight:42, padding:"10px 16px", borderBottom: i < rows.length - 1 ? "1px solid var(--border-lt)" : "none", gap:12 }}>
                  <span style={{ fontSize:"var(--text-sm)", lineHeight:1.25, color:"var(--charcoal-xl)" }}>{row.label}</span>
                  <span style={{ fontSize:"var(--text-sm)", lineHeight:1.35, fontWeight:600, color:"var(--charcoal)", textAlign:"right", whiteSpace:"pre-line" }}>{row.value}</span>
                </div>
              ))}
            </>
          );
        })()}
      </div>

      {/* Tutor reminder card — only for minors with tutor_frequency */}
      {!!patient.parent && !!patient.tutor_frequency && (() => {
        const lastTutor = getLastTutorSession(upcomingSessions, patient.id);
        const nextTutor = getNextTutorSession(upcomingSessions, patient.id);
        const DAY_MS = 86400000;
        const todayMs = new Date(todayISO() + "T00:00:00").getTime();
        let daysSince = null;
        let daysUntilDue = null;
        if (lastTutor) {
          const lastMs = new Date(shortDateToISO(lastTutor.date) + "T00:00:00").getTime();
          daysSince = Math.round((todayMs - lastMs) / DAY_MS);
          daysUntilDue = (patient.tutor_frequency * 7) - daysSince;
        }
        const overdue = lastTutor ? daysUntilDue < 0 : true;
        const dueSoon = lastTutor && daysUntilDue >= 0 && daysUntilDue <= 7;
        const dueNextWeek = lastTutor && daysUntilDue > 7 && daysUntilDue <= 14;
        const upToDate = lastTutor && daysUntilDue > 14;
        if (upToDate && !nextTutor) {
          return (
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, padding:"6px 12px", marginBottom:10, background:"var(--green-bg)", borderRadius:"var(--radius-pill)", fontSize:"var(--text-xs)", fontWeight:600, color:"var(--green)" }}>
              <span>{t("expediente.tutorScheduleCard")} · {t("patients.everyNWeeks", { count: patient.tutor_frequency })}</span>
              <span className="badge badge-green">{t("expediente.tutorUpToDate")}</span>
            </div>
          );
        }
        return (
          <div className="card" style={{ padding:"10px 12px", marginBottom:10, background:"var(--purple-bg)", border:"1.5px solid var(--purple)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6, gap:6, flexWrap:"wrap" }}>
              <div style={{ ...SECTION_LABEL_STYLE, color:"var(--purple)" }}>
                {t("expediente.tutorScheduleCard")} · {t("patients.everyNWeeks", { count: patient.tutor_frequency })}
              </div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", justifyContent:"flex-end" }}>
                {nextTutor && <span className="badge badge-teal">{t("expediente.tutorScheduled")}</span>}
                {!nextTutor && overdue && <span className="badge badge-red">{daysSince != null ? t("expediente.tutorOverdue", { count: Math.abs(daysUntilDue) }) : t("home.noTutorSession")}</span>}
                {!nextTutor && dueSoon && <span className="badge badge-amber">{t("expediente.tutorDueSoon")}</span>}
                {!nextTutor && dueNextWeek && <span className="badge badge-purple">{t("expediente.tutorDueNextWeek")}</span>}
              </div>
            </div>
            {nextTutor && (
              <div style={{ fontSize:"var(--text-sm)", color:"var(--purple)", fontWeight:600, marginBottom:2 }}>
                {t("expediente.tutorNextScheduled", { date: nextTutor.date })}
              </div>
            )}
            <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-md)" }}>
              {lastTutor
                ? `${t("home.lastTutorSession")}: ${lastTutor.date}`
                : t("home.noTutorSession")}
            </div>
          </div>
        );
      })()}

      {/* Financials — all-time totals */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10, alignItems:"stretch" }}>
        <div className="stat-tile" style={{ textAlign:"center" }}>
          <div className="stat-tile-label">{t("finances.collected")}</div>
          <div className="stat-tile-val" style={{ color:"var(--green)", fontSize:"var(--text-xl)" }}>${patient.paid.toLocaleString()}</div>
        </div>
        <div className="stat-tile" style={{ textAlign:"center" }}>
          <div className="stat-tile-label">{t("finances.balance")}</div>
          <div className="stat-tile-val" style={{ color: patient.amountDue > 0 ? "var(--red)" : "var(--green)", fontSize:"var(--text-xl)" }}>${patient.amountDue.toLocaleString()}</div>
        </div>
      </div>

      {/* Attendance — with time filter */}
      <div className="card" style={{ padding:"10px 12px", marginBottom:10 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
          <div style={SECTION_LABEL_STYLE}>{t("expediente.attendance")}</div>
        </div>
        {(() => {
          const periods = [
            ...(earliestISO ? [{ k: "all", l: t("periods.all"), from: earliestISO }] : []),
            { k: "1m", l: t("periods.1m"), m: 1 },
            { k: "3m", l: t("periods.3m"), m: 3 },
            { k: "6m", l: t("periods.6m"), m: 6 },
            { k: "1y", l: t("periods.1y"), m: 12 },
          ];
          const periodFromKey = (p) => {
            if (p.from) return p.from;
            const d = new Date(); d.setMonth(d.getMonth() - p.m);
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
          };
          const activeKey = periods.find(p => dateFrom === periodFromKey(p) && dateTo === todayISO())?.k;
          return (
            <div style={{ marginBottom:10 }}>
              <SegmentedControl
                value={activeKey || ""}
                onChange={(k) => {
                  const p = periods.find(x => x.k === k);
                  if (!p) return;
                  setDateFrom(periodFromKey(p));
                  setDateTo(todayISO());
                }}
                ariaLabel={t("expediente.period")}
                items={periods.map(p => ({ k: p.k, l: p.l }))}
              />
            </div>
          );
        })()}
        {(() => {
          const fTutor = filteredSessions.filter(s => isTutorSession(s)).length;
          const showTutor = !!patient.parent && fTutor > 0;
          const tileStyle = { cursor:"pointer", WebkitTapHighlightColor:"transparent", borderRadius:"var(--radius)", padding:"8px 6px", textAlign:"center", border:"none", fontFamily:"inherit", width:"100%", minHeight:0 };
          const valStyle = { fontFamily:"var(--font-d)", fontSize:"var(--text-xl)", fontWeight:800 };
          const labelStyle = { fontSize:"var(--text-eyebrow)", color:"var(--charcoal-xl)", marginTop:1 };
          return (
          <div style={{ display:"grid", gridTemplateColumns: showTutor ? "1fr 1fr" : "1fr 1fr 1fr", gap:8 }}>
            <button type="button" onClick={() => onGoToSesiones("all")}
              style={{ ...tileStyle, background:"var(--cream)" }}>
              <div style={{ ...valStyle, color:"var(--charcoal)" }}>{fTotal}</div>
              <div style={labelStyle}>{t("expediente.programmed")}</div>
            </button>
            <button type="button" onClick={() => onGoToSesiones("completed")}
              style={{ ...tileStyle, background:"var(--green-bg)" }}>
              <div style={{ ...valStyle, color:"var(--green)" }}>{fCompleted}</div>
              <div style={labelStyle}>{t("expediente.attended")}</div>
            </button>
            <button type="button" onClick={() => onGoToSesiones("cancelled_any")}
              style={{ ...tileStyle, background:"var(--red-bg)" }}>
              <div style={{ ...valStyle, color:"var(--red)" }}>{fCancelledTotal}</div>
              <div style={labelStyle}>{t("expediente.cancelled")}</div>
            </button>
            {showTutor && (
              <button type="button" onClick={() => onGoToSesiones("all", "tutor")}
                style={{ ...tileStyle, background:"var(--purple-bg)" }}>
                <div style={{ ...valStyle, color:"var(--purple)" }}>{fTutor}</div>
                <div style={labelStyle}>{t("sessions.tutor")}</div>
              </button>
            )}
          </div>);
        })()}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
        <button className="btn btn-teal" onClick={() => onRecordPayment(patient)} disabled={mutating}>
          {t("fab.payment")}
        </button>
        <button className="btn btn-teal-soft" onClick={onGoToArchivo}>
          {t("expediente.archivo")}
        </button>
      </div>
    </div>
  );
}
