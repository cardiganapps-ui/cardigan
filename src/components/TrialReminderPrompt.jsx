import { useEffect, useState } from "react";
import { IconX, IconSparkle, IconCheck } from "./Icons";
import { useT } from "../i18n/index";
import { haptic } from "../utils/haptics";

/* ── TrialReminderPrompt ──────────────────────────────────────────────
   Shown once per day on log-in when the user is on the natural trial
   and has 15 / 10 / 5 / 3 / 2 / 1 days remaining. Friendly nudge to
   subscribe — explicitly reminding them they keep the rest of their
   trial AND get Pro features instantly.

   Gating + dedupe live in the parent (App.jsx). This component is
   render-only — it expects `open` to already account for accessState,
   the daysLeft threshold, and the once-per-day localStorage key. */

const TIER_KEYS = {
  15: { tone: "soft",    icon: IconSparkle },
  10: { tone: "soft",    icon: IconSparkle },
  5:  { tone: "warm",    icon: IconSparkle },
  3:  { tone: "warm",    icon: IconSparkle },
  2:  { tone: "urgent",  icon: IconSparkle },
  1:  { tone: "urgent",  icon: IconSparkle },
};

export default function TrialReminderPrompt({
  open,
  daysLeft,
  onSubscribe,
  onDismiss,
}) {
  const { t } = useT();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(false);
      return;
    }
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  if (!open) return null;

  const tier = TIER_KEYS[daysLeft] || TIER_KEYS[15];
  const tone = tier.tone;
  const Icon = tier.icon;

  const heroBackground = tone === "urgent"
    ? "linear-gradient(160deg, var(--amber-bg) 0%, var(--cream) 100%)"
    : tone === "warm"
      ? "linear-gradient(160deg, var(--cream) 0%, var(--teal-pale) 100%)"
      : "linear-gradient(160deg, var(--teal-pale) 0%, var(--cream) 100%)";

  const accentColor = tone === "urgent" ? "var(--amber)" : "var(--teal-dark)";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-reminder-title"
      onClick={onDismiss}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 665,
        padding: 16,
        paddingBottom: "calc(16px + env(safe-area-inset-bottom))",
        opacity: mounted ? 1 : 0,
        transition: "opacity 0.32s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--white)",
          borderRadius: "var(--radius-lg, 16px)",
          maxWidth: 420,
          width: "100%",
          boxShadow: "0 16px 48px rgba(0,0,0,0.22)",
          overflow: "hidden",
          transform: mounted ? "translateY(0) scale(1)" : "translateY(18px) scale(0.98)",
          transition: "transform 0.42s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        <div style={{
          position: "relative",
          background: heroBackground,
          padding: "30px 24px 24px",
          textAlign: "center",
        }}>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t("close")}
            style={{
              position: "absolute", top: 14, right: 14,
              width: 32, height: 32, borderRadius: 999,
              background: "rgba(255,255,255,0.7)",
              border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--charcoal-md)",
            }}
          >
            <IconX size={14} />
          </button>
          <div style={{
            width: 60, height: 60, borderRadius: "50%",
            background: "var(--white)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 14px",
            color: accentColor,
            boxShadow: "0 6px 18px rgba(0,0,0,0.10)",
          }}>
            <Icon size={26} />
          </div>
          <div style={{
            display: "inline-block",
            padding: "4px 12px", borderRadius: 999,
            background: "var(--white)",
            fontSize: 11, fontWeight: 800, letterSpacing: "0.08em",
            textTransform: "uppercase", color: accentColor,
            marginBottom: 12,
          }}>
            {t("trialReminder.eyebrow")}
          </div>
          <div
            id="trial-reminder-title"
            style={{
              fontFamily: "var(--font-d)", fontSize: 24, fontWeight: 800,
              color: "var(--charcoal)", letterSpacing: "-0.4px",
              lineHeight: 1.2, marginBottom: 6,
            }}
          >
            {daysLeft === 1
              ? t("trialReminder.titleOne")
              : t("trialReminder.title", { n: daysLeft })}
          </div>
          <div style={{
            fontSize: 14, color: "var(--charcoal-md)",
            lineHeight: 1.5, maxWidth: 340, margin: "0 auto",
          }}>
            {t("trialReminder.body")}
          </div>
        </div>

        <div style={{ padding: "18px 22px 22px" }}>
          {/* Reassurance bullets — explicit promise that subscribing
              now doesn't waste their remaining trial days. This is the
              most common objection at this gate. */}
          <ul style={{
            listStyle: "none", margin: 0, padding: 0,
            display: "flex", flexDirection: "column", gap: 10,
            marginBottom: 16,
          }}>
            {[
              t("trialReminder.reassure1", { n: daysLeft }),
              t("trialReminder.reassure2"),
              t("trialReminder.reassure3"),
            ].map((label, i) => (
              <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={{
                  flexShrink: 0,
                  width: 22, height: 22, borderRadius: "50%",
                  background: "var(--green-bg)", color: "var(--green)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  marginTop: 1,
                }}>
                  <IconCheck size={12} />
                </span>
                <span style={{ fontSize: 13.5, color: "var(--charcoal)", lineHeight: 1.45 }}>
                  {label}
                </span>
              </li>
            ))}
          </ul>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => { haptic.tap(); onSubscribe?.(); }}
            >
              {t("trialReminder.subscribeCta")}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => { haptic.tap(); onDismiss?.(); }}
            >
              {t("trialReminder.dismissCta")}
            </button>
          </div>
          <div style={{
            fontSize: 11, color: "var(--charcoal-xl)",
            textAlign: "center", marginTop: 12, lineHeight: 1.4,
          }}>
            {t("trialReminder.footer")}
          </div>
        </div>
      </div>
    </div>
  );
}
