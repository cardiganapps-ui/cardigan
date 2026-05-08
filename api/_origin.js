/* ── _origin.js — safe app-origin resolution ──────────────────────
   The `Origin` request header is attacker-controllable from any
   non-browser client. Trusting it unfiltered to build redirect URLs
   (Stripe success_url, Connect return_url, etc.) opens a textbook
   Open Redirect: a request with `Origin: https://attacker.com` makes
   us hand Stripe a redirect URL that bounces the user to the
   attacker's domain after Checkout. Stripe Checkout doesn't
   independently validate redirect domains.

   This helper centralizes the allowlist so every endpoint that
   builds a return URL gets the same gate. We accept:

     • cardigan.mx (apex production domain)
     • *.cardigan.mx (future subdomains; not used today)
     • *.vercel.app (preview deployments; the team uses these for
       PR previews and stripe-test flows)
     • http://localhost:* and http://127.0.0.1:* (dev server)

   Anything else collapses to the canonical production domain. We
   prefer Origin over Referer because Origin is the spec-blessed
   identifier for the requesting site; Referer can carry extra path
   data we don't want to round-trip. */

const CANONICAL = "https://cardigan.mx";

function isAllowedOrigin(originHeader) {
  if (!originHeader || typeof originHeader !== "string") return false;
  let url;
  try {
    url = new URL(originHeader);
  } catch {
    return false;
  }
  const host = url.host.toLowerCase();
  // Production + subdomains.
  if (host === "cardigan.mx" || host.endsWith(".cardigan.mx")) {
    // Force https. Stripe redirects must always be https in production.
    return url.protocol === "https:";
  }
  // Vercel preview deployments. The hostname pattern
  // `<project>-<hash>-<team>.vercel.app` is generated; we just check
  // the suffix.
  if (host.endsWith(".vercel.app")) {
    return url.protocol === "https:";
  }
  // Dev servers — both vite (5173) and any random port. Localhost is
  // private to the developer's machine, so http is fine.
  if (host === "localhost" || host.startsWith("localhost:")) {
    return url.protocol === "http:" || url.protocol === "https:";
  }
  if (host === "127.0.0.1" || host.startsWith("127.0.0.1:")) {
    return url.protocol === "http:" || url.protocol === "https:";
  }
  return false;
}

/* Resolve a safe `<protocol>//<host>` base for the current request.
   Pass `req` and we'll inspect Origin first, then Referer, then fall
   back to the canonical domain. The returned string never has a
   trailing slash — callers append paths directly. */
export function safeAppOrigin(req) {
  const candidates = [req?.headers?.origin, req?.headers?.referer];
  for (const c of candidates) {
    if (!c) continue;
    if (!isAllowedOrigin(c)) continue;
    try {
      const u = new URL(c);
      return `${u.protocol}//${u.host}`;
    } catch {
      // ignore — fall through
    }
  }
  return CANONICAL;
}

// Exposed for tests.
export { isAllowedOrigin };
