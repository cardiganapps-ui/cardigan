import { describe, it, expect } from "vitest";
import { diffLines, diffSummary } from "../noteDiff";

describe("noteDiff::diffLines", () => {
  it("returns [] when both sides are empty", () => {
    expect(diffLines("", "")).toEqual([]);
    expect(diffLines(null, null)).toEqual([]);
    expect(diffLines(undefined, "")).toEqual([]);
  });

  it("marks every line as 'added' when before is empty", () => {
    const chunks = diffLines("", "one\ntwo");
    expect(chunks).toEqual([{ type: "added", text: "one\ntwo" }]);
  });

  it("marks every line as 'removed' when after is empty", () => {
    const chunks = diffLines("one\ntwo", "");
    expect(chunks).toEqual([{ type: "removed", text: "one\ntwo" }]);
  });

  it("collapses identical bodies into a single 'same' chunk", () => {
    const body = "Lorem\nIpsum\nDolor";
    const chunks = diffLines(body, body);
    expect(chunks).toEqual([{ type: "same", text: body }]);
  });

  it("captures a single inserted line in the middle", () => {
    const before = "a\nb\nd";
    const after = "a\nb\nc\nd";
    const chunks = diffLines(before, after);
    expect(chunks).toEqual([
      { type: "same", text: "a\nb" },
      { type: "added", text: "c" },
      { type: "same", text: "d" },
    ]);
  });

  it("captures a single removed line in the middle", () => {
    const before = "a\nb\nc\nd";
    const after = "a\nb\nd";
    const chunks = diffLines(before, after);
    expect(chunks).toEqual([
      { type: "same", text: "a\nb" },
      { type: "removed", text: "c" },
      { type: "same", text: "d" },
    ]);
  });

  it("captures both an added and a removed block in one pass", () => {
    const before = "intro\nold-line\noutro";
    const after = "intro\nnew-line\nextra-line\noutro";
    const chunks = diffLines(before, after);
    // Whichever order the LCS reverse-walk picks (removed-then-added or
    // added-then-removed), both ops must be present alongside the
    // shared prefix and suffix.
    expect(chunks.find(c => c.type === "same" && c.text === "intro")).toBeTruthy();
    expect(chunks.find(c => c.type === "removed" && c.text === "old-line")).toBeTruthy();
    expect(chunks.some(c => c.type === "added" && c.text.includes("new-line"))).toBe(true);
    expect(chunks.some(c => c.type === "added" && c.text.includes("extra-line"))).toBe(true);
    expect(chunks.find(c => c.type === "same" && c.text === "outro")).toBeTruthy();
  });

  it("normalises a trailing newline so chunk counts stay predictable", () => {
    const a = diffLines("one\ntwo", "one\ntwo\n");
    expect(a).toEqual([{ type: "same", text: "one\ntwo" }]);
  });
});

describe("noteDiff::diffSummary", () => {
  it("returns 0/0 for empty input", () => {
    expect(diffSummary("", "")).toEqual({ added: 0, removed: 0 });
  });

  it("counts inserted lines as 'added'", () => {
    expect(diffSummary("a", "a\nb\nc")).toEqual({ added: 2, removed: 0 });
  });

  it("counts deleted lines as 'removed'", () => {
    expect(diffSummary("a\nb\nc", "a")).toEqual({ added: 0, removed: 2 });
  });

  it("counts both directions for a replacement", () => {
    // Two lines swapped for two different lines = +2 / -2.
    expect(diffSummary("foo\nbar", "baz\nqux")).toEqual({ added: 2, removed: 2 });
  });

  it("ignores order-preserving identical content", () => {
    expect(diffSummary("alpha\nbeta\ngamma", "alpha\nbeta\ngamma")).toEqual({ added: 0, removed: 0 });
  });
});
