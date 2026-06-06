// Native shell boot — runs once on app launch inside Capacitor.
//
// Responsibilities:
//   - Hide the splash screen once React has mounted (otherwise the
//     splash sticks around the full 3s default, making the cold start
//     feel slower than it actually is).
//   - Configure the status bar to overlay the WebView with dark icons
//     on the light theme, light icons on the dark theme. The status
//     bar background follows the system, so cardigan's white shell
//     gets a clean transparent strip at the top.
//
// All operations are no-ops on web (isNative() short-circuits).

import { isNative, isIOS } from "./platform";

export async function initNativeShell() {
  if (!isNative()) return;

  // Mark the document so CSS can opt into native-only adjustments. The
  // primary use right now is shrinking text + spacing on iOS, where
  // WKWebView renders ~17% larger than Safari for the same CSS (even
  // with `text-size-adjust: none`) — a system-level Dynamic Type pass
  // that we can't fully opt out of at the CSS layer. Pairs with a
  // `.cap-native` (and `.cap-ios`) ruleset in base.css that compresses
  // --text-scale and the largest hard-coded sizes.
  document.documentElement.classList.add("cap-native");
  if (isIOS()) document.documentElement.classList.add("cap-ios");

  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    // Hide as soon as React has painted. The 200ms delay lets the first
    // frame settle so the user sees content, not a flash of empty
    // background, between splash and app.
    setTimeout(() => { SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {}); }, 200);
  } catch { /* ignore */ }

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    // Overlay mode: WebView extends behind the status bar; the existing
    // CSS handles vertical clearance via env(safe-area-inset-top). Pairs
    // with contentInset:"never" in capacitor.config.json — together they
    // stop iOS from adding its own inset on top of ours (which would
    // produce a ~300px blank strip above the topbar).
    await StatusBar.setOverlaysWebView({ overlay: true });
    // Cardigan's shell is white in light mode, charcoal in dark. The
    // status bar overlays the WebView; we toggle icon style to match.
    // Capacitor naming is the opposite of intuitive: Style.Light = LIGHT
    // text (visible on dark bg); Style.Dark = DARK text (visible on
    // light bg). data-theme is set synchronously by the boot script in
    // index.html, so it's already correct here.
    const isDark = document.documentElement.getAttribute("data-theme") === "dark"
      || (document.documentElement.getAttribute("data-theme") !== "light"
          && window.matchMedia("(prefers-color-scheme: dark)").matches);
    await StatusBar.setStyle({ style: isDark ? Style.Light : Style.Dark });
  } catch { /* ignore */ }
}
