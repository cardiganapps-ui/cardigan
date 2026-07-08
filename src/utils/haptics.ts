/* ── Haptic feedback helpers ──
   Cross-platform thin wrapper. Web uses navigator.vibrate (Android Chrome,
   Samsung Internet — iOS Safari is a silent no-op because Apple never
   shipped the Web Vibration API). Native uses the Capacitor Haptics plugin,
   which routes to UIImpactFeedbackGenerator on iOS and the Vibrator service
   on Android — so iOS users finally get real haptics inside the native app.

   Keep patterns short — long vibrations annoy users and burn battery. */

import { isNative } from "../lib/platform";

type HapticKind = "tap" | "success" | "warn";

/* Global on/off switch (Settings → Funciones → Vibración). haptics is a
   plain module consumed from non-hook code (some of it pre-login), so the
   preference is per-DEVICE — like theme/accent/fontScale — under a single
   localStorage key, lazily read once and cached in a module flag. Default
   ON; private-mode localStorage failures fall back to ON. */
const LS_KEY = "cardigan.hapticsEnabled";
let enabled: boolean | null = null;

export function isHapticsEnabled(): boolean {
  if (enabled === null) {
    try { enabled = localStorage.getItem(LS_KEY) !== "false"; }
    catch { enabled = true; }
  }
  return enabled;
}

export function setHapticsEnabled(v: boolean) {
  enabled = v;
  try { localStorage.setItem(LS_KEY, String(v)); } catch { /* private mode */ }
}

function runWeb(pattern: number | number[]) {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try { navigator.vibrate(pattern); } catch { /* ignore */ }
}

// Native-haptics dispatch. Dynamic-imported so the web bundle never pays
// the cost of loading the plugin. Errors are swallowed — haptics are a
// nice-to-have, never block a user action because of one.
async function runNative(kind: HapticKind) {
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

function fire(kind: HapticKind, webPattern: number | number[]) {
  if (!isHapticsEnabled()) return;
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
