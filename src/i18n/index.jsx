import { createContext, useContext, useCallback, useMemo, useState } from "react";
import es from "./es";
import { getVocab } from "./vocabulary";
import { DEFAULT_PROFESSION } from "../data/constants";
import { resolveTemplate, lookupKey } from "./resolve";

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const strings = es;
  // The active profession lives inside I18nProvider so t()'s vocab
  // substitution stays purely a function of (key, vars, profession).
  // AppShell calls setProfession() once useUserProfile resolves; until
  // then we render with the psychologist defaults — matching every
  // existing user post-backfill.
  const [profession, setProfession] = useState(DEFAULT_PROFESSION);
  const vocab = useMemo(() => getVocab(profession), [profession]);

  const t = useCallback((key, vars) => {
    const val = lookupKey(strings, key);
    if (typeof val !== "string") return Array.isArray(val) ? val : key;
    return resolveTemplate(val, vars, vocab);
  }, [strings, vocab]);

  const value = useMemo(
    () => ({ lang: "es", switchLang: () => {}, t, strings, profession, setProfession, vocab }),
    [t, strings, profession, vocab]
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
