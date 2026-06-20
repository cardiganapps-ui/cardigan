import { useState, useMemo } from "react";
import { getClientColor } from "../../data/seedData";
import { IconTrendingUp } from "../../components/Icons";
import { shortDateToISO, todayISO } from "../../utils/dates";
import { formatMXN } from "../../utils/format";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Avatar } from "../../components/Avatar";
import { AnimatedNumber } from "../../components/AnimatedNumber";
import { useT } from "../../i18n/index";
import { isPotentialOrDiscarded, SESSION_TYPE } from "../../data/constants";

const PERIOD_DAYS = { "1w": 7, "1m": 30, "3m": 90 };

export function ProyeccionTab({ sessions, patients }) {
  const { t } = useT();
  const [period, setPeriod] = useState("1m");
  const [customCancel, setCustomCancel] = useState(null); // null = use historical

  const today = todayISO();

  // Compute the cutoff date for the selected period (fixed day counts)
  const cutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + (PERIOD_DAYS[period] || 30));
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }, [period]);

  // Patients whose sessions count toward the active-revenue forecast.
  // Potentials and discarded leads are excluded — projecting "what will
  // I earn next month" must not bake in interview revenue from leads
  // who haven't converted yet (and whose interview sessions, even
  // future ones, are one-off rose-rail rows we deliberately styled
  // separately).
  const projectablePatientIds = useMemo(() => {
    const ids = new Set();
    for (const p of patients) if (!isPotentialOrDiscarded(p)) ids.add(p.id);
    return ids;
  }, [patients]);

  // Scheduled sessions within the projection period (today through cutoff)
  const futureSessions = useMemo(() =>
    sessions.filter(s => {
      if (s.status !== "scheduled") return false;
      // Interview sessions are one-offs by design and don't represent
      // recurring revenue; even on a converted patient they stay at
      // their original tariff and shouldn't contribute to the next
      // period's forecast. Excluding them upstream also keeps
      // activeContributing honest.
      if (s.session_type === SESSION_TYPE.INTERVIEW) return false;
      // Don't project sessions belonging to potentials/discarded — see
      // projectablePatientIds above.
      if (s.patient_id && !projectablePatientIds.has(s.patient_id)) return false;
      const iso = shortDateToISO(s.date);
      return iso >= today && iso <= cutoff;
    }),
    [sessions, today, cutoff, projectablePatientIds]
  );

  // Historical cancellation rate (cancelled without charge / total resolved)
  const { histRate, totalResolved, totalCancelled } = useMemo(() => {
    let resolved = 0, cancelled = 0;
    for (const s of sessions) {
      const iso = shortDateToISO(s.date);
      if (iso >= today) continue; // only past sessions
      if (s.status === "completed" || s.status === "charged") resolved++;
      else if (s.status === "cancelled") { resolved++; cancelled++; }
    }
    return {
      histRate: resolved > 0 ? cancelled / resolved : 0,
      totalResolved: resolved,
      totalCancelled: cancelled,
    };
  }, [sessions, today]);

  // Resolve the effective rate for a session: use session.rate if set,
  // otherwise fall back to the patient's current rate (handles legacy
  // sessions created before rate was tracked per-session).
  const patientMap = useMemo(() => {
    const m = new Map();
    for (const p of patients) m.set(p.id, p);
    return m;
  }, [patients]);
  const sessionRate = (s) => {
    if (s.rate != null && s.rate > 0) return s.rate;
    const p = patientMap.get(s.patient_id);
    return p ? p.rate : 0;
  };

  const cancelRate = customCancel !== null ? customCancel / 100 : histRate;

  // Gross and net
  const gross = futureSessions.reduce((sum, s) => sum + sessionRate(s), 0);
  const net = Math.round(gross * (1 - cancelRate));

  // Weeks in period for weekly average (matches fixed day counts: 7, 30, 90)
  const weeksInPeriod = (PERIOD_DAYS[period] || 30) / 7;
  const perWeek = weeksInPeriod > 0 ? Math.round(net / weeksInPeriod) : 0;

  // Average session rate
  const avgRate = futureSessions.length > 0
    ? Math.round(gross / futureSessions.length)
    : 0;

  // Breakdown by patient (plain computation — trivial cost, always fresh)
  const byPatientMap = {};
  for (const s of futureSessions) {
    const rate = sessionRate(s);
    if (!byPatientMap[s.patient]) byPatientMap[s.patient] = { count: 0, total: 0, colorIdx: s.colorIdx ?? s.color_idx, initials: s.initials };
    byPatientMap[s.patient].count++;
    byPatientMap[s.patient].total += rate;
  }
  const byPatient = Object.entries(byPatientMap)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.total - a.total);

  // Active patients contributing
  const activeContributing = new Set(futureSessions.map(s => s.patient_id)).size;

  const histPct = Math.round(histRate * 100);
  const displayPct = customCancel !== null ? customCancel : histPct;

  return (
    <div style={{ padding:"0 16px" }}>
      <div style={{ marginBottom:14 }}>
        <SegmentedControl
          value={period}
          onChange={setPeriod}
          items={[
            { k: "1w", l: t("periods.1w") },
            { k: "1m", l: t("periods.1m") },
            { k: "3m", l: t("periods.3m") },
          ]}
        />
      </div>

      {/* Main projection cards */}
      <div className="fin-stats-grid" style={{ padding:0, marginBottom:16 }}>
        <div className="stat-tile">
          <div className="stat-tile-label">{t("finances.forecastGross")}</div>
          <div className="stat-tile-val"><AnimatedNumber value={gross} format={formatMXN} /></div>
          <div className="stat-tile-sub">{t("finances.forecastScheduled", { count: futureSessions.length, plural: futureSessions.length !== 1 ? "es" : "" })}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-label">{t("finances.forecastNet")}</div>
          <div className="stat-tile-val" style={{ color:"var(--green)" }}><AnimatedNumber value={net} format={formatMXN} /></div>
          <div className="stat-tile-sub">-{Math.round(cancelRate * 100)}% {t("finances.forecastCancelRateLower")}</div>
        </div>
      </div>

      <div className="fin-stats-grid" style={{ padding:0, marginBottom:16 }}>
        <div className="stat-tile">
          <div className="stat-tile-label">{t("finances.forecastPerWeek")}</div>
          <div className="stat-tile-val"><AnimatedNumber value={perWeek} format={formatMXN} /></div>
          <div className="stat-tile-sub">{t("finances.forecastActivePatients", { count: activeContributing, plural: activeContributing !== 1 ? "s" : "" })}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-label">{t("finances.forecastAvgSession")}</div>
          <div className="stat-tile-val"><AnimatedNumber value={avgRate} format={formatMXN} /></div>
          <div className="stat-tile-sub">{t("expediente.perSession")}</div>
        </div>
      </div>

      {/* Cancellation rate adjustment */}
      <div className="card" style={{ padding:"16px 18px", marginBottom:16 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
          <span style={{ fontSize:"var(--text-sm)", fontWeight:700, color:"var(--charcoal)" }}>{t("finances.forecastAssumption")}</span>
          <span style={{ fontFamily:"var(--font-d)", fontSize:"var(--text-md)", fontWeight:800, color:"var(--charcoal)" }}>{displayPct}%</span>
        </div>
        <input
          type="range"
          min={0} max={50} step={1}
          value={displayPct}
          onChange={e => setCustomCancel(Number(e.target.value))}
          aria-label={t("finances.forecastAssumption")}
          aria-valuemin={0} aria-valuemax={50} aria-valuenow={displayPct}
          aria-valuetext={`${displayPct}%`}
          style={{ width:"100%", accentColor:"var(--teal)", marginBottom:8 }}
        />
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:"var(--text-xs)", color:"var(--charcoal-xl)" }}>
            {t("finances.forecastHistorical")}: <strong>{histPct}%</strong>
            <span style={{ fontWeight:400 }}> ({totalCancelled}/{totalResolved})</span>
          </span>
          {customCancel !== null && customCancel !== histPct && (
            <button
              className="btn btn-ghost"
              style={{ fontSize:"var(--text-xs)", padding:"2px 10px", height:"auto", minHeight:0 }}
              onClick={() => setCustomCancel(null)}
            >
              {t("finances.useHistorical")}
            </button>
          )}
        </div>
      </div>

      {/* Breakdown by patient */}
      {byPatient.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <div className="section-title" style={{ marginBottom:10 }}>{t("finances.forecastByPatient")}</div>
          <div className="card">
            {byPatient.map((p, i) => {
              const patObj = patients.find(pt => pt.name === p.name);
              const initials = patObj ? patObj.initials : p.initials?.replace("T·", "") || p.name.slice(0,2).toUpperCase();
              return (
                <div className="bal-row" key={p.name}>
                  <Avatar initials={initials} color={getClientColor(p.colorIdx ?? i)} size="sm" />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div className="bal-name">{p.name}</div>
                    <div className="bal-sub">{t("finances.sessionCount", { count: p.count, plural: p.count !== 1 ? "es" : "" })}</div>
                  </div>
                  <div className="bal-amt" style={{ color:"var(--charcoal)", fontWeight:700 }}>{formatMXN(p.total)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {futureSessions.length === 0 && (
        <div className="card" style={{ padding:32, textAlign:"center" }}>
          <div style={{ marginBottom:10, color:"var(--teal-light)" }}><IconTrendingUp size={32} /></div>
          <div style={{ fontSize:"var(--text-sm)", color:"var(--charcoal-xl)" }}>{t("finances.forecastNoSessions")}</div>
        </div>
      )}
    </div>
  );
}
