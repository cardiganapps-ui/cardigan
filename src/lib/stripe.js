/* ── Stripe.js lazy loader ────────────────────────────────────────────
   Stripe.js is ~50 KB compressed and only ever loaded when the user
   actually opens the payment sheet. We load it at runtime via a one-
   shot script tag injection — pulling in `@stripe/stripe-js` would
   add a wrapper layer and a build-time dep we don't need for a single
   call site.

   Returns a Promise that resolves to the global `Stripe` constructor
   once the script has loaded, then memoizes for subsequent calls so
   reopening the sheet doesn't re-fetch the bundle.

   The publishable key is build-time — VITE_STRIPE_PUBLISHABLE_KEY in
   Vercel env (live in Production, test in Preview/Development). Keys
   are public by design, so VITE_ exposure is correct. */

const STRIPE_JS_URL = "https://js.stripe.com/v3/";

let scriptPromise = null;

function loadScript() {
  if (scriptPromise) return scriptPromise;
  // SSR safety — should never run server-side, but bail cleanly anyway.
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Stripe.js can only load in the browser"));
  }
  // The CDN may already have a script tag injected (HMR, double-mount).
  // Reuse the existing global if present.
  if (window.Stripe) {
    scriptPromise = Promise.resolve(window.Stripe);
    return scriptPromise;
  }
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = STRIPE_JS_URL;
    script.async = true;
    script.onload = () => {
      if (window.Stripe) resolve(window.Stripe);
      else reject(new Error("Stripe.js loaded but window.Stripe is undefined"));
    };
    script.onerror = () => reject(new Error("Failed to load Stripe.js"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

let stripeInstancePromise = null;

export function getStripe() {
  if (stripeInstancePromise) return stripeInstancePromise;
  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
  if (!key) {
    return Promise.reject(new Error("VITE_STRIPE_PUBLISHABLE_KEY not configured"));
  }
  stripeInstancePromise = loadScript().then((Stripe) => Stripe(key));
  return stripeInstancePromise;
}
