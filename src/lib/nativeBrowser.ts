// Cross-platform external-URL opener.
//
// Web:   window.location.href = url (full-page navigate). Stripe Portal,
//        Stripe Connect onboarding, and any other "send the user to a
//        third-party domain" flow has historically used this.
//
// Native: Capacitor Browser plugin → in-app browser sheet.
//        - iOS: SFSafariViewController. Shares cookies with mobile Safari,
//          so a user already signed in to Stripe doesn't have to log in
//          again inside the app's browser sheet.
//        - Android: Chrome Custom Tabs. Same shared-cookie property with
//          the user's default browser.
//        Both auto-dismiss when the user taps Done / swipes down, returning
//        them straight back to Cardigan — no Safari/Chrome detour.
//
// Use this for every flow where the destination is a domain we don't own.
// Calendar feed URLs etc. that just need to be clipboard-copied (no
// navigation) should keep using navigator.clipboard directly.

import { isNative } from "./platform";

// Returns true if the URL was opened, false if it failed — callers can
// toast on false. On native, Browser.open can reject (plugin not loaded,
// malformed URL); without this guard that rejection propagated as an
// unhandled promise rejection and the flow (e.g. Stripe Portal) silently
// dead-ended with no feedback.
export async function openExternal(url?: string) {
  if (!url) return false;
  if (isNative()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url });
      return true;
    } catch {
      return false;
    }
  }
  window.location.href = url;
  return true;
}

// "Open in new tab" variant. On native, identical to openExternal — the
// in-app browser sheet IS the equivalent of a new tab. On web, opens in
// a new window so the user can keep Cardigan open in the original tab.
export async function openExternalNewTab(url?: string) {
  if (!url) return false;
  if (isNative()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url });
      return true;
    } catch {
      return false;
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

// "Open in a different app" via URL scheme. tel:, mailto:, webcal:,
// whatsapp:, maps:, twitter:, anything iOS knows how to hand off.
//
// Web:    window.open(url, "_blank") — browser handles the scheme,
//         either launching the registered app or 404ing gracefully.
// Native: Capacitor AppLauncher.openUrl({ url }) — explicit OS hand-off.
//         Anchor-tag navigations to non-HTTP schemes are sometimes
//         silently dropped by WKWebView's navigation delegate; the
//         plugin path is reliable.
//
// Use this anywhere we want to launch the user into a different app
// (Apple Calendar, Phone, Mail, WhatsApp, Maps). For HTTP URLs prefer
// openExternal() above — that opens in the in-app browser sheet,
// which is the right native equivalent of target="_blank".
export async function launchUrl(url?: string) {
  if (!url) return false;
  if (isNative()) {
    const { AppLauncher } = await import("@capacitor/app-launcher");
    try {
      await AppLauncher.openUrl({ url });
      return true;
    } catch {
      return false;
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}
