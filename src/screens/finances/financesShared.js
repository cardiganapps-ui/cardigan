/* ── Finances shared helpers ──
   Pure constants + date math extracted from Finances.jsx so the tab
   components (PagosTab / ProyeccionTab / GastosTab / ResumenTab) can each
   live in their own file without duplicating logic. Everything here is
   pure — no React state, no side effects. */

// Lazy-load window for the payments list. Rendering every payment row
// up-front was the single worst scroll-jank source on iOS Safari — a
// therapist with 1000+ payments paid ~500ms layout cost on tab open.
// With the window, first paint renders 60 rows; an IntersectionObserver
// sentinel pulls 40 more as the user scrolls toward the end.
export const FINANCES_INITIAL_WINDOW = 60;
export const FINANCES_WINDOW_INCREMENT = 40;

// Compute the from-ISO date for a period key. "all" → null (no lower
// bound). "1w" → 7 days ago; the month keys map to N calendar months
// back. Shared verbatim by PagosTab and GastosTab.
export function getDateFrom(p) {
  if (p === "all") return null;
  const d = new Date();
  if (p === "1w") {
    d.setDate(d.getDate() - 7);
  } else {
    const months = { "1m": 1, "3m": 3, "6m": 6, "1y": 12 };
    d.setMonth(d.getMonth() - (months[p] || 0));
  }
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// Local Date → "YYYY-MM-DD" using the local calendar fields (no UTC
// shift). Used by ResumenTab to bound period ranges.
export function toIsoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
