import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { useT } from "../i18n/index";
import { useCardiganMain } from "../context/CardiganContext";
import { useEscape } from "../hooks/useEscape";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useSheetDrag } from "../hooks/useSheetDrag";
import { useSheetExit } from "../hooks/useSheetExit";
import { IconX, IconStar } from "./Icons";
import { track } from "../lib/analytics";
import { haptic } from "../utils/haptics";

/* ── RatingSheet ──────────────────────────────────────────────────────
   1-5 stars + optional comment, captured at structured prompts:
     - day14_v1   : default prompt at +14 days from signup, gated
                    additionally on having logged at least 1 session
     - day30_v1   : fallback if the user dismissed day14 without
                    submitting

   The sheet is mounted once in App.jsx and shown via the
   `open / onClose` props pair. Stars render as monochrome icons —
   filled when index ≤ selected, outlined otherwise. Tapping a star
   sets the score; submit only fires once the user explicitly taps
   "Enviar" (so an accidental tap on a star can be revised).

   1-2 stars promote the comment textarea to required state and
   change the prompt copy to "¿Qué nos faltó?" — captures detractor
   signal at the moment they're most likely to articulate it.
   5 stars adds an inline link to the referral sheet on success
   (NPS → referral handoff). */

const STARS = [1, 2, 3, 4, 5];

function dismissKey(promptKind: string, userId?: string) {
  return `cardigan.rating.${promptKind}.dismissed.${userId || "anon"}`;
}
function submittedKey(promptKind: string, userId?: string) {
  return `cardigan.rating.${promptKind}.submitted.${userId || "anon"}`;
}

