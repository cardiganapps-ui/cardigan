import { useMemo, useRef, useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import { shortDateToISO, formatShortDateWithYear } from "../../utils/dates";
import { formatMXN } from "../../utils/format";
import { classifySessions } from "../../hooks/usePatientPortalData";
import { usePatientDocuments } from "../../hooks/usePatientDocuments";
import { IconCalendar, IconDollar, IconCheck, IconMail, IconUpload, IconDocument, IconTrash, IconChevronRight, IconCreditCard, IconUser, IconUsers, IconX, IconPhone, IconCamera, IconHome, IconSparkle } from "../../components/Icons";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { haptic } from "../../utils/haptics";
import { IntakeFormSheet } from "./IntakeFormSheet";
import { PayBalanceSheet } from "./PayBalanceSheet";
import { RescheduleSessionSheet } from "./RescheduleSessionSheet";
import { isNative } from "../../lib/platform";
import { launchUrl } from "../../lib/nativeBrowser";

/* ── PatientHome ──────────────────────────────────────────────────
   The single-screen patient view. Top to bottom:
     1. Hero — gradient banner with greeting + journey stat + countdown
     2. Quick actions row — Pagar / Reagendar / Subir
     3. Próxima sesión card — date + time + modality + actions
     4. Tu profesionista hero — avatar + name + contact pills
     5. Saldo card with paid/owed visualization
     6. Camino contigo — relationship-stat tile
     7. Sesiones anteriores timeline
     8. Mis archivos

   Empty / error / loading states all render inline as part of the
   same shell. Reads exclusively from the data hook — never writes.

   Money copy is honest: "$0" never appears as "estás al corriente"
   when the patient owes money; the three-state balance card is
   strict about owe vs. even vs. credit. */

// Field/discipline nouns — gender-neutral. Mirrors PROVIDER_LABELS
// in PatientClaimScreen / IntakeFormSheet / useAuth. Practitioner
// nouns ("psicóloga", "nutrióloga") would force a gender assumption
// the patient may not even know is wrong; the field name is what's
// relevant for the relationship.
const PROFESSION_LABEL = {
  psychologist:  "psicología",
  nutritionist:  "nutrición",
  trainer:       "entrenamiento personal",
  music_teacher: "clases de música",
  tutor:         "tutoría",
};

// Profession-themed accent palette. Each profession gets its own
// soft gradient + accent color used in the hero banner, modality
// chip, and therapist avatar so the patient's portal reads as
// "this is my [psychology / nutrition / etc.] space" rather than
// a generic page. The accent colors are pulled from the existing
// design tokens — psychology = teal (the brand default), nutrition
// = green, trainer = amber, music = purple, tutor = rose. Keeps
// the visual identity consistent with the therapist-side styling
// for tutor/interview/etc. */
const PROFESSION_THEME = {
  psychologist:  { accent: "var(--teal)",   accentDark: "var(--teal-dark)",   accentPale: "var(--teal-pale)",   accentMist: "var(--teal-mist)" },
  nutritionist:  { accent: "var(--green)",  accentDark: "#2D7A52",            accentPale: "var(--green-bg)",     accentMist: "var(--green-bg)" },
  trainer:       { accent: "var(--amber)",  accentDark: "#A37C26",            accentPale: "var(--amber-bg)",     accentMist: "var(--amber-bg)" },
  music_teacher: { accent: "var(--purple)", accentDark: "#5E5495",            accentPale: "var(--purple-bg)",    accentMist: "var(--purple-bg)" },
  tutor:         { accent: "var(--rose)",   accentDark: "#A66480",            accentPale: "var(--rose-bg)",      accentMist: "var(--rose-bg)" },
};

const MODALITY_LABEL = {
  presencial: "Presencial",
  virtual: "Virtual",
  telefonica: "Telefónica",
  "a-domicilio": "A domicilio",
};

// Modality glyphs — a lightweight visual cue paired with the text
// label so the next-session card reads quickly even before the eye
// reaches the pill text. Falls back to IconUsers (presencial-style)
// for any unknown modality. Colors come from base.css's
// --modality-* tokens to match the agenda surface.
const MODALITY_ICON = {
  presencial:    IconUsers,
  virtual:       IconCamera,
  telefonica:    IconPhone,
  "a-domicilio": IconHome,
};
const MODALITY_COLOR = {
  presencial:    "var(--modality-presencial)",
  virtual:       "var(--modality-virtual)",
  telefonica:    "var(--modality-telefonica)",
  "a-domicilio": "var(--modality-a-domicilio)",
};

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MONTH_NAMES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

function dayName(iso) {
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "";
  return DAY_NAMES[d.getDay()];
}

// Convert a session (date + time strings) to absolute ms timestamp,
// then format the delta to "now" as a human countdown phrase.
// Returns null when the session is in the past so callers can
// hide the chip cleanly. The "ya casi" / "en unos minutos" copy
// reads warmer than a raw count when the gap is < 1h.
function formatCountdown(iso, time) {
  if (!iso) return null;
  const [h = "0", m = "0"] = (time || "00:00").split(":");
  const target = new Date(`${iso}T${h.padStart(2, "0")}:${m.padStart(2, "0")}:00`).getTime();
  if (!Number.isFinite(target)) return null;
  const delta = target - Date.now();
  if (delta < 0) return null;
  const minutes = Math.floor(delta / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 5) return "ya casi";
  if (minutes < 60) return `en ${minutes} min`;
  if (hours < 24) return hours === 1 ? "en 1 hora" : `en ${hours} horas`;
  if (days < 7) return days === 1 ? "mañana" : `en ${days} días`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return weeks === 1 ? "en 1 semana" : `en ${weeks} semanas`;
  const months = Math.floor(days / 30);
  return months === 1 ? "en 1 mes" : `en ${months} meses`;
}

// Compute relationship stats from past + future sessions. Returns
// { firstSessionDate, completedCount, monthsLabel } for the
// "Camino contigo" tile. Uses the OLDEST session's date as the
// "started together" anchor — works regardless of whether the
// first session is past, completed, or future-but-already-booked.
function computeJourneyStats(allSessions, patientId) {
  if (!patientId) return null;
  const own = (allSessions || []).filter(s => s.patient_id === patientId);
  if (own.length === 0) return null;
  const isos = own
    .map(s => shortDateToISO(s.date))
    .filter(Boolean)
    .sort();
  if (isos.length === 0) return null;
  const firstIso = isos[0];
  const firstDate = new Date(firstIso + "T12:00:00");
  if (Number.isNaN(firstDate.getTime())) return null;
  const completedCount = own.filter(s => {
    if (s.status === "completed" || s.status === "charged") return true;
    if (s.status === "scheduled") {
      const iso = shortDateToISO(s.date);
      if (!iso) return false;
      const [h = "0", m = "0"] = (s.time || "00:00").split(":");
      const ts = new Date(`${iso}T${h.padStart(2,"0")}:${m.padStart(2,"0")}:00`).getTime() + 3_600_000;
      return ts <= Date.now();
    }
    return false;
  }).length;
  const now = new Date();
  const months = (now.getFullYear() - firstDate.getFullYear()) * 12
    + (now.getMonth() - firstDate.getMonth())
    + (now.getDate() >= firstDate.getDate() ? 0 : -1);
  const days = Math.max(0, Math.floor((now - firstDate) / 86_400_000));
  let durationLabel;
  if (days < 7) durationLabel = days <= 1 ? "esta semana" : `hace ${days} días`;
  else if (days < 30) {
    const weeks = Math.floor(days / 7);
    durationLabel = weeks === 1 ? "hace una semana" : `hace ${weeks} semanas`;
  } else if (months < 12) {
    durationLabel = months <= 1 ? "hace un mes" : `hace ${months} meses`;
  } else {
    const years = Math.floor(months / 12);
    durationLabel = years === 1 ? "hace un año" : `hace ${years} años`;
  }
  const startLabel = `${firstDate.getDate()} de ${MONTH_NAMES[firstDate.getMonth()]} de ${firstDate.getFullYear()}`;
  return { firstSessionDate: startLabel, durationLabel, completedCount };
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
  // Patient's own uploads — separate from the therapist-uploaded
  // documents (which the patient can't see in v1).
  const { documents: patientDocs, uploading: docUploading, upload: uploadDoc, remove: removeDoc, getUrl: getDocUrl } = usePatientDocuments(primaryPatient?.id);
  // Reschedule sheet target. When non-null, the sheet is open and
  // operating on this session. Submit posts to the new endpoint and
  // refreshes data on success; the sheet handles its own form state
  // and surfaces server-mapped error hints internally.
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const requestReschedule = (session) => setRescheduleTarget(session);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const intakeCompleted = !!primaryPatient?.patient_intake_completed_at;
  const [payOpen, setPayOpen] = useState(false);
  // Therapist's Stripe Connect status flows through the
  // get_therapists_for_patient RPC (migration 054). Only show the
  // "Pagar saldo" CTA when the therapist has charges_enabled — every
  // other state would land the patient on a 409 from the create-
  // checkout endpoint.
  const therapistAcceptsOnlinePayments = !!primaryTherapist?.therapist_accepts_online_payments;

  // Post-payment return handling. Stripe redirects the patient back
  // to /?pago=exito or /?pago=cancelado after Checkout. Surface a
  // toast (success uses friendly "tu saldo se actualizará en unos
  // segundos" copy because the webhook is async — patient.paid
  // may not yet reflect the payment), refresh, and scrub the URL
  // so a refresh doesn't re-fire the toast.
  useEffect(() => {
    const url = new URL(window.location.href);
    const status = url.searchParams.get("pago");
    if (!status) return;
    url.searchParams.delete("pago");
    url.searchParams.delete("p");
    window.history.replaceState({}, "", url.toString());
    if (status === "exito") {
      haptic.success();
      showToast(t("patientPay.successToast"), "success");
      refresh?.();
    } else if (status === "cancelado") {
      showToast(t("patientPay.canceledToast"), "info");
    }
  }, [showToast, refresh, t]);

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
    return <PatientHomeSkeleton />;
  }

  if (error) {
    return (
      <div className="empty-state" role="alert">
        <div className="empty-state-icon" style={{ background: "var(--red-bg)", color: "var(--red)" }}>
          <IconX size={20} />
        </div>
        <div className="empty-state-title">{t("patientHome.errorTitle")}</div>
        <div className="empty-state-body">{error}</div>
      </div>
    );
  }

  if (!primaryPatient || !primaryTherapist) {
    // Orphan state — user is signed in but no patient row links
    // to them. Could happen if the therapist deleted the row after
    // the patient claimed an invite. Uses the canonical .empty-state
    // pattern (44×44 icon circle + title + muted body).
    return (
      <div className="empty-state">
        <div className="empty-state-icon">
          <IconUser size={20} />
        </div>
        <div className="empty-state-title">{t("patientHome.orphanTitle")}</div>
        <div className="empty-state-body">{t("patientHome.orphanBody")}</div>
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
  const theme = PROFESSION_THEME[primaryTherapist.therapist_profession] || PROFESSION_THEME.psychologist;
  const journey = computeJourneyStats(sessions, primaryPatient.id);

  return (
    <div
      style={{
        padding: "0 0 16px",
        maxWidth: 560,
        margin: "0 auto",
        width: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {/* ── Profession-tinted gradient hero ──
          Soft accent gradient running diagonally into white. Profession
          decides the tint (psicología=teal, nutrición=green, etc.) so
          the same portal reads as "your psychology space" / "your
          nutrition space" depending on the linked professional, instead
          of being a generic white page. */}
      <PatientHero
        firstName={patientFirstName}
        theme={theme}
        nextSession={nextSession}
        journey={journey}
        therapistName={therapistDisplayName}
        professionWord={professionWord}
        isFirstExperience={isFirstExperience}
        t={t}
      />

      <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Intake CTA — shown until the patient self-serves their
            intake form. Hides automatically once the API stamps
            patient_intake_completed_at. Most prominent card on the
            screen for the first-session prep moment. */}
        {!intakeCompleted && (
          <button
            type="button"
            onClick={() => setIntakeOpen(true)}
            className="card btn-tap"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "16px",
              background: theme.accentPale,
              border: `1px solid ${theme.accentMist}`,
              cursor: "pointer",
              fontFamily: "var(--font)",
              textAlign: "left",
              WebkitTapHighlightColor: "transparent",
              width: "100%",
            }}
          >
            <span
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: theme.accent,
                color: "var(--white)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
              aria-hidden="true"
            >
              <IconCheck size={18} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "var(--font-d)",
                  fontSize: 14,
                  fontWeight: 800,
                  color: theme.accentDark,
                  marginBottom: 2,
                }}
              >
                {t("intake.cardTitle")}
              </div>
              <div style={{ fontSize: 12, color: "var(--charcoal-md)", lineHeight: 1.4 }}>
                {t("intake.cardBody")}
              </div>
            </div>
            <IconChevronRight size={14} style={{ color: theme.accentDark, flexShrink: 0 }} />
          </button>
        )}

        {/* Quick actions row — Pagar surfaced as a pill button so the
            highest-intent action is one tap away instead of buried in
            the balance card. Reagendar lives inside the next-session
            card below, so we don't repeat it here. Hidden when there's
            no balance to pay. */}
        <QuickActionsRow
          theme={theme}
          showPay={therapistAcceptsOnlinePayments && totalAmountDue > 0}
          payAmount={totalAmountDue}
          onPay={() => setPayOpen(true)}
        />

        {/* ── Próxima sesión card ──
            Hidden in the first-experience state (PatientHero already
            shows a welcome). Otherwise: rich card with countdown chip,
            modality icon, modality color, and reschedule/cancel
            actions. */}
        {!isFirstExperience && (
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
                marginBottom: 8,
              }}
            >
              <IconCalendar size={12} /> {t("patientHome.nextSessionLabel")}
            </div>
            {nextSession ? (
              <NextSessionCard
                session={nextSession}
                onRequestCancel={requestCancel}
                onRequestReschedule={requestReschedule}
              />
            ) : (
              <div style={{ fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.55, marginTop: 4 }}>
                {t("patientHome.noNextSession")}
              </div>
            )}
          </div>
        )}

        {/* ── Tu profesionista — lifted up from the bottom ──
            The therapist is the patient's primary relationship in
            this app; the card lived at the bottom of the page before
            and read as an afterthought. Now sits right under the next
            session as a richer hero: avatar, name, profession dot,
            contact pills (email + phone if available). */}
        <TherapistHero
          theme={theme}
          name={therapistDisplayName}
          professionWord={professionWord}
          email={primaryTherapist.therapist_email}
          phone={primaryTherapist.therapist_phone}
          t={t}
        />

        {/* ── Saldo card ── */}
        <BalanceCard
          amountDue={totalAmountDue}
          credit={totalCredit}
          rate={primaryPatient.rate || 0}
          paid={primaryPatient.paid || 0}
          onPay={therapistAcceptsOnlinePayments && totalAmountDue > 0 ? () => setPayOpen(true) : null}
          theme={theme}
        />

        {/* ── Camino contigo — relationship-stat tile ──
            Shows how long the patient has been working with this
            professional and how many sessions they've accumulated.
            Reads as warmth, not numbers — "hace 3 meses" / "hace
            un año" — and gives the portal a sense of accumulated
            relationship instead of being a static dashboard. */}
        {journey && journey.completedCount > 0 && (
          <JourneyTile journey={journey} therapistName={therapistDisplayName} theme={theme} />
        )}

        {/* ── Sesiones anteriores — vertical timeline ──
            Replaces the flat list with a visual timeline (status dot
            + connector line + date + status badge). Reads as a journey
            rather than a log. */}
        {pastSorted.length > 0 && (
          <div className="card" style={{ padding: 16, background: "var(--white)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: 14,
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
                  className="btn-tap"
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    color: theme.accentDark,
                    fontFamily: "var(--font)",
                    padding: 0,
                  }}
                >
                  {showAllPast ? t("patientHome.collapse") : t("patientHome.seeAll")}
                </button>
              )}
            </div>
            <SessionTimeline sessions={visiblePast} theme={theme} />
          </div>
        )}

        {/* ── Mis archivos ── */}
        <DocumentsCard
          documents={patientDocs}
          uploading={docUploading}
          onUpload={async (file) => {
            const r = await uploadDoc(file);
            if (r.ok) {
              haptic.tap();
              showToast(t("patientDocs.uploadSuccess"), "success");
            } else {
              showToast(t("patientDocs.uploadError"), "error");
            }
          }}
          onOpen={async (doc) => {
            const url = await getDocUrl(doc.id);
            if (url) window.open(url, "_blank", "noopener,noreferrer");
            else showToast(t("patientDocs.openError"), "error");
          }}
          onRemove={async (doc) => {
            const r = await removeDoc(doc.id);
            if (r.ok) {
              haptic.tap();
              showToast(t("patientDocs.removeSuccess"), "info");
            } else {
              showToast(t("patientDocs.removeError"), "error");
            }
          }}
        />
      </div>
      <IntakeFormSheet
        open={intakeOpen}
        onClose={() => setIntakeOpen(false)}
        patient={primaryPatient}
        therapistProfession={primaryTherapist?.therapist_profession}
        therapistDisplayName={therapistDisplayName}
        onSubmitted={() => {
          // Refresh the data hook so primaryPatient.patient_intake_completed_at
          // becomes truthy and the card disappears on next render.
          refresh?.();
        }}
      />
      <PayBalanceSheet
        open={payOpen}
        onClose={() => setPayOpen(false)}
        patient={primaryPatient}
        amountDue={totalAmountDue}
        therapistName={therapistDisplayName}
      />
      <RescheduleSessionSheet
        open={!!rescheduleTarget}
        session={rescheduleTarget}
        onClose={() => setRescheduleTarget(null)}
        onRescheduled={() => { refresh?.(); }}
      />
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

