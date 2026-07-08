/* ── English locale ──
   Partial overlay merged onto es.ts at runtime (see merge.ts) — any key
   missing here renders Spanish, never a raw key. Keys must mirror es.ts
   exactly; the DeepPartial<typeof es> type rejects misspelled/extra keys
   and src/utils/__tests__/i18nParity.test.ts enforces completeness.

   Authoring rules:
   - Vocabulary placeholders: use {noun.s}/{noun.p}/{noun.S}/{noun.P} and
     the bare count-aware {noun}. Do NOT reuse Spanish-grammar forms
     (del/al/agreed) — rephrase the sentence instead (see vocabulary.ts).
   - {name}-style var placeholders must match the es.ts key's vars.
   - Keep UI strings roughly the same length as Spanish where layout is
     tight (buttons, tabs, chips). */

import type esDict from "./es";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends string
    ? string
    : T[K] extends readonly string[]
      ? string[]
      : DeepPartial<T[K]>;
};

export type EnDict = DeepPartial<typeof esDict>;

/* Flip to true in the final translation batch — the parity test then
   enforces that every es.ts key has an English translation. */
export const EN_COMPLETE = false;

const en: EnDict = {};

export default en;
