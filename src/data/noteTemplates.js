/* Profession-aware note template registry. Each profession owns its
   own template set under src/data/noteTemplates/<profession>.js;
   `getNoteTemplates(profession)` returns the right array, with
   psychologist as the safe fallback for any profession that hasn't
   shipped its own templates yet. The default export `NOTE_TEMPLATES`
   stays pinned to psychologist's set so existing imports keep working
   without code changes (used by tests + a couple of components that
   are about to migrate to useNoteTemplates).

   To add a new profession's templates:
   1. Create src/data/noteTemplates/<profession>.js exporting an array
      with the same shape as psychologist's (id/name/icon/title/content).
   2. Register it in TEMPLATES_BY_PROFESSION below.
   3. Confirm `markdownModel.test.js` still passes — the test iterates
      NOTE_TEMPLATES (which stays psychologist) but the same shape
      contract applies to every set. */

import { PSYCHOLOGIST_TEMPLATES } from "./noteTemplates/psychologist";
import { NUTRITIONIST_TEMPLATES } from "./noteTemplates/nutritionist";
import { DEFAULT_PROFESSION } from "./constants";

const TEMPLATES_BY_PROFESSION = {
  psychologist:  PSYCHOLOGIST_TEMPLATES,
  nutritionist:  NUTRITIONIST_TEMPLATES,
  // Phase 3+: tutor, music_teacher, trainer get their own template sets.
  // Until then they fall back to psychologist via getNoteTemplates().
};

export function getNoteTemplates(profession) {
  return TEMPLATES_BY_PROFESSION[profession]
    ?? TEMPLATES_BY_PROFESSION[DEFAULT_PROFESSION];
}

// Backward-compatible default (psychologist's set). markdownModel.test.js
// imports this directly and expects the original shape.
export const NOTE_TEMPLATES = PSYCHOLOGIST_TEMPLATES;
