import { createContext, useContext, useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import es from "./es";
import { getVocab } from "./vocabulary";
import { DEFAULT_PROFESSION } from "../data/constants";
import { resolveTemplate, lookupKey } from "./resolve";

/* t resolves to a string for the vast majority of keys, or a string[]
   for the handful of list-valued keys (help-tip bullet lists). Typed
   loosely — the approach mainstream i18n libraries (i18next) take — so
   call sites can use the result as ReactNode, an aria-label string, or
   an array without a cast at every call. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TFunction = (key: string, vars?: Record<string, unknown>) => any;

interface I18nValue {
  lang: string;
  switchLang: () => void;
  t: TFunction;
  strings: typeof es;
  profession: string;
  setProfession: (profession: string) => void;
  vocab: ReturnType<typeof getVocab>;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children?: ReactNode }) {
  const strings = es;
  // The active profession lives inside I18nProvider so t()'s vocab
  // substitution stays purely a function of (key, vars, profession).
  // AppShell calls setProfession() once useUserProfile resolves; until
  // then we render with the psychologist defaults — matching every
  // existing user post-backfill.
  const [profession, setProfession] = useState<string>(DEFAULT_PROFESSION);
  const vocab = useMemo(() => getVocab(profession), [profession]);

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
