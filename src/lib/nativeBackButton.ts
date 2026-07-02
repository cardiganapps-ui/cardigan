// Android hardware/gesture back inside the Capacitor shell.
//
// Registering ANY backButton listener disables Capacitor's default
// handling (webview.goBack() → activity finish), so this module owns
// the whole policy:
//
//   1. Topmost open overlay (sheet, dialog, palette, drawer, FAB menu)
//      — dismiss it exactly like the Escape key, via the shared escape
//      stack in hooks/useEscape.ts. Busy sheets register a no-op there
//      to block dismissal mid-submit; back respects that the same way
//      Escape does.
//   2. `cardigan-hardware-back` CustomEvent — app-level fallback. The
//      shell (App.tsx) preventDefault()s it to navigate home from inner
//      screens; the logged-out AuthScreen leaves it alone.
//   3. Nothing consumed it → minimize the task. NEVER App.exitApp():
//      back-from-root on Android means "send to background" (matching
//      every well-behaved app), and killing the activity could drop
//      in-flight Supabase writes.
//
// iOS has no hardware back; web keeps the browser's own history
// handling (useNavigation's popstate/layerStack path is untouched).

import { isAndroid } from "./platform";
import { dismissTopLayer } from "../hooks/useEscape";

export async function initNativeBackButton() {
  if (!isAndroid()) return;
  try {
    const { App } = await import("@capacitor/app");
    await App.addListener("backButton", () => {
      if (dismissTopLayer()) return;
      const ev = new CustomEvent("cardigan-hardware-back", { cancelable: true });
      const notPrevented = window.dispatchEvent(ev);
      if (notPrevented) App.minimizeApp().catch(() => {});
    });
  } catch { /* ignore */ }
}
