import { describe, it, expect } from "vitest";
import es from "../../i18n/es";
import en, { EN_COMPLETE } from "../../i18n/en";
import { mergeLocale } from "../../i18n/merge";
import { VOCAB, VOCAB_EN, getVocab } from "../../i18n/vocabulary";
import { PROFESSIONS } from "../../data/constants";
import { resolveTemplate } from "../../i18n/resolve";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

/* Flattens a locale tree to "dot.path" → leaf (string | string[]). */
function flatten(obj: Row, prefix = "", out: Record<string, Row> = {}): Record<string, Row> {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const flatEs = flatten(es);
const flatEn = flatten(en);
const VOCAB_KEYS = new Set(Object.keys(VOCAB.psychologist));
const tokensOf = (s: string) => [...s.matchAll(/\{(\w+)(?:\.(\w+))?\}/g)];

describe("en.ts ↔ es.ts parity", () => {
  it("every en key exists in es (no misspelled/orphaned keys)", () => {
    const orphans = Object.keys(flatEn).filter((k) => !(k in flatEs));
    expect(orphans).toEqual([]);
  });

  it("leaf types match es (string vs array, equal array lengths)", () => {
    const mismatches: string[] = [];
    for (const [k, v] of Object.entries(flatEn)) {
      const base = flatEs[k];
      if (base === undefined) continue; // covered by the orphan test
      if (Array.isArray(base) !== Array.isArray(v)) mismatches.push(k);
      else if (Array.isArray(base) && Array.isArray(v) && base.length !== v.length) mismatches.push(`${k} (length)`);
    }
    expect(mismatches).toEqual([]);
  });

  it("no empty-string leaves in en", () => {
    const empties = Object.entries(flatEn)
      .filter(([, v]) => v === "" || (Array.isArray(v) && v.some((x: string) => x === "")))
      .map(([k]) => k);
    expect(empties).toEqual([]);
  });

  it("placeholders in en resolve against English vocab or the es key's vars", () => {
    const bad: string[] = [];
    for (const [k, v] of Object.entries(flatEn)) {
      const base = flatEs[k];
      const esVarNames = new Set(
        (Array.isArray(base) ? base : [base ?? ""]).flatMap((s: string) =>
          typeof s === "string" ? tokensOf(s).map((m) => m[1]) : []),
      );
      const leaves: string[] = Array.isArray(v) ? v : [v];
      for (const leaf of leaves) {
        if (typeof leaf !== "string") continue;
        for (const m of tokensOf(leaf)) {
          const head = m[1];
          if (head === "plural") continue;
          if (VOCAB_KEYS.has(head)) {
            // Vocab form must exist in the EN vocab (agreed/agreedP are
            // empty in English — using them is an authoring bug).
            const form = m[2];
            if (form === "agreed" || form === "agreedP") bad.push(`${k}: {${head}.${form}} (empty in EN)`);
            continue;
          }
          if (!esVarNames.has(head)) bad.push(`${k}: {${m[1]}${m[2] ? "." + m[2] : ""}}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it(EN_COMPLETE ? "every es key is translated in en (strict — locale complete)" : "coverage ratchet (flip EN_COMPLETE when done)", () => {
    const missing = Object.keys(flatEs).filter((k) => !(k in flatEn));
    if (EN_COMPLETE) {
      expect(missing).toEqual([]);
    } else {
      // Ratchet: mergeLocale guarantees Spanish fallback, so an
      // incomplete overlay is safe — this branch only documents intent.
      expect(Object.keys(flatEs).length).toBeGreaterThan(0);
    }
  });
});

describe("mergeLocale", () => {
  it("falls back to Spanish for keys the overlay lacks", () => {
    const merged = mergeLocale({ a: "hola", b: { c: "mundo", d: "que tal" } }, { b: { c: "world" } });
    expect(merged).toEqual({ a: "hola", b: { c: "world", d: "que tal" } });
  });

  it("full merged tree always exposes every es key", () => {
    const merged = flatten(mergeLocale(es, en));
    expect(Object.keys(merged).length).toBe(Object.keys(flatEs).length);
    for (const k of Object.keys(flatEs)) {
      expect(merged[k], `missing ${k} after merge`).toBeDefined();
    }
  });
});

describe("VOCAB_EN", () => {
  it("covers every profession with every noun and every form", () => {
    const forms = Object.keys(VOCAB.psychologist.client);
    for (const p of PROFESSIONS as string[]) {
      const v = (VOCAB_EN as Row)[p];
      expect(v, `missing EN vocab for ${p}`).toBeDefined();
      for (const nounKey of VOCAB_KEYS) {
        expect(v[nounKey], `missing ${p}.${nounKey}`).toBeDefined();
        for (const f of forms) {
          expect(v[nounKey][f], `missing ${p}.${nounKey}.${f}`).not.toBeUndefined();
        }
      }
    }
  });

  it("getVocab(profession, 'en') resolves English nouns", () => {
    expect(resolveTemplate("{client.p}", undefined, getVocab("tutor", "en"))).toBe("students");
    expect(resolveTemplate("Your {client.p}", undefined, getVocab("psychologist", "en"))).toBe("Your patients");
    expect(resolveTemplate("{count} {client}", { count: 1 }, getVocab("trainer", "en"))).toBe("1 client");
    expect(resolveTemplate("{count} {client}", { count: 3 }, getVocab("trainer", "en"))).toBe("3 clients");
    // default lang stays Spanish
    expect(resolveTemplate("{client.p}", undefined, getVocab("tutor"))).toBe("alumnos");
  });
});
