/* Capitalize the first letter of each whitespace-separated word, leaving
   the rest of each word alone. Designed for live use in a controlled
   input — same length in/out so the React caret stays put.

   "ana lópez"   → "Ana Lópeź"
   "MARÍA cruz"  → "MARÍA Cruz"
   "MacGyver"    → "MacGyver"  (first char already uppercase, untouched)

   Spanish surname connectors ("de", "del", "de la") are left as the
   user typed them. The naive title-case version turns "María de la
   Cruz" into "María De La Cruz" which is wrong; we'd rather leave the
   user's lowercase intact than overcorrect it. */
export function capitalizeName(s: string | null | undefined): string | null | undefined {
  if (typeof s !== "string" || !s) return s;
  return s.replace(/(^|\s)(\p{L})/gu, (_m: string, ws: string, ch: string) => ws + ch.toUpperCase());
}
