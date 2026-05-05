import { useState, useEffect, useCallback } from "react";

/* ── useAdminRoute ─────────────────────────────────────────────────────
   Per-screen route hook for the /admin/* family. The top-level
   useNavigation router treats "admin" as a single screen and ignores
   the sub-segments; this hook subscribes to hashchange and exposes:

     section: the first sub-segment after "admin/" (default "overview")
     id:      the second sub-segment, used by user-detail (uid)
     navigate(section, id?): writes the new hash via replaceState so
                              browser back/forward stays clean (matches
                              useNavigation's pattern at line 75).

   Examples:
     #admin              → { section: "overview", id: null }
     #admin/users        → { section: "users", id: null }
     #admin/users/abc    → { section: "users", id: "abc" }
     #admin/codes        → { section: "codes", id: null }
*/

const VALID_SECTIONS = new Set([
  "overview",
  "users",
  "revenue",
  "acquisition",
  "codes",
  "reports",
  "audit",
  "health",
]);

function parseHash() {
  if (typeof window === "undefined") return { section: "overview", id: null };
  const raw = window.location.hash.replace("#", "").split("?")[0];
  const segs = raw.split("/").filter(Boolean);
  // segs[0] is "admin" (or whatever the top-level is)
  const section = segs[1] && VALID_SECTIONS.has(segs[1]) ? segs[1] : "overview";
  const id = segs[2] || null;
  return { section, id };
}

export function useAdminRoute() {
  const [route, setRoute] = useState(parseHash);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((section, id) => {
    if (!VALID_SECTIONS.has(section)) return;
    const target = id ? `admin/${section}/${id}` : `admin/${section}`;
    if (window.location.hash === "#" + target) return;
    try {
      window.history.replaceState({ screen: "admin" }, "", "#" + target);
      // replaceState doesn't fire hashchange — manually sync state.
      setRoute({ section, id: id || null });
    } catch {
      window.location.hash = target;
    }
  }, []);

  return { ...route, navigate };
}
