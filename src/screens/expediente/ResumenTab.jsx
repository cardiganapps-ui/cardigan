import { useMemo } from "react";
import { shortDateToISO, todayISO } from "../../utils/dates";
import { isTutorSession, getLastTutorSession, getNextTutorSession } from "../../utils/sessions";
import { SegmentedControl } from "../../components/SegmentedControl";
import { useT } from "../../i18n/index";

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
  fVendido, fCobrado,
  onRecordPayment, onGoToSesiones, onGoToArchivo, mutating,
}) {
  const { t } = useT();

  const fTotal = filteredSessions.length;
  const fCompleted = filteredSessions.filter(s => s.status === "completed").length;
  const fCancelled = filteredSessions.filter(s => s.status === "cancelled").length;
  const fCharged = filteredSessions.filter(s => s.status === "charged").length;
  const fPeriodSaldo = fVendido - fCobrado;

  return (
    <div style={{ padding:"16px" }}>
      {/* General info */}
      <div className="card" style={{ padding:0, marginBottom:10 }}>
        {(() => {
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
            ...(patient.parent ? [{ label: t("sessions.tutor"), value: patient.parent }] : []),
            ...(patient.tutor_frequency ? [{ label: t("expediente.tutorFrequencyRow"), value: t("patients.everyNWeeks", { count: patient.tutor_frequency }) }] : []),
          ];
          return (
            <>
              {rows.map((row, i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", minHeight:42, padding:"10px 16px", borderBottom: i < rows.length - 1 ? "1px solid var(--border-lt)" : "none" }}>
                  <span style={{ fontSize:"var(--text-sm)", lineHeight:1.25, color:"var(--charcoal-xl)" }}>{row.label}</span>
                  <span style={{ fontSize:"var(--text-sm)", lineHeight:1.25, fontWeight:600, color:"var(--charcoal)" }}>{row.value}</span>
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
          const tileStyle = { cursor:"pointer", WebkitTapHighlightColor:"transparent", borderRadius:"var(--radius)", padding:"8px 6px", textAlign:"center" };
          const valStyle = { fontFamily:"var(--font-d)", fontSize:"var(--text-xl)", fontWeight:800 };
          const labelStyle = { fontSize:"var(--text-eyebrow)", color:"var(--charcoal-xl)", marginTop:1 };
          return (
          <div style={{ display:"grid", gridTemplateColumns: showTutor ? "1fr 1fr" : "1fr 1fr 1fr", gap:8 }}>
            <div role="button" tabIndex={0} onClick={() => onGoToSesiones("all")}
              style={{ ...tileStyle, background:"var(--cream)" }}>
              <div style={{ ...valStyle, color:"var(--charcoal)" }}>{fTotal}</div>
              <div style={labelStyle}>{t("expediente.programmed")}</div>
            </div>
            <div role="button" tabIndex={0} onClick={() => onGoToSesiones("completed")}
              style={{ ...tileStyle, background:"var(--green-bg)" }}>
              <div style={{ ...valStyle, color:"var(--green)" }}>{fCompleted}</div>
              <div style={labelStyle}>{t("expediente.attended")}</div>
            </div>
            <div role="button" tabIndex={0} onClick={() => onGoToSesiones("cancelled_any")}
              style={{ ...tileStyle, background:"var(--red-bg)" }}>
              <div style={{ ...valStyle, color:"var(--red)" }}>{fCancelled + fCharged}</div>
              <div style={labelStyle}>{t("expediente.cancelled")}</div>
            </div>
            {showTutor && (
              <div role="button" tabIndex={0} onClick={() => onGoToSesiones("all", "tutor")}
                style={{ ...tileStyle, background:"var(--purple-bg)" }}>
                <div style={{ ...valStyle, color:"var(--purple)" }}>{fTutor}</div>
                <div style={labelStyle}>{t("sessions.tutor")}</div>
              </div>
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
