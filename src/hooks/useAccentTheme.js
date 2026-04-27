import { useState, useEffect, useCallback } from "react";

/* ── useAccentTheme ──
   User-selectable accent color, persisted per-device in localStorage
   (mirrors useTheme's pattern). Decoupled from profession — every user
   defaults to the base teal palette and can opt into one of the
   alternate accents from Settings → Apariencia.

   Values: "default" | "sage" | "amber" | "burgundy" | "steel".

   "default" applies no override — base.css / dark.css drive the teal
   family directly. The other values set a `data-accent` attribute on
   <html>, activating the matching block in styles/accent-themes.css. */

const LS_KEY = "cardigan-accent";
export const ACCENTS = ["default", "sage", "amber", "burgundy", "steel"];

function getStored() {
  try {
    const v = localStorage.getItem(LS_KEY);
    return ACCENTS.includes(v) ? v : null;
  } catch { return null; }
}

function apply(accent) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (accent && accent !== "default") {
    root.dataset.accent = accent;
  } else {
    delete root.dataset.accent;
  }
}

export function useAccentTheme() {
  const [accent, setAccentState] = useState(() => getStored() || "default");

  useEffect(() => { apply(accent); }, [accent]);

  const setAccent = useCallback((value) => {
    if (!ACCENTS.includes(value)) return;
    try { localStorage.setItem(LS_KEY, value); } catch { /* private mode / quota */ }
    setAccentState(value);
  }, []);

  return { accent, setAccent };
}
