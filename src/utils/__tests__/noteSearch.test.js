import { describe, it, expect } from "vitest";
import { normalize, tokenize, matches, buildHaystack, buildExcerpt } from "../noteSearch.js";

describe("normalize", () => {
  it("strips diacritics", () => {
    expect(normalize("sueño")).toBe("sueno");
    expect(normalize("ÁéÍóÚ")).toBe("aeiou");
    expect(normalize("Avance")).toBe("avance");
  });
  it("handles empty / null", () => {
    expect(normalize("")).toBe("");
    expect(normalize(null)).toBe("");
    expect(normalize(undefined)).toBe("");
  });
});

describe("tokenize", () => {
  it("splits on whitespace", () => {
    expect(tokenize("ansiedad sueño")).toEqual(["ansiedad", "sueno"]);
  });
  it("preserves quoted phrases", () => {
    expect(tokenize('primera sesión "plan inicial"')).toEqual([
      "primera", "sesion", "plan inicial",
    ]);
  });
  it("returns [] for empty", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("matches (AND across terms)", () => {
  const note = { title: "Avance significativo", content: "Trabajamos ansiedad social y sueño." };
  const patient = { name: "Andrea Morales" };

  it("requires every term to appear", () => {
    expect(matches(note, patient, tokenize("ansiedad sueño"))).toBe(true);
    expect(matches(note, patient, tokenize("ansiedad lectura"))).toBe(false);
  });
  it("is diacritic-insensitive", () => {
    expect(matches(note, patient, tokenize("sueno"))).toBe(true);
    expect(matches(note, patient, tokenize("ANSIEDAD"))).toBe(true);
  });
  it("matches across title + content + patient name", () => {
    expect(matches(note, patient, tokenize("avance"))).toBe(true);
    expect(matches(note, patient, tokenize("morales"))).toBe(true);
  });
  it("empty query matches everything", () => {
    expect(matches(note, patient, tokenize(""))).toBe(true);
  });
});

describe("buildHaystack", () => {
  it("concatenates fields with separator", () => {
    const h = buildHaystack(
      { title: "T", content: "C" },
      { name: "Patient X" }
    );
    expect(h).toContain("t");
    expect(h).toContain("c");
    expect(h).toContain("patient x");
  });
  it("tolerates missing patient", () => {
    expect(buildHaystack({ title: "T" }, null)).toContain("t");
  });
});

describe("buildExcerpt", () => {
  it("returns a window around the first match", () => {
    const note = {
      content: "Lorem ipsum dolor sit amet, consectetur adipiscing elit ANSIEDAD sed do eiusmod tempor.",
    };
    const ex = buildExcerpt(note, ["ansiedad"]);
    expect(ex).toContain("ANSIEDAD");
    expect(ex.length).toBeLessThanOrEqual(122); // 120 + leading/trailing ellipsis
  });
  it("returns empty when no match", () => {
    expect(buildExcerpt({ content: "hello" }, ["xyz"])).toBe("");
  });
  it("returns empty for empty content", () => {
    expect(buildExcerpt({ content: "" }, ["x"])).toBe("");
  });
});