export function RatingSheet({ open, onClose, promptKind = "day14_v1", userId }: {
  open?: boolean;
  onClose?: () => void;
  promptKind?: string;
  userId?: string;
}) {
  const { t } = useT();
  const { showToast, setHideFab } = useCardiganMain();
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Reset state every time the sheet opens — a re-open after an
  // earlier dismissal should start fresh, not show the prior draft.
  useEffect(() => {
    if (open) {
      setStars(0);
      setHover(0);
      setComment("");
      setSubmitted(false);
      track("rating_sheet_shown", { prompt_kind: promptKind });
    }
  }, [open, promptKind]);

  useEffect(() => {
    if (!open) return;
    setHideFab?.(true);
    return () => setHideFab?.(false);
  }, [open, setHideFab]);

  const { exiting, animatedClose } = useSheetExit(!!open, onClose);
  useEscape(open ? animatedClose : null);
  const panelRef = useFocusTrap(!!open);
  const { scrollRef, setPanelEl, panelHandlers } = useSheetDrag(onClose || (() => {}), { isOpen: !!open });
  const setPanel = (el: HTMLElement | null) => {
    panelRef.current = el;
    scrollRef.current = el;
    setPanelEl(el);
  };

  if (!open) return null;

  const isDetractor = stars > 0 && stars <= 2;
  const commentRequired = isDetractor;
  const promptCopy = isDetractor
    ? t("rating.detractorPrompt")
    : t("rating.body");

  const dismiss = () => {
    if (busy) return;
    if (!submitted) {
      try { localStorage.setItem(dismissKey(promptKind, userId), "1"); } catch { /* ignore */ }
      track("rating_dismissed", { prompt_kind: promptKind, stars });
    }
    animatedClose();
  };

  const submit = async () => {
    if (busy) return;
    if (stars < 1) return;
    if (commentRequired && comment.trim().length === 0) {
      showToast(t("rating.commentRequired"), "warning");
      return;
    }
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const access = session?.access_token;
      if (!access) {
        showToast(t("rating.sendError"), "error");
        return;
      }
      const res = await fetch("/api/user-rating", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${access}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          promptKind,
          stars,
          comment: comment.trim() || null,
        }),
      });
      if (!res.ok) {
        showToast(t("rating.sendError"), "error");
        return;
      }
      track("rating_submitted", { prompt_kind: promptKind, stars });
      haptic.success();
      // Stamp a localStorage flag so the parent's organic-eligibility
      // effect (App.jsx) won't re-open the sheet on the next mount.
      // The DB has the row via the upsert PK; this is the client-side
      // mirror so the eligibility predicate has something to read
      // without a server round-trip on every Home mount.
      try { localStorage.setItem(submittedKey(promptKind, userId), "1"); } catch { /* ignore */ }
      setSubmitted(true);
      // Keep the sheet up for ~2.5s on success so the thank-you
      // copy registers; promoter (5★) variant gets a longer window
      // because it surfaces the referral CTA inline.
      const dwell = stars === 5 ? 5000 : 2500;
      setTimeout(() => animatedClose(), dwell);
    } catch {
      showToast(t("rating.sendError"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`sheet-overlay ${exiting ? "sheet-overlay--exit" : ""}`} onClick={dismiss}>
      <div
        ref={setPanel}
        className={`sheet-panel ${exiting ? "sheet-panel--exit" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={t("rating.title")}
        onClick={(e) => e.stopPropagation()}
        {...panelHandlers}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("rating.title")}</span>
          <button
            type="button"
            className="sheet-close"
            onClick={dismiss}
            aria-label={t("close")}>
            <IconX size={14} />
          </button>
        </div>
        <div style={{ padding: "0 20px 28px" }}>
          {submitted ? (
            <div style={{ textAlign: "center", padding: "16px 0 8px" }}>
              <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: "var(--text-lg)", color: "var(--charcoal)", marginBottom: 8 }}>
                {t("rating.thanksTitle")}
              </div>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--charcoal-md)", lineHeight: 1.5, marginBottom: 12 }}>
                {stars === 5 ? t("rating.thanksPromoter") : t("rating.thanksBody")}
              </div>
              {stars === 5 && (
                <a
                  href="/#settings/referral"
                  className="btn btn-primary"
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: "auto", padding: "10px 20px", textDecoration: "none",
                  }}
                  onClick={() => track("rating_promoter_referral_clicked")}>
                  {t("rating.shareReferralCta")}
                </a>
              )}
            </div>
          ) : (
            <>
              <div style={{ fontSize: "var(--text-md)", color: "var(--charcoal)", marginBottom: 18, lineHeight: 1.45 }}>
                {promptCopy}
              </div>

              {/* Star row — five buttons with the IconStar fill swap.
                  Hover (desktop) and active stars share the same
                  fill color so the rating reads identically across
                  input modalities. */}
              <div
                role="radiogroup"
                aria-label={t("rating.starsLabel")}
                style={{ display: "flex", justifyContent: "space-between", gap: 4, marginBottom: 18 }}>
                {STARS.map((n) => {
                  const active = (hover || stars) >= n;
                  return (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={stars === n}
                      aria-label={t("rating.starAria", { n })}
                      onMouseEnter={() => setHover(n)}
                      onMouseLeave={() => setHover(0)}
                      onClick={() => { haptic.tap(); setStars(n); }}
                      style={{
                        flex: 1,
                        background: "transparent",
                        border: "none",
                        padding: "10px 4px",
                        cursor: "pointer",
                        color: active ? "var(--amber, #E8B86C)" : "var(--charcoal-xl)",
                      }}>
                      <IconStar
                        size={36}
                        fill={active ? "currentColor" : "none"}
                        stroke="currentColor"
                      />
                    </button>
                  );
                })}
              </div>

              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={commentRequired ? t("rating.commentPlaceholderRequired") : t("rating.commentPlaceholder")}
                rows={3}
                style={{
                  width: "100%",
                  fontFamily: "var(--font)",
                  fontSize: "var(--text-md)",
                  color: "var(--charcoal)",
                  padding: 12,
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  background: "var(--white)",
                  resize: "vertical",
                  marginBottom: 14,
                  boxSizing: "border-box",
                }}
                maxLength={2000}
              />

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={submit}
                  disabled={busy || stars < 1}
                  style={{ flex: 1 }}>
                  {busy ? t("loading") : t("rating.submit")}
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  disabled={busy}
                  style={{
                    height: 44, padding: "0 16px",
                    fontSize: "var(--text-sm)", fontWeight: 600,
                    background: "transparent", border: "none", cursor: "pointer",
                    color: "var(--charcoal-md)", fontFamily: "var(--font)",
                  }}>
                  {t("rating.dismiss")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

