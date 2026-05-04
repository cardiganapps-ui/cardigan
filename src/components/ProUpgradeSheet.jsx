import { useEffect, useState, lazy, Suspense } from "react";
import { IconX, IconSparkle, IconLock, IconCalendar, IconDocument } from "./Icons";
import { useT } from "../i18n/index";
import { haptic } from "../utils/haptics";
import { useCardigan } from "../context/CardiganContext";

const StripePaymentSheet = lazy(() => import("./StripePaymentSheet"));

/* ── ProUpgradeSheet ──────────────────────────────────────────────────
   Soft, premium-feeling prompt that appears whenever a non-Pro user
   tries to use a Pro-gated feature (document uploads, note encryption,
   calendar sync). Open the sheet via the `useProGate` helper rather
   than mounting it directly — the helper centralizes the open/close
   state and lets every call site stay terse.

   Tone: friendly, not pushy. The headline names the feature so the
   user understands exactly what they're upgrading to unlock; the
   body lists the broader Cardigan Pro value so the upsell isn't
   feature-gated tunnel-vision.

   The "Suscribirme" CTA opens the same StripePaymentSheet the welcome
   modal uses — keeping the conversion path in one place. */

const FEATURE_ICON = {
  documents: IconDocument,
  encryption: IconLock,
  calendar: IconCalendar,
  cardi: IconSparkle,
  default: IconSparkle,
};

export function ProUpgradeSheet({ open, feature, onClose }) {
  const { t } = useT();
  const { subscription } = useCardigan();
  const [paymentOpen, setPaymentOpen] = useState(false);

  // Tracks the entrance animation so the sheet glides in instead of
  // popping. Same pattern as SubscriptionWelcome.
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

  const Icon = FEATURE_ICON[feature] || FEATURE_ICON.default;
  const featureKey = feature && FEATURE_ICON[feature] ? feature : "default";

  const handleSubscribe = () => {
    haptic.tap();
    setPaymentOpen(true);
  };

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pro-upgrade-title"
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.55)",
          display: "flex", alignItems: "flex-end", justifyContent: "center",
          zIndex: 670,
          opacity: mounted ? 1 : 0,
          transition: "opacity 0.28s ease",
        }}
        onClick={() => onClose?.()}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "var(--white)",
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            width: "100%",
            maxWidth: 480,
            paddingBottom: "calc(20px + env(safe-area-inset-bottom))",
            transform: mounted ? "translateY(0)" : "translateY(28px)",
            transition: "transform 0.42s cubic-bezier(0.34, 1.56, 0.64, 1)",
            overflow: "hidden",
            boxShadow: "0 -10px 40px rgba(0,0,0,0.18)",
          }}
        >
          {/* Drag handle so the sheet feels like the rest of Settings. */}
          <div style={{
            width: 40, height: 4, borderRadius: 100,
            background: "var(--cream-deeper)",
            margin: "10px auto 0",
          }} />

          {/* Hero strip — subtle gradient + the feature's icon nested
              inside a Cardigan sparkle to communicate "this is part of
              Cardigan Pro". */}
          <div style={{
            position: "relative",
            background: "linear-gradient(160deg, var(--teal-pale) 0%, var(--cream) 100%)",
            padding: "26px 24px 22px",
            textAlign: "center",
          }}>
            <button
              type="button"
              onClick={() => onClose?.()}
              aria-label={t("close")}
              style={{
                position: "absolute", top: 12, right: 12,
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
            <div style={{
              position: "relative",
              width: 64, height: 64, borderRadius: "50%",
              background: "var(--white)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 12px",
              color: "var(--teal-dark)",
              boxShadow: "0 6px 18px rgba(91,155,175,0.22)",
            }}>
              <Icon size={26} />
              {/* Pro badge cornering the icon — visible cue of where
                  this feature lives. */}
              <div style={{
                position: "absolute", bottom: -4, right: -4,
                background: "var(--charcoal)", color: "var(--white)",
                fontSize: 9, fontWeight: 800, letterSpacing: "0.08em",
                padding: "3px 7px", borderRadius: 999,
                boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
              }}>PRO</div>
            </div>
            <div style={{
              display: "inline-block",
              padding: "3px 10px", borderRadius: 999,
              background: "var(--white)",
              fontSize: 10, fontWeight: 800, letterSpacing: "0.08em",
              textTransform: "uppercase", color: "var(--teal-dark)",
              marginBottom: 10,
            }}>
              {t("pro.eyebrow")}
            </div>
            <div
              id="pro-upgrade-title"
              style={{
                fontFamily: "var(--font-d)", fontSize: 22, fontWeight: 800,
                color: "var(--charcoal)", letterSpacing: "-0.4px",
                lineHeight: 1.2, marginBottom: 6,
              }}
            >
              {t(`pro.${featureKey}.title`)}
            </div>
            <div style={{
              fontSize: 14, color: "var(--charcoal-md)",
              lineHeight: 1.5, maxWidth: 340, margin: "0 auto",
            }}>
              {t(`pro.${featureKey}.body`)}
            </div>
          </div>

          {/* Price + CTA section */}
          <div style={{ padding: "18px 22px 4px" }}>
            <div style={{
              padding: "10px 14px",
              background: "var(--cream)",
              borderRadius: "var(--radius)",
              marginBottom: 12,
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 8,
            }}>
              <div style={{ fontSize: 12, color: "var(--charcoal-md)", lineHeight: 1.4 }}>
                {t("pro.priceNote")}
              </div>
              <div style={{
                fontFamily: "var(--font-d)", fontSize: 17, fontWeight: 800,
                color: "var(--charcoal)", whiteSpace: "nowrap",
              }}>
                $299 <span style={{ fontSize: 11, fontWeight: 600, color: "var(--charcoal-md)" }}>MXN/mes</span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSubscribe}
              >
                {t("pro.subscribeCta")}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => onClose?.()}
              >
                {t("pro.dismissCta")}
              </button>
            </div>
            <div style={{
              fontSize: 11, color: "var(--charcoal-xl)",
              textAlign: "center", marginTop: 12, lineHeight: 1.4,
            }}>
              {t("pro.footer")}
            </div>
          </div>
        </div>
      </div>

      <Suspense fallback={null}>
        {paymentOpen && (
          <StripePaymentSheet
            open={paymentOpen}
            daysLeftInTrial={subscription?.daysLeftInTrial}
            onClose={() => setPaymentOpen(false)}
            onSuccess={() => {
              setPaymentOpen(false);
              onClose?.();
            }}
          />
        )}
      </Suspense>
    </>
  );
}
