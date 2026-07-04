import { useState, useEffect, useCallback } from "react";

/* ── useFontScale ──
   User-selectable text size, persisted per-device in localStorage
   (mirrors useAccentTheme's pattern). The app deliberately opts out of
   OS text scaling (`text-size-adjust: none` in base.css — WKWebView's
   Dynamic Type handling is inconsistent), so this is THE accessibility
   path for users who need larger text.

   Values: "sm" | "default" | "lg" | "xl".

   "default" applies no override. The other values set a
   `data-font-scale` attribute on <html>, activating the matching
   `--text-scale-user` multiplier block in styles/base.css. The
   multiplier composes with the responsive `--text-scale` bump at
   iPad+ breakpoints instead of replacing it. */

const LS_KEY = "cardigan-font-scale";
export const FONT_SCALES = ["sm", "default", "lg", "xl"];

function getStored() {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v && FONT_SCALES.includes(v) ? v : null;
  } catch { return null; }
}

function apply(scale: string | null | undefined) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (scale && scale !== "default") {
    root.dataset.fontScale = scale;
  } else {
    delete root.dataset.fontScale;
  }
}

export function useFontScale() {
  const [fontScale, setFontScaleState] = useState(() => getStored() || "default");

  useEffect(() => { apply(fontScale); }, [fontScale]);

  const setFontScale = useCallback((value: string) => {
    if (!FONT_SCALES.includes(value)) return;
    try { localStorage.setItem(LS_KEY, value); } catch { /* private mode / quota */ }
    setFontScaleState(value);
  }, []);

  return { fontScale, setFontScale };
}
