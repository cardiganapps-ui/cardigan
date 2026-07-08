import { createContext, useContext, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import es from "./es";
import { getVocab } from "./vocabulary";
import { mergeLocale } from "./merge";
import { DEFAULT_PROFESSION } from "../data/constants";
import { resolveTemplate, lookupKey } from "./resolve";
import { setDateDisplayLang } from "../utils/dates";
import { setDisplayLocale } from "../utils/format";

/* t resolves to a string for the vast majority of keys, or a string[]
   for the handful of list-valued keys (help-tip bullet lists). Typed
   loosely — the approach mainstream i18n libraries (i18next) take — so
   call sites can use the result as ReactNode, an aria-label string, or
   an array without a cast at every call. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TFunction = (key: string, vars?: Record<string, unknown>) => any;

export type Locale = "es" | "en";

const LS_LANG_KEY = "cardigan.lang";

/* Per-device language: stored override wins, else the device locale
   (navigator.language works inside the Capacitor WebView on both
   platforms — no plugin needed), else Spanish. Per-device rather than
   per-user because the AuthScreen renders pre-login. */
function detectInitialLang(): Locale {
  try {
    const stored = localStorage.getItem(LS_LANG_KEY);
    if (stored === "en" || stored === "es") return stored;
  } catch { /* private mode */ }
  const nav = (typeof navigator !== "undefined" && (navigator.languages?.[0] || navigator.language)) || "";
  return nav.toLowerCase().startsWith("en") ? "en" : "es";
}

interface I18nValue {
  lang: Locale;
  switchLang: (next: Locale) => void;
  t: TFunction;
  strings: typeof es;
  profession: string;
  setProfession: (profession: string) => void;
  vocab: ReturnType<typeof getVocab>;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children?: ReactNode }) {
  const [lang, setLang] = useState<Locale>(detectInitialLang);
  // en.ts is lazy-loaded (it's as big as es.ts — keeping it out of the
  // entry chunk protects the size budget). Spanish renders until the
  // chunk resolves; the merged dictionary falls back to Spanish for any
  // key en.ts doesn't carry yet.
  const [enStrings, setEnStrings] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (lang !== "en" || enStrings) return;
    let cancelled = false;
    import("./en").then((mod) => {
      if (!cancelled) setEnStrings(mod.default);
    }).catch(() => { /* stay on Spanish */ });
    return () => { cancelled = true; };
  }, [lang, enStrings]);

  const strings = useMemo(
    () => (lang === "en" && enStrings ? (mergeLocale(es, enStrings) as typeof es) : es),
    [lang, enStrings]
  );

  // Locale side-effects: <html lang> for a11y/spellcheck, plus the
  // display-language flags in the date/number formatting modules.
  useEffect(() => {
    try { document.documentElement.lang = lang === "en" ? "en" : "es-MX"; } catch { /* SSR/tests */ }
    setDateDisplayLang(lang);
    setDisplayLocale(lang === "en" ? "en-US" : "es-MX");
  }, [lang]);

  const switchLang = useCallback((next: Locale) => {
    setLang(next);
    try { localStorage.setItem(LS_LANG_KEY, next); } catch { /* private mode */ }
  }, []);

  // The active profession lives inside I18nProvider so t()'s vocab
  // substitution stays purely a function of (key, vars, profession).
  // AppShell calls setProfession() once useUserProfile resolves; until
  // then we render with the psychologist defaults — matching every
  // existing user post-backfill.
  const [profession, setProfession] = useState<string>(DEFAULT_PROFESSION);
  const vocab = useMemo(() => getVocab(profession, lang), [profession, lang]);

  const t = useCallback((key: string, vars?: Record<string, unknown>) => {
    const val = lookupKey(strings, key);
    // Arrays (e.g. help-tip bullet lists) get each string element resolved
    // too — otherwise vocab placeholders like {client.s} render raw.
    if (Array.isArray(val)) {
      return val.map((v) => (typeof v === "string" ? resolveTemplate(v, vars, vocab) : v));
    }
    if (typeof val !== "string") return key;
    return resolveTemplate(val, vars, vocab);
  }, [strings, vocab]);

  const value = useMemo(
    () => ({ lang, switchLang, t, strings, profession, setProfession, vocab }),
    [lang, switchLang, t, strings, profession, vocab]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// Colocating the Provider + consumer hook is the standard React
// context pattern.
// eslint-disable-next-line react-refresh/only-export-components
export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used within I18nProvider");
  return ctx;
}
