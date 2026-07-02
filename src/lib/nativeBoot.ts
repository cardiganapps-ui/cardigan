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

import { isNative, isIOS, isAndroid } from "./platform";

export async function initNativeShell() {
  if (!isNative()) return;

  // Mark the document so CSS can opt into native-only adjustments.
  // `.cap-ios` carries the WKWebView density compensation (see the
  // `html.cap-ios { zoom }` block in base.css) — iOS renders ~17%
  // larger than Safari for the same CSS, a system-level Dynamic Type
  // pass we can't opt out of at the CSS layer. Android's Chromium
  // WebView has no such inflation, so `.cap-android` must NEVER get
  // that zoom; it exists for Android-only tweaks (overscroll
  // containment, etc.).
  document.documentElement.classList.add("cap-native");
  if (isIOS()) document.documentElement.classList.add("cap-ios");
  if (isAndroid()) document.documentElement.classList.add("cap-android");

  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    // Hide as soon as React has painted. The 120ms delay lets the first
    // frame settle so the user sees content, not a flash of empty
    // background, between splash and app. Pairs with the 220ms fadeOut
    // configured in capacitor.config.json so the cross-fade lands on
    // the React surface, not a flash of teal.
    setTimeout(() => { SplashScreen.hide({ fadeOutDuration: 220 }).catch(() => {}); }, 120);
  } catch { /* ignore */ }

  try {
    if (isIOS()) {
      const { StatusBar } = await import("@capacitor/status-bar");
      // Overlay mode: WebView extends behind the status bar; the existing
      // CSS handles vertical clearance via env(safe-area-inset-top). Pairs
      // with contentInset:"never" in capacitor.config.json — together they
      // stop iOS from adding its own inset on top of ours (which would
      // produce a ~300px blank strip above the topbar).
      //
      // iOS-only: on Android this plugin call flips deprecated
      // SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN (status bar only, no-op on 15+)
      // and fights Capacitor 8's built-in SystemBars plugin, which
      // already runs the WebView edge-to-edge (EdgeToEdge.enable in
      // MainActivity + targetSdk 36) and injects the real inset values
      // as --safe-area-inset-* CSS vars that --sat/--sab consume.
      await StatusBar.setOverlaysWebView({ overlay: true });
    }
    // Set the initial icon style to match the theme already resolved by
    // the boot script in index.html. useTheme keeps it in sync after any
    // runtime theme change (see applyStatusBarStyle below).
    await applyStatusBarStyle(currentThemeIsDark());
  } catch { /* ignore */ }
}

// True when the document is currently in dark mode — reads the
// synchronously-applied data-theme attribute, falling back to the OS
// preference when the user hasn't pinned a theme.
function currentThemeIsDark() {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "dark") return true;
  if (t === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// Update the native system-bar icon/text colors to stay legible over the
// theme's background. No-op on web. Called at boot AND on every runtime
// theme change (from useTheme) so the clock/battery/wifi glyphs never
// end up dark-on-dark.
//
// ⚠️ Both style enums are named after the BACKGROUND, not the text:
//   Dark  → LIGHT (white) text — use on a DARK background
//   Light → DARK  (black) text — use on a LIGHT background
// (The previous code had this inverted, which left the status bar
// black-on-charcoal — invisible — in dark mode.)
//
// Platform split:
//   iOS     → @capacitor/status-bar (the only bar iOS has). Do NOT swap
//             this for core's SystemBars: on iOS that path needs an
//             Info.plist opt-in the CI-generated project doesn't set.
//   Android → Capacitor 8's built-in SystemBars, which styles BOTH the
//             status bar and the navigation/gesture bar (omitting `bar`
//             applies to both — the @capacitor/status-bar plugin can't
//             touch the nav bar, which left it mismatched in dark mode).
//             It also repaints the decor background from the native
//             theme's windowBackground (values/ + values-night/), which
//             is what shows behind the keyboard inset gap.
export async function applyStatusBarStyle(isDark: boolean) {
  if (!isNative()) return;
  try {
    if (isAndroid()) {
      const { SystemBars, SystemBarsStyle } = await import("@capacitor/core");
      await SystemBars.setStyle({
        style: isDark ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
      });
      return;
    }
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
  } catch { /* ignore */ }
}
