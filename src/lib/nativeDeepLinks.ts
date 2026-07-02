// Native deep-link bridge.
//
// On Android and iOS, tapping a cardigan.mx link from email, WhatsApp,
// or another app routes the tap through Capacitor's App plugin via the
// `appUrlOpen` event when the OS decides our app handles the link
// (Android App Links / iOS Universal Links). Home Screen quick actions
// on both platforms arrive through the same event: Android's
// shortcuts.xml intents carry cardigan.mx URLs, and iOS's AppDelegate
// (patched by scripts/apply-ios-config.sh) forwards the tapped
// shortcut's UserInfo URL into Capacitor's open-url path.
//
// The app's existing URL-parsing logic (patient invite /i/<token>,
// influencer code /c/<code>, referral ?ref=, Stripe return ?billing=)
// runs once at module load. To re-trigger it from a runtime event, we
// rewrite window.location and reload — the cold-start path is the
// single source of truth for parsing, and a reload guarantees every
// effect re-evaluates without duplicating logic into runtime handlers.
//
// No-op on web — links there resolve via the browser's normal nav.

import { isNative } from "./platform";

let initialized = false;

// Hosts we own and will route locally. Anything else falls through to
// the OS (system browser opens it as it would have anyway).
const ALLOWED_HOSTS = new Set(["cardigan.mx", "www.cardigan.mx", "localhost"]);

function applyLocalUrl(rawUrl?: string) {
  if (!rawUrl || typeof window === "undefined") return;
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return; }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) return;

  const localPath = parsed.pathname + parsed.search + parsed.hash;
  const currentPath = window.location.pathname + window.location.search + window.location.hash;
  if (localPath === currentPath) return;

  // Rewrite + reload. The reload is heavy but every URL-parsing branch
  // in App.jsx reads window.location at module load — patching them
  // individually would be a larger refactor than the wins justify in
  // Phase 3. Reload time on the embedded bundle is ~200ms.
  window.history.replaceState({}, "", localPath);
  window.location.reload();
}

export async function initNativeDeepLinks() {
  if (!isNative() || initialized) return;
  initialized = true;
  try {
    const { App } = await import("@capacitor/app");
    await App.addListener("appUrlOpen", (event: { url?: string }) => {
      applyLocalUrl(event?.url);
    });
    // Cold-start case: when the app was killed and the user tapped a
    // link, the URL arrives via getLaunchUrl() instead of appUrlOpen.
    // The cold-start URL is already the launch URL though (Capacitor
    // sets it before React mounts), so we only apply it if it differs
    // from what's currently in window.location — same diff guard as
    // applyLocalUrl uses.
    const launch = await App.getLaunchUrl();
    if (launch?.url) applyLocalUrl(launch.url);
  } catch (err) {
    if (import.meta.env?.DEV) console.error("[deepLinks] init failed:", err);
  }
}
