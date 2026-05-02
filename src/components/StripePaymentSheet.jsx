import { useEffect, useRef, useState } from "react";
import { IconX, IconCheck, IconLock } from "./Icons";
import { useT } from "../i18n/index";
import { haptic } from "../utils/haptics";
import { getStripe } from "../lib/stripe";
import { formatMXN } from "../utils/format";

/* ── StripePaymentSheet ───────────────────────────────────────────────
   Native checkout — Stripe Elements `PaymentElement` mounted inside
   our own Cardigan-styled sheet. The user never leaves cardigan.mx
   (except for the optional 3-D Secure browser redirect, which Stripe
   handles automatically and lands back on `return_url`).

   Lifecycle:
     1. Sheet opens. Lazily fetch Stripe.js + create the subscription.
     2. Server returns { client_secret, intent_type }. Mount PaymentElement.
     3. User enters card. On submit, we call the matching confirm method:
        - intent_type = "payment" → stripe.confirmPayment
        - intent_type = "setup"   → stripe.confirmSetup
     4. confirmPayment with `redirect: "if_required"` keeps the flow in
        the page when 3DS isn't needed; only routes off-app for cards
        that require an issuer challenge.
     5. On success we surface a toast and close the sheet. The webhook
        catches up the subscription state in seconds; the hook already
        polls on focus.

   The Elements instance is owned imperatively (not via @stripe/react-
   stripe-js) — we don't ship the React wrapper since we have one form
   and don't need the provider tree. */

const PAYMENT_ELEMENT_NODE_ID = "cardigan-payment-element";

// Cardigan-themed Stripe Elements appearance. The PaymentElement
// inherits these tokens so the card field, postal-code dropdown, and
// any wallet pills blend with the rest of the sheet rather than
// landing as a generic Stripe widget.
const elementsAppearance = {
  theme: "stripe",
  variables: {
    colorPrimary: "#5B9BAF",
    colorText: "#2E2E2E",
    colorTextSecondary: "#555",
    colorBackground: "#FFFFFF",
    colorDanger: "#D96B6B",
    fontFamily: "var(--font, system-ui, -apple-system, sans-serif)",
    fontSizeBase: "15px",
    spacingUnit: "4px",
    borderRadius: "12px",
  },
  rules: {
    ".Input": {
      border: "1px solid #E3DBD1",
      boxShadow: "none",
    },
    ".Input:focus": {
      borderColor: "#5B9BAF",
      boxShadow: "0 0 0 3px rgba(91,155,175,0.13)",
    },
    ".Label": {
      fontWeight: "600",
      fontSize: "13px",
      color: "#555",
    },
    ".Tab": {
      border: "1px solid #E3DBD1",
      boxShadow: "none",
    },
    ".Tab--selected": {
      borderColor: "#5B9BAF",
      boxShadow: "none",
    },
  },
};

// Pricing constants kept in sync with the Stripe Prices behind
// STRIPE_PRICE_ID and STRIPE_PRICE_ID_ANNUAL. If we ever change the
// public price, update these alongside the Stripe dashboard.
const PRICE_MONTHLY_MXN = 299;
const PRICE_ANNUAL_MXN = 2990;

