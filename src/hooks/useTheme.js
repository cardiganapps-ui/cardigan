import { useState, useEffect, useCallback } from "react";

const LS_KEY = "cardigan-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function getStored() {
  try { return localStorage.getItem(LS_KEY); } catch { return null; }
}

function apply(resolved) {
  if (resolved === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = resolved === "dark" ? "#1A1A1A" : "#FFFFFF";
}

export function useTheme() {
  const [preference, setPreferenceState] = useState(() => getStored() || "system");
  const [systemIsDark, setSystemIsDark] = useState(() => window.matchMedia(DARK_QUERY).matches);

  // Track system dark-mode preference as state so resolvedTheme can be
  // derived purely during render.
  useEffect(() => {
    const mql = window.matchMedia(DARK_QUERY);
    const handler = () => setSystemIsDark(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const resolvedTheme = preference === "dark" ? "dark"
    : preference === "light" ? "light"
    : systemIsDark ? "dark" : "light";

  // Apply resolved theme to the DOM whenever it changes.
  useEffect(() => { apply(resolvedTheme); }, [resolvedTheme]);

  const setPreference = useCallback((value) => {
    try { localStorage.setItem(LS_KEY, value); } catch { /* private mode / quota — non-fatal */ }
    setPreferenceState(value);
  }, []);

  return { preference, resolvedTheme, setPreference };
}
