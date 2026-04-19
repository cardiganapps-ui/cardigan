import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/* ── Service Worker: aggressive update checks for iOS standalone ──
   Pair this with self.skipWaiting() / clients.claim() in sw.js — without
   those, a new SW sits in "waiting" indefinitely and the reload below
   never fires. `updateViaCache: 'none'` stops iOS from serving a cached
   /sw.js from HTTP cache, so `reg.update()` actually hits the network. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    const reg = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });

    // When a new SW takes over, reload to pick up fresh assets
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) { refreshing = true; window.location.reload(); }
    });

    // Check for updates when the app regains focus (iOS standalone wakeup)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update();
    });

    // Safety net: poll every 30 minutes
    setInterval(() => reg.update(), 30 * 60 * 1000);
  });
}
