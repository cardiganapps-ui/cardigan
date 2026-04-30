import { useEffect, useState } from "react";
import { IconSparkle, IconCheck, IconX } from "./Icons";
import { useT } from "../i18n/index";
import { haptic } from "../utils/haptics";

/* ── SubscriptionWelcome ──────────────────────────────────────────────
   First-run prompt shown right after the new user finishes (or
   dismisses) the tutorial. Frames the 30-day trial as a gift and gives
   the user a clean choice: keep using the trial, or subscribe right
   now. We never block app access — closing the modal drops the user
   into the app on their natural trial.

   Persistence:
     - localStorage key `cardigan.welcomePro.shown.v1.<userId>` keeps
       the prompt one-shot per account. Once dismissed (any way) it
       never reappears.

   Visibility rules (decided in App.jsx, not here):
     - subscription.accessState === "trial" — already-subscribed and
       comp-granted users have nothing to gain from this prompt.
     - tutorial.state === "done" — never compete with the tutorial.
     - Not already shown for this user (localStorage check). */
export default function SubscriptionWelcome({
  daysLeftInTrial,
  onSubscribe,
  onContinue,
}) {
  const { t } = useT();
  const [submitting, setSubmitting] = useState(false);

  // Honor reduce-motion: skip the slide-in animation. Mounted-flag
  // pattern matches how Toast and the Tutorial overlay handle entrance.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const handleSubscribe = async () => {
    if (submitting) return;
    setSubmitting(true);
    haptic.tap();
    try { await onSubscribe?.(); }
    finally { setSubmitting(false); }
  };

  const handleContinue = () => {
    haptic.tap();
    onContinue?.();
  };

  const days = typeof daysLeftInTrial === "number" && daysLeftInTrial > 0
    ? daysLeftInTrial
    : 30;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sub-welcome-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 660,
        padding: 16,
        paddingBottom: "calc(16px + env(safe-area-inset-bottom))",
        opacity: mounted ? 1 : 0,
        transition: "opacity 0.32s ease",
      }}
    >
      <div
        style={{
          background: "var(--white)",
          borderRadius: "var(--radius-lg, 16px)",
          maxWidth: 440,
          width: "100%",
          boxShadow: "0 16px 48px rgba(0, 0, 0, 0.22)",
          overflow: "hidden",
          transform: mounted ? "translateY(0) scale(1)" : "translateY(18px) scale(0.98)",
          transition: "transform 0.42s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        {/* Hero strip — soft teal gradient with the brand sparkle. The
            ::before-style accent line at the bottom delineates the
            hero from the body without an obvious border. */}
        <div
          style={{
            position: "relative",
            background: "linear-gradient(160deg, var(--teal-pale) 0%, var(--cream) 100%)",
            padding: "32px 24px 28px",
            textAlign: "center",
          }}
        >
          <button
            type="button"
            onClick={handleContinue}
            aria-label={t("close")}
            style={{
              position: "absolute", top: 14, right: 14,
              width: 32, height: 32, borderRadius: 999,
              background: "rgba(255,255,255,0.7)",
              border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--charcoal-md)",
              backdropFilter: "blur(6px)",
            }}
          >
            <IconX size={14} />
          </button>
          <div
            style={{
              width: 64, height: 64, borderRadius: "50%",
              background: "var(--white)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 14px",
              color: "var(--teal-dark)",
              boxShadow: "0 6px 18px rgba(91,155,175,0.22)",
            }}
          >
            <IconSparkle size={28} />
          </div>
          <div
            style={{
              display: "inline-block",
              padding: "4px 12px", borderRadius: 999,
              background: "var(--white)",
              fontSize: 11, fontWeight: 800, letterSpacing: "0.08em",
              textTransform: "uppercase", color: "var(--teal-dark)",
              marginBottom: 12,
            }}
          >
            {t("subscriptionWelcome.eyebrow")}
          </div>
          <div
            id="sub-welcome-title"
            style={{
              fontFamily: "var(--font-d)", fontSize: 26, fontWeight: 800,
              color: "var(--charcoal)", letterSpacing: "-0.5px", lineHeight: 1.15,
              marginBottom: 6,
            }}
          >
            {t("subscriptionWelcome.title", { n: days })}
          </div>
          <div
            style={{
              fontSize: 14, color: "var(--charcoal-md)", lineHeight: 1.5,
              maxWidth: 340, margin: "0 auto",
            }}
          >
            {t("subscriptionWelcome.subtitle")}
          </div>
        </div>

        {/* Body — feature checklist + price + CTAs. Padding is generous
            on mobile and tightens slightly via safe-area below. */}
        <div style={{ padding: "20px 22px 22px" }}>
          <ul
            style={{
              listStyle: "none", margin: 0, padding: 0,
              display: "flex", flexDirection: "column", gap: 10,
              marginBottom: 18,
            }}
          >
            {[
              t("subscriptionWelcome.feature1"),
              t("subscriptionWelcome.feature2"),
              t("subscriptionWelcome.feature3"),
            ].map((label, i) => (
              <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span
                  style={{
                    flexShrink: 0,
                    width: 22, height: 22, borderRadius: "50%",
                    background: "var(--green-bg)", color: "var(--green)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    marginTop: 1,
                  }}
                >
                  <IconCheck size={12} />
                </span>
                <span style={{ fontSize: 14, color: "var(--charcoal)", lineHeight: 1.45 }}>
                  {label}
                </span>
              </li>
            ))}
          </ul>

          {/* Price line — small, honest, friendly. Not a hard sell. */}
          <div
            style={{
              padding: "10px 14px",
              background: "var(--cream)",
              borderRadius: "var(--radius)",
              marginBottom: 14,
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 13, color: "var(--charcoal-md)", lineHeight: 1.4 }}>
              {t("subscriptionWelcome.priceNote")}
            </div>
            <div
              style={{
                fontFamily: "var(--font-d)", fontSize: 16, fontWeight: 800,
                color: "var(--charcoal)", whiteSpace: "nowrap",
              }}
            >
              $299 <span style={{ fontSize: 11, fontWeight: 600, color: "var(--charcoal-md)" }}>MXN/mes</span>
            </div>
          </div>

          {/* CTAs — primary is the friendly trial path; subscribing now
              is the secondary action. The framing is "you're already in,
              keep going" rather than "give us your card to start." */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleContinue}
              disabled={submitting}
            >
              {t("subscriptionWelcome.continueCta")}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleSubscribe}
              disabled={submitting}
            >
              {submitting ? t("loading") : t("subscriptionWelcome.subscribeCta")}
            </button>
          </div>
          <div style={{ fontSize: 11, color: "var(--charcoal-xl)", textAlign: "center", marginTop: 12, lineHeight: 1.4 }}>
            {t("subscriptionWelcome.footer")}
          </div>
        </div>
      </div>
    </div>
  );
}
