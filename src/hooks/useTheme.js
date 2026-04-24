import { useState, useEffect, useCallback } from "react";

const LS_KEY = "cardigan-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function getStored() {
  try { return localStorage.getItem(LS_KEY); } catch { return null; }
}

function resolve(pref) {
  if (pref === "dark") return "dark";
  if (pref === "light") return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
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
  const [resolvedTheme, setResolved] = useState(() => resolve(preference));

  // Apply on mount and whenever preference changes
  useEffect(() => {
    const r = resolve(preference);
    setResolved(r);
    apply(r);
  }, [preference]);

  // Listen for system changes when preference is "system"
  useEffect(() => {
    if (preference !== "system") return;
    const mql = window.matchMedia(DARK_QUERY);
    const handler = () => {
      const r = resolve("system");
      setResolved(r);
      apply(r);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [preference]);

  const setPreference = useCallback((value) => {
    try { localStorage.setItem(LS_KEY, value); } catch { /* private mode / quota — non-fatal */ }
    setPreferenceState(value);
  }, []);

  return { preference, resolvedTheme, setPreference };
}
