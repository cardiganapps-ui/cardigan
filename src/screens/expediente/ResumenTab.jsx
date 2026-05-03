import { useMemo, useState } from "react";
import { shortDateToISO, todayISO } from "../../utils/dates";
import { isTutorSession, getLastTutorSession, getNextTutorSession } from "../../utils/sessions";
import { SegmentedControl } from "../../components/SegmentedControl";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { SetWeeklySlotSheet } from "../../components/sheets/SetWeeklySlotSheet";
import { DAY_ORDER } from "../../data/seedData";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import { usesAnthropometrics, isEpisodic, SCHEDULING_MODE } from "../../data/constants";
import { formatMXN, formatDate } from "../../utils/format";

// ── Date helpers ──
// Display format used across the Resumen card. Spanish locale renders
// the short month lowercase ("nov"), so we capitalize the first letter
// to match how the rest of the app shows dates ("14 Nov 2015").
function capitalizeMonth(str) {
  // Match "<day> <mon>..." and uppercase the first letter of the
  // month token, wherever it falls after the day number.
  return str.replace(/(\d+\s+)([a-záéíóúñ])/iu, (_, pre, first) => pre + first.toUpperCase());
}
function formatISODateLong(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return capitalizeMonth(
    formatDate(y, m - 1, d, "shortYear")
  );
}

// Derive the patient's active recurring schedule(s) from their
// non-cancelled sessions. Returns an array of { day, time } pairs sorted
// Monday→Sunday, time ascending, deduped. Prefers future sessions; falls
// back to all sessions for ended patients so the historical schedule
// still shows on the expediente.
//
// Manual one-offs (`is_recurring=false`) are excluded — the Horarios
// row in the Resumen is meant to reflect ONLY the patient's configured
// recurring schedule, not any extra appointments scheduled via the
// FAB. Same `=== false` form as computeAutoExtendRows so legacy rows
// without the column still appear.
/* Derive the recurring schedule from session rows.

   Source of truth: `is_recurring=true`. Sessions get this flag set
   ONLY when created from the patient profile flow — initial
   createPatient, applyScheduleChange, or auto-extend off an
   already-recurring slot. The "+ session" FAB writes
   is_recurring=false. Legacy one-offs were corrected by migration
   028 (uses slot-count signal: any ≤3-session slot on a patient
   with a real ≥10-session slot elsewhere is a one-off). */