/* ── PatientHero ──────────────────────────────────────────────────
   Profession-tinted gradient banner replacing the old plain "Hola,
   Diego" text greeting. Picks its accent from PROFESSION_THEME so
   the same portal reads as "your psychology space" / "your nutrition
   space" depending on the linked professional. Hides the journey
   line in the first-experience case (no sessions yet) and replaces
   it with a warm welcome message. */
function PatientHero({ firstName, theme, nextSession, journey, therapistName, professionWord, isFirstExperience, t }) {
  const countdown = useMemo(() => {
    if (!nextSession) return null;
    const iso = shortDateToISO(nextSession.date);
    return formatCountdown(iso, nextSession.time);
  }, [nextSession]);

  return (
    <div
      style={{
        position: "relative",
        padding: "calc(var(--sat, 0px) + 24px) 16px 22px",
        // Diagonal gradient: profession accent at top-left fading
        // into white at bottom-right. The accentMist token keeps the
        // tint subtle (~12% saturation in dark mode, ~8% in light)
        // so it reads as warm presence rather than a colored block.
        background: `linear-gradient(150deg, ${theme.accentPale} 0%, ${theme.accentMist} 35%, var(--white) 75%)`,
        marginBottom: -2,
      }}
    >
      <div style={{ maxWidth: 528, margin: "0 auto" }}>
        {firstName && (
          <div
            style={{
              fontFamily: "var(--font-d)",
              fontSize: 28,
              fontWeight: 800,
              color: "var(--charcoal)",
              letterSpacing: "-0.6px",
              lineHeight: 1.1,
              marginBottom: 6,
            }}
          >
            {t("patientHome.greeting", { name: firstName })}
          </div>
        )}
        {isFirstExperience ? (
          <div style={{ fontSize: 15, color: "var(--charcoal-md)", lineHeight: 1.5, marginTop: 4, maxWidth: 460 }}>
            {t("patientHome.welcomeBody", { profession: professionWord, name: therapistName })}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            {countdown && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 12px",
                  borderRadius: "var(--radius-pill)",
                  background: theme.accent,
                  color: "var(--white)",
                  fontFamily: "var(--font-d)",
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: "-0.1px",
                }}
              >
                <IconCalendar size={12} />
                {`Próxima cita ${countdown}`}
              </span>
            )}
            {journey && journey.completedCount > 0 && (
              <span
                style={{
                  fontSize: 13,
                  color: "var(--charcoal-md)",
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {`${journey.completedCount} ${journey.completedCount === 1 ? "sesión" : "sesiones"} · contigo desde ${journey.durationLabel}`}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── QuickActionsRow ──────────────────────────────────────────────
   Pill row sitting under the hero. Pagar (when balance owed). The
   reschedule action used to live here too, but it duplicated the
   "Pedir cambio de horario" button inside the next-session card
   below; reagendar is now only there. Hidden when there's no
   balance to pay. */
function QuickActionsRow({ theme, showPay, payAmount, onPay }) {
  if (!showPay) return null;
  const pillBase = {
    flex: 1,
    minHeight: 44,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "0 16px",
    borderRadius: "var(--radius-pill)",
    fontFamily: "var(--font-d)",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
    border: "none",
    transition: "transform var(--dur-fast) var(--ease-spring)",
    WebkitTapHighlightColor: "transparent",
  };
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <button
        type="button"
        onClick={onPay}
        className="btn-tap"
        style={{
          ...pillBase,
          background: theme.accent,
          color: "var(--white)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <IconCreditCard size={14} />
        {`Pagar ${formatMXN(payAmount)}`}
      </button>
    </div>
  );
}

/* ── TherapistHero ────────────────────────────────────────────────
   Lifted-up version of the contact card that used to sit at the
   bottom of the page. Avatar + name + profession + contact pills.
   Pulls profession color so the avatar circle echoes the hero tint. */
function TherapistHero({ theme, name, professionWord, email, phone, t }) {
  const initials = (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0])
    .join("")
    .toUpperCase() || "—";

  return (
    <div className="card" style={{ padding: 16, background: "var(--white)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: email || phone ? 14 : 0 }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: theme.accentPale,
            color: theme.accentDark,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontFamily: "var(--font-d)",
            fontWeight: 800,
            fontSize: 18,
            letterSpacing: "-0.2px",
          }}
          aria-hidden="true"
        >
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: "var(--charcoal-xl)",
              marginBottom: 2,
            }}
          >
            {t("patientHome.therapistLabel", { profession: professionWord })}
          </div>
          <div
            style={{
              fontFamily: "var(--font-d)",
              fontWeight: 800,
              fontSize: 18,
              color: "var(--charcoal)",
              letterSpacing: "-0.2px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </div>
        </div>
      </div>
      {(email || phone) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {email && (
            <a
              href={`mailto:${email}`}
              onClick={(e) => {
                if (isNative()) { e.preventDefault(); launchUrl(`mailto:${email}`); }
              }}
              className="btn-tap"
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
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <IconMail size={16} style={{ color: theme.accent, flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {email}
              </span>
            </a>
          )}
          {phone && (
            <a
              href={`tel:${phone}`}
              onClick={(e) => {
                if (isNative()) { e.preventDefault(); launchUrl(`tel:${phone}`); }
              }}
              className="btn-tap"
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
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <IconPhone size={16} style={{ color: theme.accent, flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {phone}
              </span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/* ── JourneyTile ──────────────────────────────────────────────────
   "Camino contigo" relationship-stat tile. Displays a soft sparkle
   icon, the start-date copy, the months/weeks-with phrase, and a
   counter of completed sessions. Reads as warmth, not numbers. */
function JourneyTile({ journey, therapistName, theme }) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: "var(--radius-lg)",
        border: `1px solid ${theme.accentMist}`,
        background: `linear-gradient(135deg, ${theme.accentPale} 0%, var(--white) 100%)`,
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: theme.accent,
          color: "var(--white)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        <IconSparkle size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-d)",
            fontWeight: 800,
            fontSize: 15,
            color: "var(--charcoal)",
            letterSpacing: "-0.2px",
            lineHeight: 1.25,
            marginBottom: 2,
          }}
        >
          {`${journey.durationLabel.charAt(0).toUpperCase() + journey.durationLabel.slice(1)} acompañándote ${therapistName}`}
        </div>
        <div style={{ fontSize: 12, color: "var(--charcoal-md)", lineHeight: 1.4 }}>
          {`${journey.completedCount} ${journey.completedCount === 1 ? "sesión" : "sesiones"} desde el ${journey.firstSessionDate}`}
        </div>
      </div>
    </div>
  );
}

/* ── SessionTimeline ──────────────────────────────────────────────
   Vertical timeline rendering of past sessions. Each row has a
   status dot connected by a soft dashed line; the dot color matches
   the session status (green completed, amber charged, red cancelled,
   teal scheduled). Reads as a journey, not a flat log. */
function SessionTimeline({ sessions, theme }) {
  return (
    <div style={{ position: "relative" }}>
      {sessions.map((session, idx) => {
        const isLast = idx === sessions.length - 1;
        // Auto-complete display rule mirrors the therapist app: a past
        // `scheduled` row reads as "Asistió" since the slot has passed
        // and the therapist didn't override it. Same predicate the
        // accounting helper uses (it counts the session as consumed).
        const displayStatus = session.status === "scheduled" ? "completed" : session.status;
        const statusColor = displayStatus === "completed" ? "var(--green)"
          : displayStatus === "charged" ? "var(--amber)"
          : displayStatus === "cancelled" ? "var(--charcoal-xl)"
          : theme.accentDark;
        const iso = shortDateToISO(session.date);
        const dateLabel = formatShortDateWithYear(new Date(iso + "T12:00:00"));
        const day = dayName(iso);
        const ModalityIcon = MODALITY_ICON[session.modality] || IconUsers;
        const modalityColor = MODALITY_COLOR[session.modality] || "var(--charcoal-xl)";
        return (
          <div
            key={session.id}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              paddingBottom: isLast ? 0 : 14,
              position: "relative",
            }}
          >
            {/* Dot + connector column */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, paddingTop: 2 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: statusColor,
                  boxShadow: `0 0 0 3px ${statusColor === "var(--charcoal-xl)" ? "var(--cream-dark)" : theme.accentMist}`,
                  flexShrink: 0,
                }}
                aria-hidden="true"
              />
              {!isLast && (
                <span
                  style={{
                    width: 1,
                    flex: 1,
                    minHeight: 18,
                    background: `repeating-linear-gradient(to bottom, var(--border-lt) 0 4px, transparent 4px 8px)`,
                    marginTop: 4,
                  }}
                  aria-hidden="true"
                />
              )}
            </div>
            {/* Row body */}
            <div style={{ flex: 1, minWidth: 0, paddingBottom: 2 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
                <span style={{ fontFamily: "var(--font-d)", fontWeight: 700, fontSize: 14, color: "var(--charcoal)", letterSpacing: "-0.1px" }}>
                  {day}
                </span>
                <span style={{ fontSize: 12, color: "var(--charcoal-xl)", fontVariantNumeric: "tabular-nums" }}>
                  {dateLabel}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "var(--charcoal-md)", fontVariantNumeric: "tabular-nums" }}>
                  {session.time || "—"}
                </span>
                {session.modality && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: modalityColor, fontWeight: 700 }}>
                    <ModalityIcon size={11} />
                    {MODALITY_LABEL[session.modality] || ""}
                  </span>
                )}
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: statusColor,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    marginLeft: "auto",
                  }}
                >
                  {STATUS_LABEL[displayStatus] || ""}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NextSessionCard({ session, onRequestCancel, onRequestReschedule }) {
  const { t } = useT();
  const iso = shortDateToISO(session.date);
  const dateLabel = formatShortDateWithYear(new Date(iso + "T12:00:00"));
  const day = dayName(iso);
  const time = session.time || "—";
  const modality = MODALITY_LABEL[session.modality] || MODALITY_LABEL.presencial;
  const duration = session.duration ? `${session.duration} min` : null;
  const ModalityIcon = MODALITY_ICON[session.modality] || IconUsers;
  const modalityColor = MODALITY_COLOR[session.modality] || "var(--teal-dark)";
  const countdown = formatCountdown(iso, session.time);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        {/* Modality icon + color square. Visual cue for "this is a
            phone session vs. a video session vs. in-person" before
            the eye even reaches the text. */}
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "var(--radius)",
            background: `${modalityColor}20`,
            color: modalityColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          <ModalityIcon size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-d)",
              fontWeight: 800,
              fontSize: 20,
              color: "var(--charcoal)",
              letterSpacing: "-0.3px",
              lineHeight: 1.15,
              marginBottom: 2,
            }}
          >
            {day} {dateLabel}
          </div>
          <div style={{ fontSize: 14, color: "var(--charcoal-md)", marginBottom: 10, fontVariantNumeric: "tabular-nums" }}>
            {time}
            {duration ? ` · ${duration}` : ""}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 10px",
                borderRadius: "var(--radius-pill)",
                background: `${modalityColor}1A`,
                color: modalityColor,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.04em",
              }}
            >
              <ModalityIcon size={11} />
              {modality}
            </span>
            {countdown && (
              <span
                style={{
                  fontSize: 12,
                  color: "var(--charcoal-md)",
                  fontWeight: 600,
                }}
              >
                · {countdown}
              </span>
            )}
            {session.session_type === "interview" && (
              <span
                style={{
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
          </div>
        </div>
      </div>
      {/* Action row — Reprogramar + Cancelar as proper pill buttons.
          Earlier iteration shipped these as quiet text links so they
          wouldn't compete with the date/time hierarchy, but the
          contrast was too low — patients couldn't find them. Pills
          with border + tint surface the affordance without screaming.
          Color signals function: teal=neutral action, red=destructive.
          These now own the reschedule entry point fully (the duplicate
          outline pill above the card was removed). */}
      {(onRequestReschedule || onRequestCancel) && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px solid var(--border-lt)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {onRequestReschedule && (
            <button
              type="button"
              onClick={() => onRequestReschedule(session)}
              className="btn-tap"
              style={{
                flex: 1,
                height: 38,
                background: "transparent",
                border: "1px solid var(--teal)",
                borderRadius: "var(--radius-pill)",
                cursor: "pointer",
                fontFamily: "var(--font)",
                fontSize: 13,
                fontWeight: 700,
                color: "var(--teal-dark)",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {t("patientHome.rescheduleCta")}
            </button>
          )}
          {onRequestCancel && (
            <button
              type="button"
              onClick={() => onRequestCancel(session)}
              className="btn-tap"
              style={{
                flex: 1,
                height: 38,
                background: "transparent",
                border: "1px solid var(--red)",
                borderRadius: "var(--radius-pill)",
                cursor: "pointer",
                fontFamily: "var(--font)",
                fontSize: 13,
                fontWeight: 700,
                color: "var(--red)",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {t("patientHome.cancelCta")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BalanceCard({ amountDue, credit, rate, paid, onPay, theme }) {
  const { t } = useT();
  // Three states. Mutually exclusive by construction (the
  // accounting helper only ever sets one of amountDue / credit
  // to non-zero).
  const owes = amountDue > 0;
  const hasCredit = credit > 0;
  const tone = owes ? "owe" : hasCredit ? "credit" : "even";
  const palette = {
    owe:    { bg: "var(--red-bg)",   fg: "var(--red)",   bar: "var(--red)" },
    credit: { bg: "var(--green-bg)", fg: "var(--green)", bar: "var(--green)" },
    even:   { bg: theme?.accentPale || "var(--teal-pale)", fg: theme?.accentDark || "var(--teal-dark)", bar: theme?.accent || "var(--teal)" },
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

  // Progress visualization — only shown when there's history to
  // visualize. Total = paid + amountDue (the accumulated cost so
  // far). Bar shows the paid fraction filled in green/teal, with
  // the unpaid remainder in red. Reads as "this is how much of
  // your relationship is settled" rather than just an abstract
  // peso amount.
  const totalConsumed = (paid || 0) + (amountDue || 0);
  const showBar = totalConsumed > 0 && (owes || (paid || 0) > 0);
  const paidPct = totalConsumed > 0 ? Math.round(((paid || 0) / totalConsumed) * 100) : 0;

  return (
    <div className="card" style={{ padding: 16, background: "var(--white)" }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: "var(--charcoal-xl)",
          marginBottom: 10,
        }}
      >
        {t("patientHome.balanceLabel")}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 44,
            height: 44,
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
          <Icon size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-d)",
              fontWeight: 800,
              fontSize: 24,
              color: palette.fg,
              letterSpacing: "-0.4px",
              lineHeight: 1.1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {valueText}
          </div>
          <div style={{ fontSize: 13, color: "var(--charcoal-md)", marginTop: 2 }}>
            {label}
          </div>
        </div>
      </div>
      {showBar && (
        <div style={{ marginTop: 14 }}>
          {/* Balance paid-progress bar. Track uses --border-lt (the
              modern divider token) instead of legacy --cream-dark;
              fill animates with --dur-base so updates feel snappy
              rather than syrupy. */}
          <div
            style={{
              position: "relative",
              height: 8,
              borderRadius: 100,
              background: "var(--border-lt)",
              overflow: "hidden",
            }}
            aria-hidden="true"
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                width: `${paidPct}%`,
                background: "var(--green)",
                borderRadius: 100,
                transition: "width var(--dur-base) var(--ease-spring)",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "var(--charcoal-md)", fontVariantNumeric: "tabular-nums" }}>
            <span>{`Pagado · ${formatMXN(paid || 0)}`}</span>
            {owes && <span style={{ color: "var(--red)", fontWeight: 600 }}>{`Por pagar · ${formatMXN(amountDue)}`}</span>}
          </div>
        </div>
      )}
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
      {onPay && (
        <button
          type="button"
          onClick={onPay}
          className="btn btn-primary"
          style={{
            marginTop: 14,
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            background: theme?.accent || undefined,
          }}
        >
          <IconCreditCard size={14} />
          {t("patientHome.payCta", { amount: formatMXN(amountDue) })}
        </button>
      )}
    </div>
  );
}

/* ── DocumentsCard ────────────────────────────────────────────────
   Patient's "Mis archivos" surface. Shows up to 3 most-recent
   uploads with an upload button; "Ver todos" expands when there
   are more. Each row: filename + size + open/delete actions.

   Empty state + uploading state + the file picker live here so
   the parent (PatientHome) only has to wire callbacks. The
   <input type="file"> is hidden behind the button — all major
   browsers accept the synthetic click on a hidden input. */
function DocumentsCard({ documents, uploading, onUpload, onOpen, onRemove }) {
  const { t } = useT();
  const fileRef = useRef(null);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const handlePick = (e) => {
    const file = e.target.files?.[0];
    // Reset the input so the SAME file can be picked twice in a row
    // (common iOS pattern when a user re-shoots a photo and tries
    // again after a failed upload).
    e.target.value = "";
    if (file) onUpload(file);
  };

  const visible = showAll ? documents : documents.slice(0, 3);

  return (
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
          {t("patientDocs.label")}{documents.length > 0 ? ` · ${documents.length}` : ""}
        </div>
        {documents.length > 3 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="btn-tap"
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
            {showAll ? t("patientHome.collapse") : t("patientHome.seeAll")}
          </button>
        )}
      </div>

      {documents.length === 0 ? (
        <div
          style={{
            fontSize: 13,
            color: "var(--charcoal-md)",
            lineHeight: 1.5,
            marginBottom: 12,
          }}
        >
          {t("patientDocs.emptyBody")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {visible.map((doc) => (
            <DocumentRow
              key={doc.id}
              document={doc}
              onOpen={() => onOpen(doc)}
              onRemove={() => setConfirmRemove(doc)}
            />
          ))}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        onChange={handlePick}
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv"
        style={{ display: "none" }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="btn btn-primary"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          width: "100%",
          opacity: uploading ? 0.7 : 1,
        }}
      >
        <IconUpload size={14} />
        {uploading ? t("patientDocs.uploading") : t("patientDocs.uploadCta")}
      </button>

      <ConfirmDialog
        open={!!confirmRemove}
        title={t("patientDocs.removeConfirmTitle")}
        body={t("patientDocs.removeConfirmBody", { name: confirmRemove?.name || "" })}
        confirmLabel={t("patientDocs.removeConfirmCta")}
        cancelLabel={t("cancel")}
        destructive
        onConfirm={() => {
          const target = confirmRemove;
          setConfirmRemove(null);
          if (target) onRemove(target);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}

function DocumentRow({ document: doc, onOpen, onRemove }) {
  const { t } = useT();
  const sizeLabel = formatBytes(doc.file_size);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        border: "1px solid var(--border-lt)",
        borderRadius: "var(--radius)",
        background: "var(--white)",
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="btn-tap"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          padding: 0,
          textAlign: "left",
          cursor: "pointer",
          fontFamily: "var(--font)",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "var(--teal-pale)",
            color: "var(--teal-dark)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          <IconDocument size={14} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--charcoal)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {doc.name}
          </span>
          <span style={{ fontSize: 11, color: "var(--charcoal-xl)" }}>
            {sizeLabel}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("patientDocs.removeAria", { name: doc.name })}
        className="btn-tap"
        style={{
          width: 32,
          height: 32,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--charcoal-xl)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          WebkitTapHighlightColor: "transparent",
          flexShrink: 0,
        }}
      >
        <IconTrash size={14} />
      </button>
    </div>
  );
}

function formatBytes(bytes) {
  // Render "—" for missing data (null/undefined/non-numeric); show
  // "0 B" for actual empty files (rare but valid — empty .txt etc).
  if (bytes == null || !Number.isFinite(Number(bytes)) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* Skeleton mirrors PatientHome's first-paint structure: hero card
   (next session), balance row, "tu profesionista" card. Same widths
   + heights as the real cards so the swap-in feels continuous. The
   .sk-bar / .sk-circle classes already animate the cream shimmer. */
function PatientHomeSkeleton() {
  return (
    <div aria-hidden style={{ padding: "16px 16px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Próxima sesión hero */}
      <div className="card" style={{ padding: 16 }}>
        <div className="sk-bar sk-bar-xs" style={{ width: "30%", marginBottom: 10 }} />
        <div className="sk-bar sk-bar-lg" style={{ width: "70%", marginBottom: 8 }} />
        <div className="sk-bar sk-bar-sm" style={{ width: "50%", marginBottom: 16 }} />
        <div style={{ display: "flex", gap: 12 }}>
          <div className="sk-bar sk-bar-md" style={{ width: 96, borderRadius: 100 }} />
          <div className="sk-bar sk-bar-md" style={{ width: 96, borderRadius: 100 }} />
        </div>
      </div>
      {/* Saldo */}
      <div className="card" style={{ padding: 16 }}>
        <div className="sk-bar sk-bar-xs" style={{ width: "20%", marginBottom: 10 }} />
        <div className="sk-bar sk-bar-lg" style={{ width: "55%", marginBottom: 6 }} />
        <div className="sk-bar sk-bar-sm" style={{ width: "35%" }} />
      </div>
      {/* Tu profesionista */}
      <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <div className="sk-circle" />
        <div style={{ flex: 1 }}>
          <div className="sk-bar sk-bar-md" style={{ width: "55%", marginBottom: 6 }} />
          <div className="sk-bar sk-bar-xs" style={{ width: "35%" }} />
        </div>
      </div>
    </div>
  );
}
