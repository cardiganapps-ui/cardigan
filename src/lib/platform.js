// Runtime platform detection. Native code paths (Capacitor plugins,
// push tokens, biometric unlock) gate on isNative(); web code paths
// fall through unchanged so the same bundle ships to PWA, iOS, and
// Android without per-build flags.

const cap = typeof window !== "undefined" ? window.Capacitor : null;

export function isNative() {
  return Boolean(cap?.isNativePlatform?.());
}

export function getPlatform() {
  return cap?.getPlatform?.() ?? "web";
}

export function isIOS() {
  return getPlatform() === "ios";
}

export function isAndroid() {
  return getPlatform() === "android";
}
