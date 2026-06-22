// Cross-platform OS share-sheet wrapper.
//
// Web:   navigator.share() when available (iOS Safari, Android Chrome,
//        Edge). Returns false when the API isn't present so callers can
//        render their own fallback row (WhatsApp / Email deep links).
//
// Native: Capacitor Share plugin → native iOS/Android share sheet.
//        Works reliably even on iOS WKWebView, which sometimes hides
//        navigator.share entirely.
//
// API matches navigator.share's shape: { title?, text?, url? }. Returns
// { ok: true } on success, { ok: false, aborted: true } when the user
// dismissed without sharing (treat as success — no error toast), and
// { ok: false, error } when the platform genuinely fails.

import { isNative } from "./platform";

export function isSharingSupported() {
  if (isNative()) return true;
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

export async function shareContent({ title, text, url }: { title?: string; text?: string; url?: string } = {}) {
  if (isNative()) {
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title, text, url, dialogTitle: title });
      return { ok: true };
    } catch (err) {
      // The plugin throws on user-cancel with a message like "Share canceled".
      // Treat anything non-Error-shaped or matching that pattern as an
      // intentional dismissal so callers don't toast a failure.
      const msg = (err as Error)?.message || String(err || "");
      if (/cancel/i.test(msg)) return { ok: false, aborted: true };
      return { ok: false, error: msg };
    }
  }

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url });
      return { ok: true };
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return { ok: false, aborted: true };
      return { ok: false, error: (err as Error)?.message || String(err) };
    }
  }

  return { ok: false, error: "unsupported" };
}
