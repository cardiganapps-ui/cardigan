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

export async function openExternal(url) {
  if (!url) return;
  if (isNative()) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
    return;
  }
  window.location.href = url;
}

// "Open in new tab" variant. On native, identical to openExternal — the
// in-app browser sheet IS the equivalent of a new tab. On web, opens in
// a new window so the user can keep Cardigan open in the original tab.
export async function openExternalNewTab(url) {
  if (!url) return;
  if (isNative()) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
