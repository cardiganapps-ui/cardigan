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
    //   {plural}     — backward-compatible English-style "+s" pluraliser.
    //                  Don't use this with vocab nouns — Spanish plurals
    //                  aren't always "+s" (e.g. sesión → sesiones).
    //   {name}       — variable substitution from vars.
    //   {noun.form}  — profession-aware vocab lookup (form ∈ s/p/art/artP).
    //   {noun.S}/{noun.P} — uppercase forms (capitalised first letter).
    //                  Use for sentence starts, button labels, nav titles
    //                  where the noun must read "Paciente" not "paciente".
    //   {noun}       — count-aware shortcut: returns vocab[k].p when
    //                  vars.count !== 1, otherwise vocab[k].s. Pair with
    //                  `{count} {client}` so "1 paciente" / "3 pacientes"
    //                  both come out grammatically correct without the
    //                  fragile {plural} suffix.
    const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    return val.replace(/\{(\w+)(?:\.(\w+))?\}/g, (_, k, sub) => {
      if (k === "plural") {
        const count = vars?.count ?? 0;
        return count !== 1 ? "s" : "";
      }
      if (vocab[k]) {
        if (!sub) {
          const isSingular = vars?.count === 1;
          return isSingular ? vocab[k].s : vocab[k].p;
        }
        if (sub === "S") return cap(vocab[k].s);
        if (sub === "P") return cap(vocab[k].p);
        return vocab[k][sub] ?? "";
      }
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