function derivePatientSchedules(sessions, patientId, includePast) {
  const today = todayISO();
  const seen = new Set();
  const result = [];
  for (const s of sessions) {
    if (s.patient_id !== patientId) continue;
    if (s.status === "cancelled" || s.status === "charged") continue;
    if (s.is_recurring !== true) continue;
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
  const { profession, measurements, updatePatient, showSuccess, openQuickSchedule, readOnly } = useCardigan();
  const patientIsEpisodic = isEpisodic(patient);
  const [confirmModeChange, setConfirmModeChange] = useState(false);
  const [modeChangeBusy, setModeChangeBusy] = useState(false);
  const [setSlotOpen, setSetSlotOpen] = useState(false);
  const showHealthBlock = usesAnthropometrics(profession);
  // Patient's measurements newest-first. The Resumen card uses the
  // top two entries to render an "Última medición" block — current
  // values + Δ vs. the prior visit, no need to open the tab.
  const patientMeasurements = useMemo(() => {
    if (!showHealthBlock) return [];
    return (measurements || [])
      .filter((m) => m.patient_id === patient.id)
      .slice()
      .sort((a, b) => {
        if (a.taken_at !== b.taken_at) return a.taken_at < b.taken_at ? 1 : -1;
        return (b.created_at || "").localeCompare(a.created_at || "");
      });
  }, [measurements, patient.id, showHealthBlock]);
  const latestMeasurement = patientMeasurements[0] || null;
  const previousMeasurement = patientMeasurements[1] || null;
  // Detect whether the latest scan carries InBody-richer fields.
  // When it does we render a 4-tile body-comp grid; when it's a
  // plain manual weigh-in we fall back to the simple weight row.
  const hasInBodyDetail = !!(
    latestMeasurement && (
      latestMeasurement.skeletal_muscle_kg != null ||
      latestMeasurement.body_fat_pct != null ||
      latestMeasurement.visceral_fat_level != null ||
      latestMeasurement.inbody_score != null
    )
  );
  const latestWeight = latestMeasurement && latestMeasurement.weight_kg != null
    ? latestMeasurement
    : null;

  /* Counters split by status × tutor flag.
     - "Settled" sessions only — completed | cancelled | charged. Past
       rows that are still status='scheduled' (the prime directive
       says these render as completed but the DB row stays scheduled)
       AND any future row are excluded. fTotal is the sum of the
       three settled buckets so the breakdown always reconciles
       visually with the headline.
     - Tutor sessions split out into fTutor — they're with the
       parent, not the patient, so they don't belong in the patient-
       attendance ratio. attendancePct = fCompleted / fTotal, both
       clean of tutor.
     - fCancelled / fCharged split the old fCancelledTotal so the UI
       can show "money lost" vs "money kept" separately. */
  const { fTotal, fCompleted, fCancelled, fCharged, fTutor, attendancePct } = useMemo(() => {
    let completed = 0, cancelled = 0, charged = 0, tutor = 0;
    for (const s of filteredSessions) {
      if (isTutorSession(s)) { tutor++; continue; }
      if (s.status === "completed") completed++;
      else if (s.status === "cancelled") cancelled++;
      else if (s.status === "charged") charged++;
    }
    const total = completed + cancelled + charged;
    return {
      fTotal: total,
      fCompleted: completed,
      fCancelled: cancelled,
      fCharged: charged,
      fTutor: tutor,
      attendancePct: total > 0 ? Math.round((completed / total) * 100) : null,
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

  /* Episodic-mode helpers — used only when scheduling_mode === 'episodic'
     to surface "Próxima consulta" + "Última consulta" rows on the patient
     info card. We derive these from upcomingSessions (the same row set
     the rest of the card already reads) so the data is always in sync
     with the calendar. Cancelled / charged sessions are excluded — they
     read as "didn't happen" in the same way the recurring schedule
     filter does. */
  const nextEpisodicSession = useMemo(() => {
    if (!patientIsEpisodic) return null;
    const today = todayISO();
    let bestIso = null;
    let bestRow = null;
    for (const s of (upcomingSessions || [])) {
      if (s.patient_id !== patient.id) continue;
      if (s.status === "cancelled" || s.status === "charged") continue;
      const iso = shortDateToISO(s.date);
      if (iso < today) continue;
      // Prefer earliest future date; tiebreak by time so the Resumen
      // shows the patient's literal next appointment.
      if (!bestIso || iso < bestIso || (iso === bestIso && (s.time || "") < (bestRow?.time || ""))) {
        bestIso = iso;
        bestRow = s;
      }
    }
    return bestRow;
  }, [upcomingSessions, patient.id, patientIsEpisodic]);

  const lastEpisodicSession = useMemo(() => {
    if (!patientIsEpisodic) return null;
    const today = todayISO();
    let bestIso = null;
    let bestRow = null;
    for (const s of (upcomingSessions || [])) {
      if (s.patient_id !== patient.id) continue;
      if (s.status === "cancelled" || s.status === "charged") continue;
      const iso = shortDateToISO(s.date);
      if (iso > today) continue;
      if (!bestIso || iso > bestIso || (iso === bestIso && (s.time || "") > (bestRow?.time || ""))) {
        bestIso = iso;
        bestRow = s;
      }
    }
    return bestRow;
  }, [upcomingSessions, patient.id, patientIsEpisodic]);

  /* Mode-switch handler. v1 supports recurring → episodic only; the
     opposite direction needs a slot picker which is a bigger UX problem
     (when does the recurrence start? what duration / modality?) and
     gets its own follow-on. The transition keeps existing future
     sessions in place — they'll appear on the calendar but auto-extend
     stops adding more, so the patient's current bookings aren't
     surprise-deleted. */
  const handleSwitchToEpisodic = async () => {
    setModeChangeBusy(true);
    try {
      const ok = await updatePatient(patient.id, {
        scheduling_mode: SCHEDULING_MODE.EPISODIC,
        day:  null,
        time: null,
      });
      if (ok) {
        showSuccess?.(t("scheduling.modeChanged"));
        setConfirmModeChange(false);
      }
    } finally {
      setModeChangeBusy(false);
    }
  };

  return (
    <div style={{ padding:"16px" }}>
      {/* General info */}
      <div className="card" style={{ padding:0, marginBottom:10 }}>
        {(() => {
          const scheduleValue = schedules.length === 0
            ? t("patients.notRecurring") || "Sin recurrencia"
            : schedules.map(s => `${s.day} · ${s.time}`).join("\n");
          const birthdateValue = patient.birthdate ? (() => {
            const birth = new Date(patient.birthdate + "T00:00:00");
            const today = new Date();
            let age = today.getFullYear() - birth.getFullYear();
            const m = today.getMonth() - birth.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
            const formatted = capitalizeMonth(
              formatDate(birth, "shortYear")
            );
            return `${formatted} (${age} ${t("patients.yearsOld")})`;
          })() : null;
          // Episodic patients have no perpetual slot — replace the
          // "Horarios" row with two rows that match how they actually
          // think about scheduling: the next concrete appointment +
          // the last visit. The "Próxima consulta" row degrades to a
          // "[Programar próxima]" CTA when nothing future is on the
          // calendar — the most common state right after marking a
          // consult complete.
          const scheduleRows = patientIsEpisodic
            ? [
                {
                  label: t("scheduling.nextConsult"),
                  // node renders a button when there's no upcoming
                  // session; otherwise a plain date+time string.
                  node: nextEpisodicSession ? (
                    <span>{nextEpisodicSession.date} · {nextEpisodicSession.time}</span>
                  ) : readOnly ? (
                    // Read-only mode (demo / admin view-as) — show the
                    // "no agenda" state but skip the CTA; the underlying
                    // createSession is a no-op and the user would just
                    // get a confusing "no pudimos agendar" toast.
                    <span style={{ color: "var(--charcoal-xl)" }}>{t("scheduling.noneScheduled")}</span>
                  ) : (
                    <button
                      type="button"
                      className="chip-pill"
                      onClick={() => openQuickSchedule?.(patient)}
                      style={{
                        background:"var(--teal-pale)",
                        color:"var(--teal-dark)",
                        border:"none",
                        borderRadius:"var(--radius-pill)",
                        padding:"4px 10px",
                        fontSize:"var(--text-xs)",
                        fontWeight:700,
                        cursor:"pointer",
                        fontFamily:"inherit",
                        WebkitTapHighlightColor:"transparent",
                      }}>
                      {t("scheduling.scheduleNext")}
                    </button>
                  ),
                },
                {
                  label: t("scheduling.lastConsult"),
                  value: lastEpisodicSession
                    ? `${lastEpisodicSession.date} · ${lastEpisodicSession.time}`
                    : "—",
                },
              ]
            : [
                { label: t("expediente.scheduleRow"), value: scheduleValue, multiline: schedules.length > 1 },
              ];
          const rows = [
            ...scheduleRows,
            { label: t("patients.rate"), value:`$${patient.rate} ${t("expediente.perSession")}` },
            ...(patient.parent ? [{ label: t("sessions.tutor"), value: patient.parent }] : []),
            ...(patient.tutor_frequency ? [{ label: t("expediente.tutorSessionsRow"), value: t("patients.everyNWeeks", { count: patient.tutor_frequency }) }] : []),
            ...(patient.start_date ? [{ label: t("patients.startDate"), value: formatISODateLong(patient.start_date) }] : []),
            ...(isEnded && lastSessionDate ? [{ label: t("patients.endDate"), value: formatISODateLong(lastSessionDate) }] : []),
            ...(birthdateValue ? [{ label: t("patients.birthdate"), value: birthdateValue }] : []),
          ];
          return (
            <>
              {rows.map((row, i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems: row.multiline ? "flex-start" : "center", minHeight:42, padding:"10px 16px", borderBottom: i < rows.length - 1 ? "1px solid var(--border-lt)" : "none", gap:12 }}>
                  <span style={{ fontSize:"var(--text-sm)", lineHeight:1.25, color:"var(--charcoal-xl)" }}>{row.label}</span>
                  <span style={{ fontSize:"var(--text-sm)", lineHeight:1.35, fontWeight:600, color:"var(--charcoal)", textAlign:"right", whiteSpace:"pre-line" }}>
                    {row.node || row.value}
                  </span>
                </div>
              ))}
            </>
          );
        })()}
      </div>

      {/* Última medición — shown when the latest entry has InBody
          fields. Surfaces 4 key numbers as tappable-feeling tiles
          (weight, body fat %, muscle, date), each with the Δ vs. the
          previous visit so the practitioner sees direction at a
          glance. Falls back to nothing when the latest entry is a
          plain manual weigh-in (the simpler "Peso" row inside the
          Salud block below covers that case). */}
      {showHealthBlock && hasInBodyDetail && latestMeasurement && (() => {
        const renderDelta = (curKey) => {
          if (!previousMeasurement) return null;
          const a = latestMeasurement[curKey];
          const b = previousMeasurement[curKey];
          if (a == null || b == null) return null;
          const diff = Number(a) - Number(b);
          const sign = diff > 0 ? "+" : "";
          return `${sign}${Number(diff).toFixed(1).replace(/\.0$/, "")}`;
        };
        const fmt = (n, d = 1) => n == null ? "—" : Number(n).toFixed(d).replace(/\.0$/, "");
        const tiles = [
          { label: t("measurements.metric.weight"),  value: latestMeasurement.weight_kg != null
              ? `${fmt(latestMeasurement.weight_kg)} kg` : "—",
            delta: renderDelta("weight_kg") },
          { label: t("measurements.metric.bodyFat"), value: latestMeasurement.body_fat_pct != null
              ? `${fmt(latestMeasurement.body_fat_pct)}%` : "—",
            delta: renderDelta("body_fat_pct") },
          { label: t("measurements.metric.muscle"),  value: latestMeasurement.skeletal_muscle_kg != null
              ? `${fmt(latestMeasurement.skeletal_muscle_kg)} kg` : "—",
            delta: renderDelta("skeletal_muscle_kg") },
          { label: t("measurements.lastScanLabel"),
            value: formatISODateLong(latestMeasurement.taken_at),
            delta: null },
        ];
        return (
          <>
            <div style={{ ...SECTION_LABEL_STYLE, padding: "0 4px 6px" }}>
              {t("measurements.lastScanTitle")}
            </div>
            <div className="card resumen-bodycomp" style={{ padding: 10, marginBottom: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {tiles.map((tile, i) => (
                  <div key={i} style={{
                    background: "var(--cream)",
                    borderRadius: "var(--radius)",
                    padding: "8px 10px",
                    minWidth: 0,
                  }}>
                    <div style={{
                      fontSize: "var(--text-eyebrow)",
                      color: "var(--charcoal-xl)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      fontWeight: 700,
                      marginBottom: 2,
                    }}>{tile.label}</div>
                    <div style={{
                      fontFamily: "var(--font-d)",
                      fontSize: "var(--text-lg)",
                      fontWeight: 800,
                      color: "var(--charcoal)",
                      lineHeight: 1.1,
                      fontVariantNumeric: "tabular-nums",
                    }}>{tile.value}</div>
                    {tile.delta && (
                      <div style={{
                        fontSize: "var(--text-eyebrow)",
                        color: "var(--charcoal-xl)",
                        fontWeight: 700,
                        fontVariantNumeric: "tabular-nums",
                        marginTop: 1,
                      }}>{tile.delta}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        );
      })()}

      {/* Salud / Anthropometric block — nutritionist + trainer only.
          Shows the static patient-level traits (height, goal weight,
          allergies, medical conditions) plus the most recent measured
          weight from the measurements log. Hidden completely when the
          profession doesn't use it. */}
      {showHealthBlock && (() => {
        const rows = [];
        // Skip the duplicate "Peso" row when the InBody tile grid
        // above already surfaces the latest weight + Δ.
        if (latestWeight && latestWeight.weight_kg != null && !hasInBodyDetail) {
          rows.push({
            label: t("measurements.fields.weight"),
            value: `${Number(latestWeight.weight_kg).toFixed(1).replace(/\.0$/, "")} kg`,
          });
        }
        if (patient.height_cm) {
          rows.push({ label: t("patientFields.height"), value: `${patient.height_cm} cm` });
        }
        if (patient.goal_weight_kg) {
          rows.push({
            label: t("patientFields.goalWeight"),
            value: `${Number(patient.goal_weight_kg).toFixed(1).replace(/\.0$/, "")} kg`,
          });
        }
        if (patient.allergies) {
          rows.push({ label: t("patientFields.allergies"), value: patient.allergies, multiline: true });
        }
        if (patient.medical_conditions) {
          rows.push({ label: t("patientFields.medicalConditions"), value: patient.medical_conditions, multiline: true });
        }
        if (rows.length === 0) return null;
        return (
          <>
            <div style={{ fontSize: "var(--text-eyebrow)", color: "var(--charcoal-xl)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, padding: "0 4px 6px" }}>
              {t("patientFields.sectionTitle")}
            </div>
            <div className="card" style={{ padding: 0, marginBottom: 10 }}>
              {rows.map((r, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: r.multiline ? "flex-start" : "center",
                  justifyContent: "space-between", padding: "10px 12px",
                  borderTop: i === 0 ? "none" : "1px solid var(--border-lt)", gap: 12,
                }}>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--charcoal-md)", flexShrink: 0 }}>{r.label}</div>
                  <div style={{
                    fontSize: "var(--text-sm)", color: "var(--charcoal)", fontWeight: 600,
                    textAlign: "right", whiteSpace: r.multiline ? "pre-wrap" : "nowrap",
                  }}>{r.value}</div>
                </div>
              ))}
            </div>
          </>
        );
      })()}

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
          <div className="stat-tile-val" style={{ color:"var(--green)", fontSize:"var(--text-xl)" }}>{formatMXN(patient.paid)}</div>
        </div>
        <div className="stat-tile" style={{ textAlign:"center" }}>
          {/* When a patient has overpaid (credit > 0), the tile flips
              from "No Cobrado $0" (which read as "nothing owed, nothing
              special") to "Saldo a favor +$X" so you can tell at a
              glance they've prepaid future sessions. The main status
              badge still reads "Al corriente" — credit is an
              additional signal, not a different category. */}
          {patient.credit > 0 ? (
            <>
              <div className="stat-tile-label">{t("finances.credit")}</div>
              <div className="stat-tile-val" style={{ color:"var(--green)", fontSize:"var(--text-xl)" }}>+{formatMXN(patient.credit)}</div>
            </>
          ) : (
            <>
              <div className="stat-tile-label">{t("finances.balance")}</div>
              <div className="stat-tile-val" style={{ color: patient.amountDue > 0 ? "var(--red)" : "var(--green)", fontSize:"var(--text-xl)" }}>{formatMXN(patient.amountDue)}</div>
            </>
          )}
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
          const showTutor = !!patient.parent && fTutor > 0;
          const tileStyle = { cursor:"pointer", WebkitTapHighlightColor:"transparent", borderRadius:"var(--radius)", padding:"8px 6px", textAlign:"center", border:"none", fontFamily:"inherit", width:"100%", minHeight:0 };
          const tileStyleSmall = { ...tileStyle, padding:"6px 6px" };
          const valStyle = { fontFamily:"var(--font-d)", fontSize:"var(--text-xl)", fontWeight:800 };
          const valStyleSmall = { ...valStyle, fontSize:"var(--text-lg)" };
          const labelStyle = { fontSize:"var(--text-eyebrow)", color:"var(--charcoal-xl)", marginTop:1 };
          return (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {/* Headline row — Programadas + Asistió, full size. The %
                below Asistió is the patient-attendance rate
                (fCompleted / fTotal). Tutor sessions are excluded
                from the numerator since they're with the parent. */}
            <button type="button" onClick={() => onGoToSesiones("all")}
              style={{ ...tileStyle, background:"var(--cream)" }}>
              <div style={{ ...valStyle, color:"var(--charcoal)" }}>{fTotal}</div>
              <div style={labelStyle}>{t("expediente.programmed")}</div>
            </button>
            <button type="button" onClick={() => onGoToSesiones("completed")}
              style={{ ...tileStyle, background:"var(--green-bg)" }}>
              <div style={{ ...valStyle, color:"var(--green)" }}>{fCompleted}</div>
              {attendancePct != null && (
                <div style={{ fontSize:"var(--text-eyebrow)", color:"var(--green)", fontWeight:700 }}>
                  {attendancePct}%
                </div>
              )}
              <div style={labelStyle}>{t("expediente.attended")}</div>
            </button>
            {/* Cancelled split — two smaller tiles. "Cobradas" =
                charge-on-cancel (the slot was billed); "No cobradas"
                = cancellation with no charge. Both route to the
                cancelled list; the user can scan from there. */}
            <button type="button" onClick={() => onGoToSesiones("cancelled_any")}
              style={{ ...tileStyleSmall, background:"var(--red-bg)" }}>
              <div style={{ ...valStyleSmall, color:"var(--red)" }}>{fCancelled}</div>
              <div style={labelStyle}>{t("expediente.cancelledUncharged")}</div>
            </button>
            <button type="button" onClick={() => onGoToSesiones("cancelled_any")}
              style={{ ...tileStyleSmall, background:"var(--amber-bg)" }}>
              <div style={{ ...valStyleSmall, color:"var(--amber)" }}>{fCharged}</div>
              <div style={labelStyle}>{t("expediente.cancelledCharged")}</div>
            </button>
            {showTutor && (
              <button type="button" onClick={() => onGoToSesiones("all", { tutorOnly: true })}
                style={{ ...tileStyleSmall, background:"var(--purple-bg)", gridColumn:"1 / -1" }}>
                <div style={{ ...valStyleSmall, color:"var(--purple)" }}>{fTutor}</div>
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

      {/* Mode-switch link — works in both directions. R→E flips
          scheduling_mode + clears day/time (existing future rows
          stay; auto-extend stops adding more). E→R opens a slot
          picker that seeds a fresh weekly schedule. Hidden for
          ended patients (neither direction is meaningful for a
          closed engagement) and in read-only mode (the underlying
          updatePatient is a no-op so the toggle would confuse). */}
      {!isEnded && !readOnly && (
        <div style={{ marginTop:14, textAlign:"center" }}>
          <button
            type="button"
            onClick={() => patientIsEpisodic ? setSetSlotOpen(true) : setConfirmModeChange(true)}
            disabled={mutating}
            style={{
              background:"none",
              border:"none",
              color:"var(--charcoal-xl)",
              fontSize:"var(--text-xs)",
              fontWeight:600,
              cursor:"pointer",
              fontFamily:"inherit",
              padding:"6px 10px",
              textDecoration:"underline",
              textDecorationColor:"var(--border)",
              textUnderlineOffset:"2px",
            }}>
            {patientIsEpisodic ? t("scheduling.switchToRecurring") : t("scheduling.switchToEpisodic")}
          </button>
        </div>
      )}

      {setSlotOpen && (
        <SetWeeklySlotSheet
          patient={patient}
          onClose={() => setSetSlotOpen(false)}
        />
      )}

      <ConfirmDialog
        open={confirmModeChange}
        title={t("scheduling.switchToEpisodicTitle")}
        body={t("scheduling.switchToEpisodicBody")}
        confirmLabel={t("scheduling.switchToEpisodicConfirm")}
        cancelLabel={t("cancel")}
        busy={modeChangeBusy}
        onConfirm={handleSwitchToEpisodic}
        onCancel={() => setConfirmModeChange(false)}
      />
    </div>
  );
}
