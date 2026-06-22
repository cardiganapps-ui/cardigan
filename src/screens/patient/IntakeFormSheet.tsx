import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { IconX, IconCheck } from "../../components/Icons";
import { usesAnthropometrics } from "../../data/constants";
import { haptic } from "../../utils/haptics";
import { todayISO } from "../../utils/dates";

/* ── IntakeFormSheet ──────────────────────────────────────────────
   First-session prep form. Surfaces the same fields the therapist
   would normally enter when adding a patient, letting the patient
   self-serve their own intake. The therapist sees the data populate
   in their existing expediente.

   Profession-aware: nutritionists + trainers see height + goals
   (anthropometric fields); psychologists / tutors / music teachers
   skip those entirely.

   Always-shown fields: birthdate (optional), allergies (textarea),
   medical_conditions (textarea), explicit privacy-consent toggle.
   The privacy consent is REQUIRED — the form's submit button
   stays disabled until the toggle is on.

   Idempotent: a returning patient who already completed intake can
   re-open the sheet to revise. The original completed_at sticks; the
   columns update with whatever they re-submit. */

// Field nouns rather than practitioner nouns so the form copy
// doesn't force a gender assumption on the therapist. Mirrors the
// same map in PatientClaimScreen / PatientHome / useAuth.
const PROFESSION_LABEL: Record<string, string> = {
  psychologist:  "psicología",
  nutritionist:  "nutrición",
  trainer:       "entrenamiento personal",
  music_teacher: "clases de música",
  tutor:         "tutoría",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed patient row from untyped portal hook
type Row = any;

type IntakeFormSheetProps = {
  open: boolean;
  onClose?: () => void;
  patient: Row;
  therapistProfession?: string;
  therapistDisplayName?: string;
  onSubmitted?: () => void;
};

export function IntakeFormSheet({ open, onClose, patient, therapistProfession, therapistDisplayName, onSubmitted }: IntakeFormSheetProps) {
  const { t } = useT();
  const { showToast, setHideFab } = useCardigan();
  const showAnthro = usesAnthropometrics(therapistProfession);

  // Form fields — pre-fill with whatever's already on the patient
  // row so revisits show the existing values (the therapist might
  // have entered some during onboarding).
  const [birthdate, setBirthdate] = useState("");
  const [allergies, setAllergies] = useState("");
  const [medicalConditions, setMedicalConditions] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [goalWeightKg, setGoalWeightKg] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Inline error hint — survives the toast auto-dismiss so the user
  // can read why a submit failed even after the toast fades. Cleared
  // on every new submit attempt + on form-field changes downstream.
  const [errorHint, setErrorHint] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBirthdate(patient?.birthdate || "");
    setAllergies(patient?.allergies || "");
    setMedicalConditions(patient?.medical_conditions || "");
    setHeightCm(patient?.height_cm ? String(patient.height_cm) : "");
    setGoalWeightKg(patient?.goal_weight_kg ? String(patient.goal_weight_kg) : "");
    // Don't reset consent on every open — preserving it across mid-
    // session retries (submit fails, patient adjusts a field,
    // re-submits) saves them from re-ticking every attempt. Reset
    // happens on the close transition below, so a fresh open starts
    // unchecked.
    setSubmitting(false);
  }, [open, patient?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset consent on CLOSE so the next open starts unchecked.
  // Covers the edge where the privacy policy version changes
  // between visits — fresh acceptance per session.
  useEffect(() => {
    if (open) return;
    setConsent(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setHideFab?.(true);
    return () => setHideFab?.(false);
  }, [open, setHideFab]);

  useEscape(open ? onClose : null);
  const panelRef = useFocusTrap(!!open);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose || (() => {}), { isOpen: open });
  const setPanel = (el: HTMLElement | null) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  if (!open || !patient) return null;

  const submit = async () => {
    if (submitting || !consent) return;
    setErrorHint(null);
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const access = session?.access_token;
      if (!access) {
        setErrorHint("auth");
        showToast(t("intake.error"), "error");
        return;
      }
      const payload = {
        patient_id: patient.id,
        birthdate: birthdate || null,
        allergies: allergies.trim() || null,
        medical_conditions: medicalConditions.trim() || null,
        consent: true,
        ...(showAnthro
          ? {
              height_cm: heightCm ? Number(heightCm) : null,
              goal_weight_kg: goalWeightKg ? Number(goalWeightKg) : null,
            }
          : {}),
      };
      const res = await fetch("/api/patient-intake", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${access}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setErrorHint("server");
        showToast(t("intake.error"), "error");
        return;
      }
      haptic.success();
      showToast(t("intake.success"), "success");
      onSubmitted?.();
      onClose?.();
    } catch {
      setErrorHint("network");
      showToast(t("intake.error"), "error");
    } finally {
      setSubmitting(false);
    }
  };

  const profession = PROFESSION_LABEL[therapistProfession || ""] || PROFESSION_LABEL.psychologist;

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div
        ref={setPanel}
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("intake.title")}
        onClick={(e) => e.stopPropagation()}
        {...panelHandlers}
        style={{ maxHeight: "92vh" }}
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("intake.title")}</span>
          <button
            type="button"
            className="sheet-close"
            onClick={onClose}
            aria-label={t("close")}
          >
            <IconX size={14} />
          </button>
        </div>
        <div style={{ padding: "0 20px 28px" }}>
          {/* Intro */}
          <div
            style={{
              fontSize: "var(--text-md)",
              color: "var(--charcoal)",
              lineHeight: 1.55,
              marginBottom: 18,
            }}
          >
            {t("intake.intro", {
              profession,
              name: therapistDisplayName || t("patientClaim.therapistFallback"),
            })}
          </div>

          {/* Birthdate */}
          <div className="input-group" style={{ marginBottom: 14 }}>
            <label className="input-label">{t("intake.birthdateLabel")}</label>
            <input
              type="date"
              className="input"
              value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
              max={todayISO()}
              min="1900-01-01"
            />
          </div>

          {/* Allergies */}
          <div className="input-group" style={{ marginBottom: 14 }}>
            <label className="input-label">{t("intake.allergiesLabel")}</label>
            <textarea
              className="input"
              value={allergies}
              onChange={(e) => setAllergies(e.target.value)}
              placeholder={t("intake.allergiesPlaceholder")}
              rows={2}
              maxLength={2000}
              style={{ resize: "vertical", fontFamily: "var(--font)" }}
            />
          </div>

          {/* Medical conditions */}
          <div className="input-group" style={{ marginBottom: 14 }}>
            <label className="input-label">{t("intake.medicalConditionsLabel")}</label>
            <textarea
              className="input"
              value={medicalConditions}
              onChange={(e) => setMedicalConditions(e.target.value)}
              placeholder={t("intake.medicalConditionsPlaceholder")}
              rows={3}
              maxLength={2000}
              style={{ resize: "vertical", fontFamily: "var(--font)" }}
            />
          </div>

          {/* Anthropometrics — nutri / trainer only */}
          {showAnthro && (
            <>
              <div className="input-group" style={{ marginBottom: 14 }}>
                <label className="input-label">{t("intake.heightLabel")}</label>
                <input
                  type="number"
                  inputMode="decimal"
                  className="input"
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                  placeholder={t("intake.heightPlaceholder")}
                  min="50"
                  max="250"
                  step="0.1"
                />
              </div>
              <div className="input-group" style={{ marginBottom: 14 }}>
                <label className="input-label">{t("intake.goalWeightLabel")}</label>
                <input
                  type="number"
                  inputMode="decimal"
                  className="input"
                  value={goalWeightKg}
                  onChange={(e) => setGoalWeightKg(e.target.value)}
                  placeholder={t("intake.goalWeightPlaceholder")}
                  min="20"
                  max="400"
                  step="0.1"
                />
              </div>
            </>
          )}

          {/* Privacy consent — required to submit. White card with
              a soft border lift (matches the design-system rule:
              cards on white, never `--cream` as the wrapper). */}
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "14px",
              border: "1px solid var(--border-lt)",
              borderRadius: "var(--radius)",
              background: "var(--white)",
              boxShadow: "var(--shadow-sm)",
              marginTop: 6,
              marginBottom: 18,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              style={{ marginTop: 3, flexShrink: 0 }}
            />
            <span
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--charcoal-md)",
                lineHeight: 1.5,
              }}
            >
              {t("intake.consentLabel")}
              {" "}
              <a
                href="/#privacy"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--teal-dark)", fontWeight: 600 }}
              >
                {t("intake.consentLink")}
              </a>
              .
            </span>
          </label>

          {errorHint && (
            <div
              role="alert"
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--red)",
                lineHeight: 1.45,
                marginBottom: 14,
              }}
            >
              {errorHint === "network"   ? t("intake.errorNetwork")
                : errorHint === "auth"   ? t("intake.errorAuth")
                : t("intake.error")}
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={submitting || !consent}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity: !consent || submitting ? 0.6 : 1,
            }}
          >
            <IconCheck size={14} />
            {submitting ? t("intake.submitting") : t("intake.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
