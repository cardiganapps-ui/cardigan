import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { IconX, IconCheck } from "../Icons";
import { haptic } from "../../utils/haptics";

/* ── InvitePatientSheet ───────────────────────────────────────────
   Therapist-side bottom sheet that generates a single-use invite
   URL for one of their patients. The URL is shown once, then the
   user shares it however they want (WhatsApp / email / copy / OS
   share).

   Two states:
     1. Pre-generation: explainer copy + "Generar enlace" button
     2. Post-generation: the URL + share buttons + a privacy
        disclosure ("caduca en 30 días, anyone with this link can
        join as this patient")

   The URL is generated on demand — no auto-create on open. Lets
   the therapist back out without leaving an unused invite row in
   the DB. (Unused rows aren't a security concern because the token
   is hashed, but they'd accumulate over time.) */

export function InvitePatientSheet({ patient, onClose }) {
  const { t } = useT();
  const { showToast, setHideFab } = useCardigan();
  const [busy, setBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState(null);
  const [copied, setCopied] = useState(false);

  const panelRef = useFocusTrap(!!patient);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose, { isOpen: !!patient });
  const setPanel = (el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  useEscape(patient ? onClose : null);

  useEffect(() => {
    if (!patient) return;
    setHideFab?.(true);
    return () => setHideFab?.(false);
  }, [patient, setHideFab]);

  // Reset on each open.
  useEffect(() => {
    if (patient) {
      setBusy(false);
      setInviteUrl("");
      setExpiresAt(null);
      setCopied(false);
    }
  }, [patient?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async () => {
    if (busy || !patient) return;
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const access = session?.access_token;
      if (!access) {
        showToast(t("patientInvite.error"), "error");
        return;
      }
      const res = await fetch("/api/patient-invite", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${access}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ patient_id: patient.id }),
      });
      if (!res.ok) {
        showToast(t("patientInvite.error"), "error");
        return;
      }
      const j = await res.json();
      setInviteUrl(j.url);
      setExpiresAt(j.expires_at);
      haptic.success();
    } catch {
      showToast(t("patientInvite.error"), "error");
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      haptic.tap();
      setTimeout(() => setCopied(false), 1800);
    } catch {
      showToast(t("patientInvite.copyError"), "error");
    }
  };

  if (!patient) return null;

  // ReferralShareBlock takes a `code` and builds its own URL +
  // shareable text. We're sharing a full URL, not a code, so we
  // skip ReferralShareBlock and build our own minimal share row
  // (WhatsApp / Email / Copy) using the same visual language.
  const shareText = t("patientInvite.shareText", {
    name: patient.name,
    url: inviteUrl,
  });

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div
        ref={setPanel}
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("patientInvite.title", { name: patient.name })}
        onClick={(e) => e.stopPropagation()}
        {...panelHandlers}
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">
            {t("patientInvite.title", { name: patient.name })}
          </span>
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
          {!inviteUrl ? (
            // ── Pre-generation ──
            <>
              <div
                style={{
                  fontSize: "var(--text-md)",
                  color: "var(--charcoal)",
                  lineHeight: 1.5,
                  marginBottom: 14,
                }}
              >
                {t("patientInvite.body")}
              </div>
              <ul
                style={{
                  margin: "0 0 18px",
                  paddingLeft: 18,
                  fontSize: "var(--text-sm)",
                  color: "var(--charcoal-md)",
                  lineHeight: 1.6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <li>{t("patientInvite.bullet1")}</li>
                <li>{t("patientInvite.bullet2")}</li>
                <li>{t("patientInvite.bullet3")}</li>
              </ul>
              <button
                type="button"
                className="btn btn-primary"
                onClick={generate}
                disabled={busy}
                style={{ width: "100%" }}
              >
                {busy ? t("loading") : t("patientInvite.generateCta")}
              </button>
            </>
          ) : (
            // ── Post-generation: URL + share row ──
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 12px",
                  background: "var(--green-pale, #E5F1E1)",
                  border: "1px solid var(--green-mist, #C6E1BE)",
                  borderRadius: "var(--radius)",
                  fontSize: "var(--text-sm)",
                  color: "var(--charcoal)",
                  marginBottom: 14,
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "var(--green)",
                    color: "var(--white)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                  aria-hidden="true"
                >
                  <IconCheck size={12} />
                </span>
                <span style={{ flex: 1 }}>{t("patientInvite.generatedHint")}</span>
              </div>

              <div
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 12,
                  background: "var(--cream)",
                  border: "1px solid var(--border-lt)",
                  borderRadius: "var(--radius)",
                  padding: "10px 12px",
                  wordBreak: "break-all",
                  color: "var(--charcoal-md)",
                  marginBottom: 12,
                  userSelect: "all",
                }}
                aria-label="Invite URL"
              >
                {inviteUrl}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="referral-channel-btn"
                  style={{ background: "#25D366", color: "#fff" }}
                  onClick={() => haptic.tap()}
                >
                  <span>WhatsApp</span>
                </a>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={copyUrl}
                  style={{ width: "100%", height: 44 }}
                >
                  {copied ? t("patientInvite.copied") : t("patientInvite.copy")}
                </button>
              </div>

              <a
                href={`mailto:?subject=${encodeURIComponent(t("patientInvite.emailSubject"))}&body=${encodeURIComponent(shareText)}`}
                className="referral-channel-btn"
                style={{
                  background: "#1A1A1A",
                  color: "#fff",
                  width: "100%",
                  marginBottom: 14,
                }}
                onClick={() => haptic.tap()}
              >
                <span>{t("patientInvite.email")}</span>
              </a>

              <div
                style={{
                  fontSize: 11,
                  color: "var(--charcoal-xl)",
                  lineHeight: 1.5,
                  textAlign: "center",
                }}
              >
                {expiresAt
                  ? t("patientInvite.expiresAt", {
                      date: new Date(expiresAt).toLocaleDateString("es-MX", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      }),
                    })
                  : t("patientInvite.expires30d")}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
