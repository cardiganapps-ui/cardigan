import { createContext, useContext, useState, useCallback, useMemo } from "react";
import es from "./es";
import en from "./en";

const locales = { es, en };
const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem("cardigan-lang") || "es");

  const switchLang = useCallback((l) => {
    if (locales[l]) { setLang(l); localStorage.setItem("cardigan-lang", l); }
  }, []);

  const strings = locales[lang] || es;

  // t("nav.home") → "Inicio"
  // t("docs.count", { count: 5 }) → "5 documentos"
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

  const value = useMemo(() => ({ lang, switchLang, t, strings }), [lang, switchLang, t, strings]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used within I18nProvider");
  return ctx;
}
