import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import './index.css'
import App from './App.jsx'
import { initSentry } from './lib/sentry'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './lib/skewProtection'

initSentry()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      {/* Vercel Analytics + Speed Insights — privacy-first by default
          (no cookies, no PII), so they don't trip the LFPDPPP banner.
          Both no-op outside Vercel's production hosting. */}
      <Analytics />
      <SpeedInsights />
    </ErrorBoundary>
  </StrictMode>,
)

/* ── Service Worker: aggressive update checks + opt-in activation ──
   We check for new SWs on every focus and every 30 min, but instead of
   activating them automatically (which would reload mid-action), we
   surface a "Actualización disponible" toast via UpdatePrompt. The
   user taps it → we post {type:'SKIP_WAITING'} to the waiting SW →
   sw.js calls skipWaiting + clients.claim → controllerchange fires →
   we reload. `updateViaCache: 'none'` stops iOS from serving /sw.js
   out of HTTP cache, so reg.update() actually hits the network. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    const reg = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });

    // When a new SW takes over, reload to pick up fresh assets — but
    // only when there was already a controller at page load. On a
    // first-ever visit the SW installs/activates and grabs the tab,
    // which fires controllerchange too; reloading then made the
    // landing page randomly refresh during the user's first sign-in
    // attempt. Returning visits still reload as designed.
    const hadInitialController = !!navigator.serviceWorker.controller;
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadInitialController) return;
      if (!refreshing) { refreshing = true; window.location.reload(); }
    });

    // Announce a waiting SW to the app so it can render the update toast.
    // Only counts as an "update" when there's already a controller — the
    // very first SW install on a fresh visit shouldn't prompt a reload.
    // Idempotent: the announcedSet guards against re-announcing the same
    // SW when multiple listeners fire (e.g. updatefound AND the
    // reg.installing self-check on startup).
    const announcedSet = new WeakSet();
    const announce = (sw) => {
      if (!sw || !navigator.serviceWorker.controller) return;
      if (announcedSet.has(sw)) return;
      announcedSet.add(sw);
      window.dispatchEvent(new CustomEvent('cardigan-update-ready', { detail: sw }));
    };

    // Track a SW through its lifecycle. Idempotent — calling twice for
    // the same SW just re-attaches a listener that fires once on its
    // terminal state; the announcedSet guard above dedupes the event.
    const track = (sw) => {
      if (!sw) return;
      if (sw.state === 'installed') { announce(sw); return; }
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed') announce(sw);
      });
    };

    // Pick up anything we missed: the `updatefound` event fires while
    // `register()` is still pending (before our `.then()` handler runs),
    // so by the time we'd attach a listener it's already too late on
    // some browsers. Read `reg.installing` / `reg.waiting` directly at
    // hydration time — that's the authoritative state.
    const drainState = () => {
      if (reg.waiting) announce(reg.waiting);
      if (reg.installing) track(reg.installing);
    };
    drainState();

    reg.addEventListener('updatefound', () => track(reg.installing));

    // Check for updates when the app regains focus (iOS standalone wakeup).
    // Re-drain afterward — if a prior update check produced a waiting SW
    // that we missed announcing, this recovers it without a reload.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      reg.update().then(drainState).catch(() => {});
    });

    // Safety net: poll every 30 minutes.
    setInterval(() => reg.update().then(drainState).catch(() => {}), 30 * 60 * 1000);
  });
}
