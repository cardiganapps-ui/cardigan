import { describe, it, expect } from "vitest";
import es from "../../i18n/es";
import { resolveTemplate, lookupKey } from "../../i18n/resolve";
import { getVocab } from "../../i18n/vocabulary";
import { PROFESSIONS } from "../../data/constants";
import { TUTORIAL_SLIDES } from "../../components/Tutorial/tutorialSlides";

/* Locks in the profession-aware onboarding walkthrough (Play Store
   tester feedback: "personalized guidance"). Every slide must resolve
   for every profession with no raw keys and no unresolved {placeholders},
   and the vocab-bearing slides must actually say the profession's nouns
   — a future copy edit that drops the placeholders should fail here. */

describe("tutorial slides are profession-aware", () => {
  const slideKeys = TUTORIAL_SLIDES.flatMap((s) => [s.titleKey, s.bodyKey]);

  it.each(PROFESSIONS.map((p: string) => [p]))("resolves cleanly for %s", (profession: string) => {
    const vocab = getVocab(profession);
    for (const key of slideKeys) {
      const raw = lookupKey(es, key);
      expect(typeof raw, `missing i18n key ${key}`).toBe("string");
      const resolved = resolveTemplate(raw, undefined, vocab);
      expect(resolved, `raw key leaked for ${key}`).not.toBe(key);
      expect(resolved, `unresolved placeholder in ${key} for ${profession}`).not.toMatch(/[{}]/);
    }
  });

  it("the patients slide uses the profession's client noun", () => {
    const bodyKey = "tutorial.steps.patientsBody";
    const raw = lookupKey(es, bodyKey);
    for (const profession of PROFESSIONS) {
      const vocab = getVocab(profession);
      const resolved = resolveTemplate(raw, undefined, vocab);
      expect(resolved, `expected "${vocab.client.s}" for ${profession}`).toContain(vocab.client.s);
    }
  });

  it("slide copy keeps vocabulary placeholders (personalization not regressed)", () => {
    // At least the patients + invite slides must carry {client...} in the
    // authored template — that's what makes the tour profession-aware.
    for (const key of ["tutorial.steps.patientsBody", "tutorial.steps.inviteBody", "tutorial.steps.welcomeBody"]) {
      const raw = lookupKey(es, key);
      expect(raw, `${key} lost its {client...} placeholder`).toMatch(/\{client\./);
    }
  });
});
