// Cross-platform API base. Web bundles fetch /api/* as a relative path
// — same-origin to cardigan.mx, no rewrite needed. Inside the Capacitor
// WebView the document origin is `capacitor://localhost`, so a bare
// /api/foo resolves to `capacitor://localhost/api/foo` which doesn't
// exist. Every server-backed feature (calendar sync, push subscribe,
// Stripe checkout / portal / Connect, invite-link generation, push test,
// patient-claim, encryption setup, export, account delete) silently
// fails on native without this.
//
// This wrapper patches window.fetch to prepend the production API host
// to any string-typed /api/* URL when the runtime detects a native
// platform. URL-typed inputs (already absolute) pass through untouched,
// as do non-/api/ paths.
//
// Composes cleanly with skewProtection.js — that wrapper's URL inspector
// reads the input AFTER we've rewritten it, so the `x-deployment-id`
// header still attaches as expected.

import { isNative } from "./platform";

const API_ORIGIN = "https://cardigan.mx";

if (typeof window !== "undefined" && typeof window.fetch === "function") {
  const original = window.fetch.bind(window);

  window.fetch = function nativeRewriteFetch(input, init) {
    if (!isNative()) return original(input, init);
    if (typeof input !== "string") return original(input, init);
    // Only rewrite same-origin /api/* paths. Anything absolute already
    // points where it should (Supabase, R2, Stripe, Sentry, etc.).
    if (!input.startsWith("/api/")) return original(input, init);
    return original(API_ORIGIN + input, init);
  };
}
