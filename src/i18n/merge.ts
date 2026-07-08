/* Deep-merges a partial locale overlay onto the Spanish base dictionary.

   Missing English keys render Spanish — never the raw key (which
   lookupKey would otherwise return). This is both the incremental-
   authoring story for en.ts and permanent drift protection when a new
   feature lands strings in es.ts first.

   Leaves are strings or string[]; arrays are replaced wholesale (a
   half-translated bullet list would read worse than a Spanish one). */

// Loosely-typed like resolve.ts — the i18n dictionaries are untyped trees.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export function mergeLocale(base: Row, overlay: Row): Row {
  if (overlay == null) return base;
  const out: Row = {};
  for (const key of Object.keys(base)) {
    const b = base[key];
    const o = overlay[key];
    if (o === undefined || o === null) {
      out[key] = b;
    } else if (typeof b === "object" && !Array.isArray(b) && typeof o === "object" && !Array.isArray(o)) {
      out[key] = mergeLocale(b, o);
    } else {
      out[key] = o;
    }
  }
  return out;
}