export default function StripePaymentSheet({
  open,
  onClose,
  onSuccess,
  referralCode,
  daysLeftInTrial,
  plan = "monthly",
}) {
  const { t } = useT();
  // Stage state machine — each transitions to the next on success and
  // can fall back to "error" on any failure.
  //   loading → ready → submitting → done
  //                        ↓
  //                       error
  const [stage, setStage] = useState("loading");
  const [error, setError] = useState("");

  const stripeRef = useRef(null);
  const elementsRef = useRef(null);
  const intentTypeRef = useRef(null);
  const clientSecretRef = useRef(null);
  const mountedRef = useRef(false);
  const elementMountedRef = useRef(false);
  const cardEl = useRef(null);

  // Track last "open" id so we can ignore late async results from a
  // previous open cycle (user closes + reopens within 2s).
  const openIdRef = useRef(0);

  useEffect(() => {
    if (!open) {
      mountedRef.current = false;
      return;
    }
    mountedRef.current = true;
    const myOpenId = ++openIdRef.current;
    // Open transition: reset the form to its blank "loading" state.
    // React batches these alongside the parent's `open` flip so no
    // double render occurs in practice.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStage("loading");
    setError("");
    elementMountedRef.current = false;

    (async () => {
      try {
        const [stripe, subResp] = await Promise.all([
          getStripe(),
          fetchCreateSubscription(referralCode, plan),
        ]);
        if (!mountedRef.current || openIdRef.current !== myOpenId) return;

        if (!subResp.ok) {
          setError(subResp.error || t("subscription.errorGeneric"));
          setStage("error");
          return;
        }

        stripeRef.current = stripe;
        clientSecretRef.current = subResp.client_secret;
        intentTypeRef.current = subResp.intent_type;

        const elements = stripe.elements({
          clientSecret: subResp.client_secret,
          appearance: elementsAppearance,
          locale: "es",
        });
        elementsRef.current = elements;
        const paymentElement = elements.create("payment", {
          layout: "tabs",
          fields: { billingDetails: "auto" },
        });
        // Wait until the sheet body is rendered so the mount node
        // exists. requestAnimationFrame guarantees one paint cycle.
        requestAnimationFrame(() => {
          if (!mountedRef.current || openIdRef.current !== myOpenId) return;
          const node = document.getElementById(PAYMENT_ELEMENT_NODE_ID);
          if (!node) {
            setError(t("subscription.errorGeneric"));
            setStage("error");
            return;
          }
          paymentElement.mount(node);
          elementMountedRef.current = true;
          setStage("ready");
        });
      } catch (err) {
        if (!mountedRef.current || openIdRef.current !== myOpenId) return;
        setError(err?.message || t("subscription.errorGeneric"));
        setStage("error");
      }
    })();

    return () => {
      mountedRef.current = false;
      // Tear down Elements so a subsequent open mounts a fresh one
      // bound to a new client_secret. Stripe's destroy() is idempotent.
      try { elementsRef.current?.getElement?.("payment")?.unmount?.(); }
      catch { /* tolerate races */ }
      elementsRef.current = null;
    };
  }, [open, referralCode, plan, t]);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (stage !== "ready") return;
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    const clientSecret = clientSecretRef.current;
    const intentType = intentTypeRef.current;
    if (!stripe || !elements || !clientSecret) return;

    setStage("submitting");
    setError("");

    // Validate the form before sending — Stripe surfaces field-level
    // errors via the PaymentElement's own UI, but submit() also
    // returns an aggregate error if anything's invalid.
    const submitResult = await elements.submit();
    if (submitResult.error) {
      setError(submitResult.error.message || t("subscription.errorGeneric"));
      setStage("ready");
      return;
    }

    // confirmParams.return_url is where Stripe lands the browser after
    // any required redirect (3DS challenge, async wallets). With
    // redirect: "if_required" the call resolves inline when no
    // redirect is needed; otherwise the browser navigates and we pick
    // the result up via the URL parser in App.jsx.
    const returnUrl = `${window.location.origin}/?billing=success`;
    const confirmFn = intentType === "setup" ? stripe.confirmSetup : stripe.confirmPayment;
    const result = await confirmFn.call(stripe, {
      elements,
      clientSecret,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required",
    });

    if (result?.error) {
      // Card declined / incomplete / incorrect CVC etc. all surface
      // here. Stripe's message is already locale-aware (Spanish via
      // `locale: "es"` above).
      setError(result.error.message || t("subscription.errorGeneric"));
      setStage("ready");
      haptic.warn();
      return;
    }

    // Success — sub is active (or will be once Stripe processes
    // overnight async payment methods). Dispatch the same return event
    // the hosted-Checkout return URL does so useSubscription refetches.
    haptic.success();
    setStage("done");
    window.dispatchEvent(new CustomEvent("cardigan-billing-return", { detail: { billing: "success" } }));
    onSuccess?.();
  };

  if (!open) return null;

  const trialAware = typeof daysLeftInTrial === "number" && daysLeftInTrial > 0;

  return (
    <div
      className="sheet-overlay"
      // The Stripe payment sheet must render ABOVE any sheet that
      // launched it (Settings → Suscripción → Suscribirme being the
      // canonical case). All sheets share `--z-sheet`, so without an
      // explicit bump DOM order decides — and the launcher is
      // typically rendered later in the JSX, painting on top. A small
      // +1 keeps us above peer sheets without colliding with the
      // higher-tier overlays (note editor, expediente).
      style={{ zIndex: "calc(var(--z-sheet) + 1)" }}
      onClick={() => stage !== "submitting" && onClose?.()}
    >
      <div
        className="sheet-panel"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{t("payment.title")}</span>
          <button
            className="sheet-close"
            aria-label={t("close")}
            onClick={() => stage !== "submitting" && onClose?.()}
            disabled={stage === "submitting"}
          >
            <IconX size={14} />
          </button>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: "0 20px 22px" }}>
          {/* Summary card — gives the user clarity on what they're
              paying and when. The trial-aware variant explains that no
              charge happens until the trial ends. */}
          <div
            style={{
              padding: "14px 16px",
              borderRadius: "var(--radius-lg, 16px)",
              background: "var(--cream)",
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, color: "var(--charcoal)", fontSize: 15 }}>
                Cardigan Pro
              </div>
              <div style={{ fontSize: 12, color: "var(--charcoal-md)", marginTop: 2, lineHeight: 1.4 }}>
                {trialAware
                  ? t("payment.trialNote", { n: daysLeftInTrial })
                  : t("payment.chargeNowNote")}
              </div>
            </div>
            <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              <div style={{ fontFamily: "var(--font-d)", fontSize: 22, fontWeight: 800, color: "var(--charcoal)", lineHeight: 1 }}>
                {formatMXN((plan === "annual" ? PRICE_ANNUAL_MXN : PRICE_MONTHLY_MXN))}
              </div>
              <div style={{ fontSize: 11, color: "var(--charcoal-md)", marginTop: 2 }}>
                {plan === "annual" ? t("payment.priceUnitAnnual") : t("payment.priceUnitMonthly")}
              </div>
            </div>
          </div>

          {/* Loading skeleton — three placeholder bars roughly matching
              the PaymentElement's card / details / button heights so the
              sheet feels structured during the Stripe.js + create-sub
              roundtrip rather than blank. */}
          {stage === "loading" && (
            <div style={{ padding: "8px 0 18px" }} aria-label={t("payment.preparing")}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="cardigan-skel" style={{ height: 44 }} />
                <div style={{ display: "flex", gap: 12 }}>
                  <div className="cardigan-skel" style={{ height: 44, flex: 2 }} />
                  <div className="cardigan-skel" style={{ height: 44, flex: 1 }} />
                </div>
                <div className="cardigan-skel" style={{ height: 44 }} />
              </div>
              <div style={{ fontSize: 12, color: "var(--charcoal-md)", marginTop: 14, textAlign: "center" }}>
                {t("payment.preparing")}
              </div>
              <style>{`
                .cardigan-skel {
                  border-radius: 12px;
                  background: linear-gradient(90deg, var(--cream-deeper, #EFE7DA) 0%, var(--cream, #F8F1E5) 50%, var(--cream-deeper, #EFE7DA) 100%);
                  background-size: 200% 100%;
                  animation: cardigan-shimmer 1.4s ease-in-out infinite;
                }
                @keyframes cardigan-shimmer {
                  0% { background-position: 100% 0; }
                  100% { background-position: -100% 0; }
                }
                @media (prefers-reduced-motion: reduce) {
                  .cardigan-skel { animation: none; }
                }
              `}</style>
            </div>
          )}

          {/* The PaymentElement mounts here once the client_secret is ready. */}
          <div
            id={PAYMENT_ELEMENT_NODE_ID}
            ref={cardEl}
            style={{
              minHeight: stage === "loading" || stage === "error" ? 0 : 200,
              display: stage === "loading" || stage === "error" ? "none" : "block",
              marginBottom: 14,
            }}
          />

          {/* Error surface */}
          {error && (
            <div
              style={{
                fontSize: 13,
                color: "var(--red)",
                background: "var(--red-bg)",
                padding: "10px 12px",
                borderRadius: "var(--radius)",
                marginBottom: 12,
                lineHeight: 1.45,
              }}
            >
              {error}
            </div>
          )}

          {/* Trust strip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "var(--charcoal-xl)",
              marginBottom: 12,
              justifyContent: "center",
            }}
          >
            <IconLock size={12} />
            <span>{t("payment.trustNote")}</span>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={stage !== "ready"}
            style={{ marginBottom: 8 }}
          >
            {stage === "submitting"
              ? t("payment.processing")
              : stage === "done"
                ? t("payment.done")
                : trialAware
                  ? t("payment.confirmTrialCta")
                  : t("payment.confirmChargeCta")}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onClose?.()}
            disabled={stage === "submitting"}
          >
            {t("cancel")}
          </button>

          {/* Inline-success microcopy after we get the post-confirm
              ack (very brief — the parent closes the sheet). */}
          {stage === "done" && (
            <div
              style={{
                marginTop: 14,
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "var(--green)",
                fontSize: 13,
                fontWeight: 700,
                justifyContent: "center",
              }}
            >
              <IconCheck size={14} />
              <span>{t("payment.successInline")}</span>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

async function fetchCreateSubscription(referralCode, plan) {
  // Pull the JWT from the Supabase session at call time — keeps this
  // helper decoupled from the broader supabase singleton import path.
  const { supabase } = await import("../supabaseClient");
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { ok: false, error: "Not signed in" };

  const payload = {};
  if (referralCode) payload.referral_code = referralCode;
  if (plan === "annual") payload.plan = "annual";
  const res = await fetch("/api/stripe-create-subscription", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: json.error || `HTTP ${res.status}` };
  return {
    ok: true,
    client_secret: json.client_secret,
    intent_type: json.intent_type,
    subscription_id: json.subscription_id,
  };
}
