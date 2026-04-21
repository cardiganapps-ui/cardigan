/* ── Cardigan Service Worker ──
   Custom SW using injectManifest strategy.
   Handles: Workbox precaching, runtime caching, push notifications. */

import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkFirst, CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { getPushState, putPushState } from "./pushStore.js";

// ── Precache manifest (injected by vite-plugin-pwa at build time) ──
precacheAndRoute(self.__WB_MANIFEST);

// ── Update lifecycle ──
// New SWs stay in "waiting" state until the user explicitly opts in
// via the UpdatePrompt toast — clicking it posts {type:"SKIP_WAITING"}
// which calls skipWaiting() below. clients.claim() in activate then
// takes over all open tabs, which fires `controllerchange` on each
// client and triggers the reload wired up in main.jsx.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ── Runtime caching (replicated from previous generateSW config) ──

// Supabase API — network-first with short-lived cache fallback
registerRoute(
  /^https:\/\/axyuqfkmifcaupwhzfuw\.supabase\.co\/.*/i,
  new NetworkFirst({
    cacheName: "supabase-api",
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 })],
  })
);

// Google Fonts stylesheets — cache-first, long-lived
registerRoute(
  /^https:\/\/fonts\.googleapis\.com\/.*/i,
  new CacheFirst({
    cacheName: "google-fonts-stylesheets",
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  })
);

// Google Fonts webfonts — cache-first, long-lived
registerRoute(
  /^https:\/\/fonts\.gstatic\.com\/.*/i,
  new CacheFirst({
    cacheName: "google-fonts-webfonts",
    plugins: [
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  })
);

// ── Push notification handler ──
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {
    data = { title: "Cardigan", body: event.data?.text() || "" };
  }

  const title = data.title || "Cardigan";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click — focus existing window or open new one ──
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ── Push subscription change — auto-resubscribe on expiry ──
// The SW has no Supabase session, so /api/push-subscribe (JWT-gated)
// is unreachable from here. Instead we call /api/push-resubscribe and
// authenticate with the one-shot token stashed in IDB at subscribe
// time. If the IDB pair is missing (first install on a new device, or
// post-storage-clear), we silently drop — the mount-time reconciliation
// in useNotifications.js will rebuild from scratch on the next app open.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    try {
      const { endpoint: oldEndpoint, resubToken } = await getPushState();
      const options = event.oldSubscription?.options;
      if (!options || !oldEndpoint || !resubToken) return;

      const newSub = await self.registration.pushManager.subscribe(options);
      const resp = await fetch("/api/push-resubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldEndpoint,
          resubToken,
          subscription: newSub.toJSON(),
        }),
      });
      if (resp.ok) {
        const body = await resp.json().catch(() => ({}));
        if (body.resubToken) {
          await putPushState({ endpoint: newSub.endpoint, resubToken: body.resubToken });
        }
      }
    } catch {
      // Reconciliation will heal on next app open.
    }
  })());
});
