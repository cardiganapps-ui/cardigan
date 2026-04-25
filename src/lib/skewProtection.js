/* ── Vercel Skew Protection (client-side glue) ──────────────────────
   When the user's tab loaded build A but Vercel has since promoted
   build B, an in-flight call to /api/* would otherwise hit the new
   API surface — which can have a different request shape, a different
   error contract, or new required fields. Skew Protection keeps build
   A's serverless functions live for ~24h after a new deploy; this
   wrapper opts our fetches into that mechanism by attaching the build
   identifier to every same-origin /api/* request.

   Vercel routes the request based on either an `?dpl=<id>` query
   param OR an `x-deployment-id` header. We send the header — the URL
   stays clean for logs, ad-hoc curl tests, and any cache keying.

   The deployment ID is baked in at build time via vite.config.js's
   `define` (reading `process.env.VERCEL_DEPLOYMENT_ID`). On dev or in
   environments where the var isn't set, the wrapper is a no-op —
   nothing gets added. */

const DEPLOYMENT_ID = typeof __VERCEL_DEPLOYMENT_ID__ === 'string' ? __VERCEL_DEPLOYMENT_ID__ : '';

if (DEPLOYMENT_ID && typeof window !== 'undefined' && typeof window.fetch === 'function') {
  const originalFetch = window.fetch.bind(window);

  window.fetch = function patchedFetch(input, init) {
    let url;
    try {
      url = typeof input === 'string'
        ? input
        : input instanceof URL ? input.href
        : input?.url;
    } catch { url = null; }

    // Only stamp same-origin /api/* requests. Calls to Supabase, R2,
    // or anything else cross-origin must remain untouched — they'd
    // reject the unknown header (CORS preflight cost) and we'd add
    // latency for zero benefit.
    let isApiCall = false;
    if (typeof url === 'string') {
      if (url.startsWith('/api/')) {
        isApiCall = true;
      } else {
        try {
          const parsed = new URL(url, window.location.origin);
          isApiCall = parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/');
        } catch { /* opaque URL — skip */ }
      }
    }

    if (!isApiCall) return originalFetch(input, init);

    // Merge our header without clobbering caller-set headers. The
    // Headers constructor accepts Headers, plain object, or array of
    // pairs; we feed it whatever the caller gave us and `set` on top.
    const headers = new Headers(init?.headers || (typeof input === 'object' && input?.headers) || undefined);
    if (!headers.has('x-deployment-id')) {
      headers.set('x-deployment-id', DEPLOYMENT_ID);
    }
    return originalFetch(input, { ...(init || {}), headers });
  };
}
