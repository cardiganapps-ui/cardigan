import { describe, it, expect } from "vitest";
import { capitalizeName } from "../names";

describe("capitalizeName", () => {
  it("uppercases the first letter of each space-separated word", () => {
    expect(capitalizeName("ana lópez")).toBe("Ana López");
  });

  it("leaves an already-capitalized word alone", () => {
    expect(capitalizeName("Ana Lopez")).toBe("Ana Lopez");
  });

  it("does not lowercase the rest of a word — preserves embedded caps", () => {
    expect(capitalizeName("MacGyver")).toBe("MacGyver");
    expect(capitalizeName("DiNardo")).toBe("DiNardo");
  });

  it("does not lowercase fully-uppercase input — only ensures first char per word", () => {
    expect(capitalizeName("MARÍA CRUZ")).toBe("MARÍA CRUZ");
  });

  it("handles accented Unicode letters", () => {
    expect(capitalizeName("ángel ñoño")).toBe("Ángel Ñoño");
  });

  it("preserves the original spacing (single spaces between words, leading/trailing whitespace as typed)", () => {
    expect(capitalizeName("  juan  pérez  ")).toBe("  Juan  Pérez  ");
  });

  it("returns empty / non-string inputs unchanged", () => {
    expect(capitalizeName("")).toBe("");
    expect(capitalizeName(null)).toBe(null);
    expect(capitalizeName(undefined)).toBe(undefined);
  });

  it("preserves length so a caret in a controlled input stays put", () => {
    const input = "ana lópez";
    expect(capitalizeName(input).length).toBe(input.length);
  });
});
