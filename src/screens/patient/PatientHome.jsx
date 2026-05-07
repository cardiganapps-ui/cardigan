import { useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import { shortDateToISO, formatShortDateWithYear } from "../../utils/dates";
import { formatMXN } from "../../utils/format";
import { classifySessions } from "../../hooks/usePatientPortalData";
import { IconCalendar, IconDollar, IconCheck, IconMail } from "../../components/Icons";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { haptic } from "../../utils/haptics";

/* ── PatientHome ──────────────────────────────────────────────────
   The single-screen patient view. Top to bottom:
     1. Próxima sesión (hero card)
     2. Saldo (owes / even / credit)
     3. Sesiones anteriores (collapsed list)
     4. Tu profesionista (contact card)

   Empty / error / loading states all render inline as part of the
   same shell. Reads exclusively from the data hook — never writes.

   Money copy is honest: "$0" never appears as "estás al corriente"
   when the patient owes money; the three-state balance card is
   strict about owe vs. even vs. credit. */

const PROFESSION_LABEL = {
  psychologist: "psicóloga",
  nutritionist: "nutrióloga",
  trainer: "entrenadora personal",
  music_teacher: "maestra de música",
  tutor: "tutora",
};

const MODALITY_LABEL = {
  presencial: "Presencial",
  virtual: "Virtual",
  telefonica: "Telefónica",
  "a-domicilio": "A domicilio",
};

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function dayName(iso) {
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "";
  return DAY_NAMES[d.getDay()];
}

const STATUS_LABEL = {
  scheduled: "Programada",
  completed: "Asistió",
  cancelled: "Cancelada",
  charged: "Cobrada",
};
const STATUS_COLOR = {
  scheduled: "var(--teal-dark)",
  completed: "var(--green)",
  cancelled: "var(--charcoal-xl)",
  charged: "var(--amber, #E8B86C)",
};

export function PatientHome({ data }) {
  const { t } = useT();
  const { showToast } = useCardigan();
  const [showAllPast, setShowAllPast] = useState(false);
  // Cancel flow state. `cancelTarget` is the session about to be
  // cancelled (the dialog shows it for context). `cancelNote` is
  // the optional reason the patient types into the dialog.
  // `cancelling` blocks double-fire while the API is in flight.
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelNote, setCancelNote] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const { loading, error, primaryPatient, primaryTherapist, sessions, totalAmountDue, totalCredit, refresh } = data;

  const requestCancel = (session) => {
    setCancelTarget(session);
    setCancelNote("");
  };

  const dismissCancel = () => {
    if (cancelling) return;
    setCancelTarget(null);
    setCancelNote("");
  };

  const confirmCancel = async () => {
    if (!cancelTarget || cancelling) return;
    setCancelling(true);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const access = authSession?.access_token;
      if (!access) {
        showToast(t("patientHome.cancelError"), "error");
        return;
      }
      const res = await fetch("/api/patient-cancel-session", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${access}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: cancelTarget.id,
          note: cancelNote.trim() || undefined,
        }),
      });
      if (!res.ok) {
        showToast(t("patientHome.cancelError"), "error");
        return;
      }
      haptic.success();
      showToast(t("patientHome.cancelSuccess"), "success");
      // Pull fresh data so the cancelled session moves from "future"
      // to "past" without a manual reload. The next-session hero
      // re-renders with whatever's next (or the empty state).
      refresh?.();
      setCancelTarget(null);
      setCancelNote("");
    } catch {
      showToast(t("patientHome.cancelError"), "error");
    } finally {
      setCancelling(false);
    }
  };

  // Classify sessions for THIS patient row only (multi-therapist
  // future will iterate; v1 is single).
  const { future, past } = useMemo(() => {
    if (!primaryPatient) return { future: [], past: [] };
    return classifySessions(sessions, [primaryPatient.id]);
  }, [sessions, primaryPatient]);

  // Soonest future session — sorted ASC by ISO date+time.
  const nextSession = useMemo(() => {
    if (!future.length) return null;
    const withIso = future.map(s => ({
      ...s,
      _iso: shortDateToISO(s.date) + " " + (s.time || "00:00"),
    }));
    withIso.sort((a, b) => a._iso.localeCompare(b._iso));
    return withIso[0];
  }, [future]);

  // Past sessions sorted DESC by ISO so most-recent is at top.
  const pastSorted = useMemo(() => {
    const withIso = past.map(s => ({
      ...s,
      _iso: shortDateToISO(s.date) + " " + (s.time || "00:00"),
    }));
    withIso.sort((a, b) => b._iso.localeCompare(a._iso));
    return withIso;
  }, [past]);

  const visiblePast = showAllPast ? pastSorted : pastSorted.slice(0, 12);

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--charcoal-md)", fontSize: 14 }}>
        {t("loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--red)", fontSize: 14, lineHeight: 1.5 }}>
        {error}
      </div>
    );
  }

  if (!primaryPatient || !primaryTherapist) {
    // Orphan state — user is signed in but no patient row links
    // to them. Could happen if the therapist deleted the row after
    // the patient claimed an invite. Friendly fallback.
    return (
      <div style={{ padding: "40px 20px", textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 18, color: "var(--charcoal)", marginBottom: 8 }}>
          {t("patientHome.orphanTitle")}
        </div>
        <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.55 }}>
          {t("patientHome.orphanBody")}
        </div>
      </div>
    );
  }

  const therapistDisplayName = primaryTherapist.therapist_full_name
    || primaryTherapist.therapist_email?.split("@")[0]
    || "—";
  const professionWord = PROFESSION_LABEL[primaryTherapist.therapist_profession]
    || PROFESSION_LABEL.psychologist;
  // Greeting uses the patient's first name from the patients row.
  // Trim falsy / blank to avoid an awkward "Hola, " with nothing after.
  const patientFirstName = (primaryPatient.name || "").trim().split(/\s+/)[0] || "";

  // First-experience case: patient has just claimed an invite, no
  // sessions scheduled yet, no history. Two cards full of "nothing
  // here" copy felt cold; a single welcome card sets warmer
  // expectations and reads like a designed first-run, not an
  // empty database.
  const isFirstExperience = !nextSession && pastSorted.length === 0;

  return (
    <div
      style={{
        padding: "16px",
        maxWidth: 560,
        margin: "0 auto",
        width: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {patientFirstName && (
        <div
          style={{
            fontFamily: "var(--font-d)",
            fontSize: 22,
            fontWeight: 800,
            color: "var(--charcoal)",
            letterSpacing: "-0.4px",
            lineHeight: 1.15,
            marginTop: 4,
            marginBottom: -2,
          }}
        >
          {t("patientHome.greeting", { name: patientFirstName })}
        </div>
      )}
      {isFirstExperience ? (
        // Combined first-experience welcome card. Replaces the
        // back-to-back empty próxima sesión + empty pasadas pair
        // with a single warm "welcome / wait" message.
        <div
          className="card"
          style={{
            padding: 20,
            background: "var(--teal-pale)",
            border: "1px solid var(--teal-mist)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: "var(--teal-dark)",
              marginBottom: 8,
            }}
          >
            <IconCalendar size={12} /> {t("patientHome.welcomeEyebrow")}
          </div>
          <div
            style={{
              fontFamily: "var(--font-d)",
              fontWeight: 800,
              fontSize: 18,
              color: "var(--charcoal)",
              letterSpacing: "-0.2px",
              marginBottom: 6,
              lineHeight: 1.2,
            }}
          >
            {t("patientHome.welcomeTitle")}
          </div>
          <div
            style={{
              fontSize: 14,
              color: "var(--charcoal-md)",
              lineHeight: 1.55,
            }}
          >
            {t("patientHome.welcomeBody", {
              profession: professionWord,
              name: therapistDisplayName,
            })}
          </div>
        </div>
      ) : (
        // ── Próxima sesión hero ──
        <div className="card" style={{ padding: 16, background: "var(--white)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: "var(--charcoal-xl)",
              marginBottom: 6,
            }}
          >
            <IconCalendar size={12} /> {t("patientHome.nextSessionLabel")}
          </div>
          {nextSession ? (
            <NextSessionCard session={nextSession} onRequestCancel={requestCancel} />
          ) : (
            <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.55, marginTop: 4 }}>
              {t("patientHome.noNextSession")}
            </div>
          )}
        </div>
      )}

      {/* ── Saldo card ── */}
      <BalanceCard
        amountDue={totalAmountDue}
        credit={totalCredit}
        rate={primaryPatient.rate || 0}
      />

      {/* ── Sesiones anteriores ── */}
      {pastSorted.length > 0 && (
        <div className="card" style={{ padding: 16, background: "var(--white)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                color: "var(--charcoal-xl)",
              }}
            >
              {t("patientHome.pastSessionsLabel")} · {pastSorted.length}
            </div>
            {pastSorted.length > 12 && (
              <button
                type="button"
                onClick={() => setShowAllPast(v => !v)}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--teal-dark)",
                  fontFamily: "var(--font)",
                  padding: 0,
                }}
              >
                {showAllPast ? t("patientHome.collapse") : t("patientHome.seeAll")}
              </button>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {visiblePast.map(s => (
              <PastSessionRow key={s.id} session={s} />
            ))}
          </div>
        </div>
      )}

      {/* ── Tu profesionista contact card ── */}
      <div className="card" style={{ padding: 16, background: "var(--white)" }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color: "var(--charcoal-xl)",
            marginBottom: 8,
          }}
        >
          {t("patientHome.therapistLabel", { profession: professionWord })}
        </div>
        <div
          style={{
            fontFamily: "var(--font-d)",
            fontWeight: 800,
            fontSize: 17,
            color: "var(--charcoal)",
            letterSpacing: "-0.2px",
            marginBottom: 10,
          }}
        >
          {therapistDisplayName}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {primaryTherapist.therapist_email && (
            <a
              href={`mailto:${primaryTherapist.therapist_email}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                border: "1px solid var(--border-lt)",
                borderRadius: "var(--radius)",
                color: "var(--charcoal)",
                textDecoration: "none",
                fontSize: 14,
                background: "var(--white)",
              }}
            >
              <IconMail size={16} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {primaryTherapist.therapist_email}
              </span>
            </a>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={!!cancelTarget}
        title={cancelTarget
          ? t("patientHome.cancelDialogTitle", {
              date: formatShortDateWithYear(new Date(shortDateToISO(cancelTarget.date) + "T12:00:00")),
            })
          : ""}
        body={t("patientHome.cancelDialogBody", { name: therapistDisplayName })}
        bodyExtra={
          <textarea
            value={cancelNote}
            onChange={(e) => setCancelNote(e.target.value)}
            placeholder={t("patientHome.cancelNotePlaceholder")}
            rows={2}
            maxLength={500}
            style={{
              width: "100%",
              padding: 10,
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              fontFamily: "var(--font)",
              fontSize: "var(--text-md)",
              color: "var(--charcoal)",
              background: "var(--white)",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
        }
        confirmLabel={t("patientHome.cancelConfirmCta")}
        cancelLabel={t("patientHome.cancelKeepCta")}
        destructive
        busy={cancelling}
        onConfirm={confirmCancel}
        onCancel={dismissCancel}
      />
    </div>
  );
}

function NextSessionCard({ session, onRequestCancel }) {
  const { t } = useT();
  const iso = shortDateToISO(session.date);
  const dateLabel = formatShortDateWithYear(new Date(iso + "T12:00:00"));
  const day = dayName(iso);
  const time = session.time || "—";
  const modality = MODALITY_LABEL[session.modality] || MODALITY_LABEL.presencial;
  const duration = session.duration ? `${session.duration} min` : null;

  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-d)",
          fontWeight: 800,
          fontSize: 22,
          color: "var(--charcoal)",
          letterSpacing: "-0.4px",
          lineHeight: 1.15,
          marginBottom: 4,
        }}
      >
        {day} {dateLabel}
      </div>
      <div style={{ fontSize: 16, color: "var(--charcoal-md)", marginBottom: 8 }}>
        {time}
        {duration ? ` · ${duration}` : ""}
      </div>
      <div
        style={{
          display: "inline-block",
          padding: "3px 10px",
          borderRadius: "var(--radius-pill)",
          background: "var(--teal-pale)",
          color: "var(--teal-dark)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.04em",
        }}
      >
        {modality}
      </div>
      {session.session_type === "interview" && (
        <span
          style={{
            display: "inline-block",
            marginLeft: 6,
            padding: "3px 10px",
            borderRadius: "var(--radius-pill)",
            background: "var(--rose-bg, #F9EEF3)",
            color: "var(--rose, #C77E9C)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.04em",
          }}
        >
          {t("patientHome.interview")}
        </span>
      )}
      {/* Cancel link — quiet treatment so it doesn't compete with
          the date/time hierarchy. The full confirm flow lives in
          the parent (PatientHome) so the dialog state can survive
          re-renders of the card. */}
      {onRequestCancel && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px solid var(--border-lt)",
          }}
        >
          <button
            type="button"
            onClick={() => onRequestCancel(session)}
            style={{
              background: "transparent",
              border: "none",
              padding: "4px 0",
              cursor: "pointer",
              fontFamily: "var(--font)",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--charcoal-md)",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {t("patientHome.cancelCta")}
          </button>
        </div>
      )}
    </div>
  );
}

function BalanceCard({ amountDue, credit, rate }) {
  const { t } = useT();
  // Three states. Mutually exclusive by construction (the
  // accounting helper only ever sets one of amountDue / credit
  // to non-zero).
  const owes = amountDue > 0;
  const hasCredit = credit > 0;
  const tone = owes ? "owe" : hasCredit ? "credit" : "even";
  const palette = {
    owe:    { bg: "var(--red-bg, #F9E1DC)",   fg: "var(--red, #BB4630)" },
    credit: { bg: "var(--green-pale, #E5F1E1)", fg: "var(--green, #5F8F4D)" },
    even:   { bg: "var(--cream)",              fg: "var(--charcoal)" },
  }[tone];
  const Icon = tone === "even" ? IconCheck : IconDollar;

  const valueText = owes
    ? formatMXN(amountDue)
    : hasCredit
      ? formatMXN(credit)
      : t("patientHome.balanceEvenValue");

  const label = owes
    ? t("patientHome.balanceOwe")
    : hasCredit
      ? t("patientHome.balanceCredit")
      : t("patientHome.balanceEven");

  return (
    <div className="card" style={{ padding: 16, background: "var(--white)" }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: "var(--charcoal-xl)",
          marginBottom: 8,
        }}
      >
        {t("patientHome.balanceLabel")}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: palette.bg,
            color: palette.fg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          <Icon size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-d)",
              fontWeight: 800,
              fontSize: 22,
              color: palette.fg,
              letterSpacing: "-0.3px",
              lineHeight: 1.15,
            }}
          >
            {valueText}
          </div>
          <div style={{ fontSize: 13, color: "var(--charcoal-md)", marginTop: 2 }}>
            {label}
          </div>
        </div>
      </div>
      {rate > 0 && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 10,
            borderTop: "1px solid var(--border-lt)",
            fontSize: 12,
            color: "var(--charcoal-xl)",
          }}
        >
          {t("patientHome.ratePerSession", { rate: formatMXN(rate) })}
        </div>
      )}
    </div>
  );
}

function PastSessionRow({ session }) {
  const iso = shortDateToISO(session.date);
  const date = new Date(iso + "T12:00:00");
  const dateLabel = formatShortDateWithYear(date);
  const time = session.time || "—";
  const status = session.status;
  // Apply the auto-complete display rule: a past 'scheduled' slot
  // shows as "Asistió" since the appointment time has passed and
  // the therapist hasn't marked it otherwise. Mirrors the therapist
  // app's display logic so the patient sees the same picture.
  const displayStatus = status === "scheduled" ? "completed" : status;
  const statusLabel = STATUS_LABEL[displayStatus] || displayStatus;
  const statusColor = STATUS_COLOR[displayStatus] || "var(--charcoal-md)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 4px",
        borderBottom: "1px solid var(--border-lt)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: "var(--charcoal)", fontWeight: 600 }}>
          {dateLabel}
        </div>
        <div style={{ fontSize: 12, color: "var(--charcoal-md)" }}>
          {time}
        </div>
      </div>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: statusColor,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          flexShrink: 0,
        }}
      >
        {statusLabel}
      </span>
    </div>
  );
}
