import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
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
    const announce = (sw) => {
      if (!sw || !navigator.serviceWorker.controller) return;
      window.dispatchEvent(new CustomEvent('cardigan-update-ready', { detail: sw }));
    };
    if (reg.waiting) announce(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed') announce(sw);
      });
    });

    // Check for updates when the app regains focus (iOS standalone wakeup)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update();
    });

    // Safety net: poll every 30 minutes
    setInterval(() => reg.update(), 30 * 60 * 1000);
  });
}
