import { createContext, useContext, useCallback, useMemo, useState } from "react";
import es from "./es";
import { getVocab } from "./vocabulary";
import { DEFAULT_PROFESSION } from "../data/constants";

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
    const parts = key.split(".");
    let val = strings;
    for (const p of parts) {
      if (val == null) return key;
      val = val[p];
    }
    if (typeof val !== "string") return Array.isArray(val) ? val : key;
    // Placeholder forms:
    //   {plural}     — backward-compatible English-style "+s" pluraliser
    //   {name}       — variable substitution from vars
    //   {noun.form}  — profession-aware vocab lookup, e.g. {client.s},
    //                  {session.p}, {client.art}, {client.artP}.
    return val.replace(/\{(\w+)(?:\.(\w+))?\}/g, (_, k, sub) => {
      if (k === "plural") {
        const count = vars?.count ?? 0;
        return count !== 1 ? "s" : "";
      }
      if (sub && vocab[k]) return vocab[k][sub] ?? "";
      if (!vars) return "";
      return vars[k] ?? "";
    });
  }, [strings, vocab]);

  const value = useMemo(
    () => ({ lang: "es", switchLang: () => {}, t, strings, profession, setProfession }),
    [t, strings, profession]
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
