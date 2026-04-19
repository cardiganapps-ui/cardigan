/* ── Haptic feedback helpers ──
   Thin wrapper around navigator.vibrate() so screens can trigger
   consistent physical feedback without each one duplicating the
   guard-and-pattern code. Silent no-op on browsers without the API
   (desktop Chrome/Safari, older iOS). Keep patterns short — long
   vibrations annoy users and burn battery. */

function run(pattern) {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try { navigator.vibrate(pattern); } catch { /* ignore */ }
}

export const haptic = {
  // Single quick tap — for selection changes, swipe reveals, toggles.
  tap: () => run(8),
  // Affirmative confirmation — task completed, row saved.
  success: () => run([12, 40, 18]),
  // Warning / destructive — delete reveal, cancel confirm.
  warn: () => run([20, 30, 20]),
};
