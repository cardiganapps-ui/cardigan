import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import { useEscape } from "../../hooks/useEscape";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useSheetExit } from "../../hooks/useSheetExit";
import { IconX, IconCheck, IconMail, IconLink } from "../Icons";
import { WhatsAppGlyph, ShareGlyph } from "../ReferralShareBlock";
import { haptic } from "../../utils/haptics";
import { isSharingSupported, shareContent } from "../../lib/nativeShare";

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
  // The API returns `already_linked: true` when this patient is
  // already paired with a Cardigan account. We still let the
  // therapist generate + share an invite URL (they might want to
  // re-share for any reason) but we surface a banner so they know
  // it'll be a no-op until/unless the existing link is broken.
  const [alreadyLinked, setAlreadyLinked] = useState(false);

  const panelRef = useFocusTrap(!!patient);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose, { isOpen: !!patient });
  const setPanel = (el) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  const { exiting, animatedClose } = useSheetExit(!!patient, onClose);
  useEscape(patient ? animatedClose : null);

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
      setAlreadyLinked(false);
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
      setAlreadyLinked(!!j.already_linked);
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
  // build our own share row using the same visual language —
  // glyphs, button shape, and three-tier hierarchy (native →
  // direct channels → URL + Copy).
  const shareText = t("patientInvite.shareText", {
    name: patient.name,
    url: inviteUrl,
  });

  // Native-share availability — the iOS Safari share sheet (and
  // Android Chrome's equivalent) covers every app the user has
  // installed. Inside the native shell this routes through the
  // Capacitor Share plugin (consistent across iOS WKWebView and
  // Android WebView). Hidden only on older desktop browsers.
  const canNativeShare = isSharingSupported();

  const handleNativeShare = async () => {
    if (!inviteUrl) return;
    haptic.tap();
    const res = await shareContent({
      title: t("patientInvite.title", { name: patient.name }),
      text: shareText,
      url: inviteUrl,
    });
    if (!res.ok && !res.aborted && res.error) {
      console.warn("invite share:", res.error);
    }
  };

  return (
    <div className={`sheet-overlay ${exiting ? "sheet-overlay--exit" : ""}`} onClick={animatedClose}>
      <div
        ref={setPanel}
        className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`}
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
            onClick={animatedClose}
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
            // ── Post-generation: confirmation + share row ──
            // Mirrors ReferralShareBlock's three-tier hierarchy:
            //   1. Native share (primary, when navigator.share works)
            //   2. WhatsApp + Email icon row (always present)
            //   3. URL + Copy fallback below
            // The pre-existing "share-but-already-linked" amber banner
            // sits above everything since it's a state-of-the-world
            // notice the therapist needs before they share.
            <>
              {alreadyLinked ? (
                // Stay loud here — this is a state-of-the-world warning
                // the therapist needs to register before sharing. amber-bg
                // is the alpha-tinted token defined in BOTH light + dark
                // themes (vs amber-pale which is light-only and rendered
                // as a bright pastel against the dark page).
                <div
                  style={{
                    padding: "12px 14px",
                    background: "var(--amber-bg, rgba(212,160,64,0.12))",
                    border: "1px solid var(--amber-mist, rgba(212,160,64,0.35))",
                    borderRadius: "var(--radius)",
                    fontSize: "var(--text-sm)",
                    color: "var(--charcoal)",
                    lineHeight: 1.5,
                    marginBottom: 16,
                  }}
                >
                  {t("patientInvite.alreadyLinkedNotice", { name: patient.name })}
                </div>
              ) : (
                // Inline confirmation, no colored card. The previous
                // green-tinted band relied on --green-pale (light-mode
                // token) which fell through to a literal pastel hex in
                // dark mode — bright background + bright charcoal text =
                // unreadable. The check disc alone carries enough visual
                // weight; the row sits flush in the sheet's neutral
                // typography.
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "2px 0 14px",
                    fontSize: "var(--text-sm)",
                    color: "var(--charcoal-md)",
                    lineHeight: 1.45,
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
                  <span style={{ flex: 1 }}>
                    {t("patientInvite.generatedHint", { name: patient.name })}
                  </span>
                </div>
              )}

              {/* Tier 1 — native OS share. Hidden on browsers without
                  navigator.share (mostly desktop). When available,
                  this is the dominant CTA so iPhone users get the
                  iOS share sheet (their muscle memory). */}
              {canNativeShare && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleNativeShare}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    marginBottom: 14,
                  }}
                >
                  <ShareGlyph size={16} />
                  <span>{t("patientInvite.shareNative")}</span>
                </button>
              )}

              {/* Tier 2 — direct channels. Eyebrow only when there's
                  a primary above to separate from. */}
              {canNativeShare && (
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--charcoal-md)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: 10,
                    textAlign: "center",
                  }}
                >
                  {t("patientInvite.shareDirectEyebrow")}
                </div>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                  marginBottom: 14,
                }}
              >
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="referral-channel-btn"
                  style={{ background: "#25D366", color: "#fff" }}
                  onClick={() => haptic.tap()}
                  aria-label="WhatsApp"
                >
                  <WhatsAppGlyph size={20} />
                  <span>WhatsApp</span>
                </a>
                <a
                  href={`mailto:?subject=${encodeURIComponent(t("patientInvite.emailSubject"))}&body=${encodeURIComponent(shareText)}`}
                  className="referral-channel-btn"
                  // Hardcoded charcoal so the pill stays dark in both
                  // themes — the var token inverts to light grey in
                  // dark mode and the white label disappears.
                  style={{ background: "#1A1A1A", color: "#fff" }}
                  onClick={() => haptic.tap()}
                  aria-label={t("patientInvite.email")}
                >
                  <IconMail size={18} />
                  <span>{t("patientInvite.email")}</span>
                </a>
              </div>

              {/* Tier 3 — URL display + Copy. The URL itself is no
                  longer monospace-prominent; it sits in a calm cream
                  card with the copy button on the right so the eye
                  goes there instead of trying to read a 60-char
                  hash. The link icon at the start anchors what the
                  text is. */}
              <div
                style={{
                  display: "flex",
                  alignItems: "stretch",
                  gap: 8,
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 12px",
                    background: "var(--cream)",
                    border: "1px solid var(--border-lt)",
                    borderRadius: "var(--radius)",
                    color: "var(--charcoal-md)",
                  }}
                  aria-label="Invite URL"
                >
                  <IconLink size={14} />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: "var(--text-sm)",
                      userSelect: "all",
                      direction: "rtl",
                      textAlign: "left",
                    }}
                    title={inviteUrl}
                  >
                    {/* RTL + LTR override keeps the slug visible (the
                        right-most identifying part) when the URL is
                        too long, while the rest ellipses at the left.
                        ‎ forces the leading direction so Spanish
                        screen readers still parse left-to-right. */}
                    {"‎"}{inviteUrl}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={copyUrl}
                  style={{
                    flexShrink: 0,
                    height: "auto",
                    minHeight: 0,
                    padding: "0 16px",
                    fontSize: "var(--text-sm)",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}
                >
                  {copied ? t("patientInvite.copied") : t("patientInvite.copy")}
                </button>
              </div>

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
