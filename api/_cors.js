/* ── CORS for the native shell ──────────────────────────────────────────
   The web app calls /api/* same-origin to cardigan.mx — no CORS involved.
   The Capacitor app's WebView origin is a custom scheme
   (capacitor://localhost on iOS, http(s)://localhost on Android), and its
   /api calls are rewritten to https://cardigan.mx by src/lib/nativeFetch.js
   — so they are CROSS-ORIGIN. Any request carrying an Authorization header
   (or the skew-protection `x-deployment-id` header) is a non-simple
   request, so the browser fires a CORS preflight OPTIONS first. Without
   these response headers + an OPTIONS short-circuit, the preflight 401s and
   the real request never fires — which is why calendar sync (and any other
   /api feature: push subscribe, Stripe, export, encryption…) silently
   failed inside the native app while working fine on the web.

   Auth is still enforced by each handler's own JWT / signature check, so
   CORS is NOT the security boundary here — we only need cross-origin native
   fetches to succeed. We reflect an allow-listed origin: our own web
   domains + Vercel previews, and any native custom-scheme origin pointing
   at localhost (capacitor://localhost, ionic://localhost, …) so it works
   regardless of the exact scheme the OS/WebView reports. */

const STATIC_ALLOWED = new Set([
  "capacitor://localhost", // iOS Capacitor WebView
  "ionic://localhost",     // legacy Ionic scheme
  "http://localhost",      // Android Capacitor / local dev
  "https://localhost",     // Android Capacitor (https scheme)
  "https://cardigan.mx",
  "https://www.cardigan.mx",
]);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (STATIC_ALLOWED.has(origin)) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    // Web: only our own domains + Vercel preview deployments.
    if (protocol === "https:" &&
        (hostname === "cardigan.mx" || hostname.endsWith(".cardigan.mx") || hostname.endsWith(".vercel.app"))) {
      return true;
    }
    // Native shells use a non-web scheme pointing at localhost.
    if (protocol !== "http:" && protocol !== "https:" && hostname === "localhost") return true;
  } catch { /* not a parseable URL — fall through */ }
  return false;
}

// Sets CORS response headers. Returns true if the request is a preflight
// (OPTIONS) that the caller should answer with a 204 and stop.
export function applyCors(req, res) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, x-deployment-id");
  res.setHeader("Access-Control-Max-Age", "86400");
  return req.method === "OPTIONS";
}
