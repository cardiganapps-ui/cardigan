/* ── Monetization kill-switch ─────────────────────────────────────────
   Master flag for ALL therapist-facing paid-subscription surfaces
   ("Cardigan Pro", the 30-day trial, Stripe checkout/portal, referral
   rewards, pricing copy).

   false → Cardigan is FULLY FREE. Every user gets full access with no
           trial, no expiry, no Pro gate, and there is NO purchase path
           or pricing mention anywhere in the app. This is what App
           Review requires (Guideline 3.1.1): an iOS app may not sell a
           subscription outside In-App Purchase, so until/unless we add
           StoreKit IAP, the subscription simply does not exist in the
           product.

   To re-enable monetization later: flip this to true. The hook restores
   the real trial/Pro gating and every gated surface (Drawer plan card,
   Settings → Suscripción + Invita, landing pricing) reappears. The
   Stripe backend, DB tables, and webhooks were never removed — they sit
   dormant — so re-enabling is a one-line change here plus shipping the
   IAP/StoreKit flow that 3.1.1 actually requires.

   Server endpoints (api/stripe-*) stay live but are unreachable from the
   UI while this is false. */
export const MONETIZATION_ENABLED = false;
