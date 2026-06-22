import React, { useMemo, useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import { shortDateToISO, formatShortDateWithYear } from "../../utils/dates";
import { classifySessions } from "../../hooks/usePatientPortalData";
import { usePatientDocuments } from "../../hooks/usePatientDocuments";
import { IconCalendar, IconCheck, IconChevronRight, IconUser, IconX } from "../../components/Icons";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { haptic } from "../../utils/haptics";
import { IntakeFormSheet } from "./IntakeFormSheet";
import { PayBalanceSheet } from "./PayBalanceSheet";
import { RescheduleSessionSheet } from "./RescheduleSessionSheet";
import { PROFESSION_LABEL, PROFESSION_THEME, computeJourneyStats } from "./home/constants";
import { PatientHero } from "./home/PatientHero";
import { QuickActionsRow } from "./home/QuickActionsRow";
import { NextSessionCard } from "./home/NextSessionCard";
import { TherapistHero } from "./home/TherapistHero";
import { BalanceCard } from "./home/BalanceCard";
import { JourneyTile } from "./home/JourneyTile";
import { SessionTimeline } from "./home/SessionTimeline";
import { DocumentsCard } from "./home/DocumentsCard";
import { PatientHomeSkeleton } from "./home/PatientHomeSkeleton";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed portal data + domain rows
type Row = any;

type PatientHomeProps = {
  data: Row;
  user?: Row;
};

export function PatientHome({ data }: PatientHomeProps) {
  const { t } = useT();
  const { showToast } = useCardigan();
  const [showAllPast, setShowAllPast] = useState(false);
  // Cancel flow state. `cancelTarget` is the session about to be
  // cancelled (the dialog shows it for context). `cancelNote` is
  // the optional reason the patient types into the dialog.
  // `cancelling` blocks double-fire while the API is in flight.
  const [cancelTarget, setCancelTarget] = useState<Row | null>(null);
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
  const [rescheduleTarget, setRescheduleTarget] = useState<Row | null>(null);
  const requestReschedule = (session: Row) => setRescheduleTarget(session);
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

  const requestCancel = (session: Row) => {
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
    const withIso = future.map((s: Row) => ({
      ...s,
      _iso: shortDateToISO(s.date) + " " + (s.time || "00:00"),
    }));
    withIso.sort((a: Row, b: Row) => a._iso.localeCompare(b._iso));
    return withIso[0];
  }, [future]);

  // Past sessions sorted DESC by ISO so most-recent is at top.
  const pastSorted = useMemo(() => {
    const withIso = past.map((s: Row) => ({
      ...s,
      _iso: shortDateToISO(s.date) + " " + (s.time || "00:00"),
    }));
    withIso.sort((a: Row, b: Row) => b._iso.localeCompare(a._iso));
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
  const professionWord = PROFESSION_LABEL[primaryTherapist.therapist_profession as keyof typeof PROFESSION_LABEL]
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
  const theme = PROFESSION_THEME[primaryTherapist.therapist_profession as keyof typeof PROFESSION_THEME] || PROFESSION_THEME.psychologist;
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
      {/* Hero fades while the card stack rises (two-layer entrance). */}
      <div style={{ animation: "fadeIn var(--dur-slow) var(--ease-out) both" }}>
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
      </div>

      <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Intake CTA — shown until the patient self-serves their
            intake form. Hides automatically once the API stamps
            patient_intake_completed_at. Most prominent card on the
            screen for the first-session prep moment. */}
        {!intakeCompleted && (
          <button
            type="button"
            onClick={() => setIntakeOpen(true)}
            className="card btn-tap list-entry-stagger"
            style={{
              "--stagger-i": 0,
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
            } as React.CSSProperties}
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
          <div className="card list-entry-stagger" style={{ padding: 16, background: "var(--white)", "--stagger-i": 2 } as React.CSSProperties}>
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
          onPay={therapistAcceptsOnlinePayments && totalAmountDue > 0 ? () => setPayOpen(true) : undefined}
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
          onUpload={async (file: Row) => {
            const r = await uploadDoc(file);
            if (r.ok) {
              haptic.tap();
              showToast(t("patientDocs.uploadSuccess"), "success");
            } else {
              showToast(t("patientDocs.uploadError"), "error");
            }
          }}
          onOpen={async (doc: Row) => {
            const url = await getDocUrl(doc.id);
            if (url) window.open(url, "_blank", "noopener,noreferrer");
            else showToast(t("patientDocs.openError"), "error");
          }}
          onRemove={async (doc: Row) => {
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
