import { useMemo } from "react";
import { useCardiganMain } from "../context/CardiganContext";
import { getNoteTemplates } from "../data/noteTemplates";

/* Returns the note template array for the active profession.
   Reads `profession` from CardiganContext (set by useCardiganData /
   AppShell). Memoized so React's referential-equality bailouts kick in
   for downstream useEffect deps. */
export function useNoteTemplates() {
  const { profession } = useCardiganMain();
  return useMemo(() => getNoteTemplates(profession), [profession]);
}
