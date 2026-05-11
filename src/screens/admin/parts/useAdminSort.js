import { useCallback, useEffect, useState } from "react";

/* ── useAdminSort ───────────────────────────────────────────────────────
   Tiny sort-state hook with localStorage persistence per "page" key
   (e.g. "users", "audit", "revenue"). Keeps every screen from
   reinventing its own sort state machine.

   Returns:
     sort:          { key, dir } | null
     setSort:       (next | updater) => void
     toggleSort:    (key) => void   — clicking the same key cycles
                                       asc → desc → null

   Persistence is best-effort. Private mode / quota failures fall through
   silently. */
const LS_PREFIX = "admin.sort.";

function readPersisted(pageKey, initial) {
  if (typeof window === "undefined") return initial;
  try {
    const raw = window.localStorage.getItem(LS_PREFIX + pageKey);
    if (!raw) return initial;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.key === "string" && (parsed.dir === "asc" || parsed.dir === "desc")) {
      return parsed;
    }
  } catch { /* non-fatal */ }
  return initial;
}

function writePersisted(pageKey, value) {
  if (typeof window === "undefined") return;
  try {
    if (value == null) {
      window.localStorage.removeItem(LS_PREFIX + pageKey);
    } else {
      window.localStorage.setItem(LS_PREFIX + pageKey, JSON.stringify(value));
    }
  } catch { /* non-fatal */ }
}

export function useAdminSort(pageKey, initial = null) {
  const [sort, setSortState] = useState(() => readPersisted(pageKey, initial));

  useEffect(() => {
    writePersisted(pageKey, sort);
  }, [pageKey, sort]);

  const setSort = useCallback((next) => {
    setSortState((prev) => (typeof next === "function" ? next(prev) : next));
  }, []);

  const toggleSort = useCallback((key) => {
    setSortState((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null; // third click clears
    });
  }, []);

  return { sort, setSort, toggleSort };
}
