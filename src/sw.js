/* ── Cardigan Service Worker ──
   Custom SW using injectManifest strategy.
   Handles: Workbox precaching, runtime caching, push notifications. */

import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkFirst, CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { getPushState, putPushState } from "./pushStore.js";

// Vite injects VITE_VAPID_PUBLIC_KEY into this file at build time. Used
// to reconstruct subscribe() options when `event.oldSubscription` is
// null on pushsubscriptionchange — a documented Chromium quirk.
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

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

// Supabase API — network-first with a 5-minute cache fallback. Bumped
// from 60s because the previous window meant the SW discarded valid
// responses for the common "reopen the app after coffee" pattern. 5
// minutes still expires well inside a typical session; stale rows
// only surface when the network is down.
registerRoute(
  /^https:\/\/axyuqfkmifcaupwhzfuw\.supabase\.co\/.*/i,
  new NetworkFirst({
    cacheName: "supabase-api",
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 300 })],
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
    // tag collapses successive reminders for the same session into a
    // single system banner (rather than piling up on the lock screen).
    tag: data.tag || undefined,
    // Explicit actions render as tappable buttons on platforms that
    // support them (Android). iOS ignores, which is fine — the default
    // notification tap falls through to `notificationclick` below.
    actions: Array.isArray(data.actions) ? data.actions : undefined,
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click — focus existing window or open new one ──
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Action buttons carry their own semantics; right now every action
  // we ship resolves to "open the URL baked into the notification",
  // so the branch is short. Leaving the switch explicit so adding a
  // "dismiss" or "snooze" action later doesn't need to re-plumb this.
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
      if (!oldEndpoint || !resubToken) return;

      // Prefer the browser-provided options (carries the exact key the
      // old subscription used). Fall back to reconstructing them from
      // the build-time VAPID public key when the browser omits
      // oldSubscription — Chromium has shipped builds that do this.
      const options = event.oldSubscription?.options || (VAPID_PUBLIC_KEY ? {
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      } : null);
      if (!options) return;

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
