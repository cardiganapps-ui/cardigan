/* ── Haptic feedback helpers ──
   Cross-platform thin wrapper. Web uses navigator.vibrate (Android Chrome,
   Samsung Internet — iOS Safari is a silent no-op because Apple never
   shipped the Web Vibration API). Native uses the Capacitor Haptics plugin,
   which routes to UIImpactFeedbackGenerator on iOS and the Vibrator service
   on Android — so iOS users finally get real haptics inside the native app.

   Keep patterns short — long vibrations annoy users and burn battery. */

import { isNative } from "../lib/platform";

function runWeb(pattern) {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try { navigator.vibrate(pattern); } catch { /* ignore */ }
}

// Native-haptics dispatch. Dynamic-imported so the web bundle never pays
// the cost of loading the plugin. Errors are swallowed — haptics are a
// nice-to-have, never block a user action because of one.
async function runNative(kind) {
  try {
    const mod = await import("@capacitor/haptics");
    if (kind === "tap") {
      await mod.Haptics.impact({ style: mod.ImpactStyle.Light });
    } else if (kind === "success") {
      await mod.Haptics.notification({ type: mod.NotificationType.Success });
    } else if (kind === "warn") {
      await mod.Haptics.notification({ type: mod.NotificationType.Warning });
    }
  } catch { /* ignore */ }
}

function fire(kind, webPattern) {
  if (isNative()) {
    // fire-and-forget — callers don't await haptics
    runNative(kind);
    return;
  }
  runWeb(webPattern);
}

export const haptic = {
  // Single quick tap — for selection changes, swipe reveals, toggles.
  tap: () => fire("tap", 8),
  // Affirmative confirmation — task completed, row saved.
  success: () => fire("success", [12, 40, 18]),
  // Warning / destructive — delete reveal, cancel confirm.
  warn: () => fire("warn", [20, 30, 20]),
};
