import { createContext, useContext, useCallback, useMemo } from "react";
import es from "./es";

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const strings = es;

  const t = useCallback((key, vars) => {
    const parts = key.split(".");
    let val = strings;
    for (const p of parts) {
      if (val == null) return key;
      val = val[p];
    }
    if (typeof val !== "string") return Array.isArray(val) ? val : key;
    if (!vars) return val;
    return val.replace(/\{(\w+)\}/g, (_, k) => {
      if (k === "plural") {
        const count = vars.count ?? 0;
        return count !== 1 ? "s" : "";
      }
      return vars[k] ?? "";
    });
  }, [strings]);

  const value = useMemo(() => ({ lang: "es", switchLang: () => {}, t, strings }), [t, strings]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used within I18nProvider");
  return ctx;
}
