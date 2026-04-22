import { describe, it, expect } from "vitest";
import {
  tokenizeLine,
  renderLineHTML,
  getListPrefix,
  activeFormatsAt,
  toggleBlock,
  toggleInline,
  toggleTaskOnLine,
  toPlainText,
} from "../../components/notes/markdownModel.js";
import { NOTE_TEMPLATES } from "../../data/noteTemplates.js";

describe("tokenizeLine — block detection", () => {
  it("detects h1/h2/h3", () => {
    expect(tokenizeLine("# Title").block).toBe("h1");
    expect(tokenizeLine("## Sub").block).toBe("h2");
    expect(tokenizeLine("### Small").block).toBe("h3");
  });

  it("does not treat #### as a heading", () => {
    expect(tokenizeLine("#### four").block).toBe("p");
  });

  it("detects bullet with - and *", () => {
    expect(tokenizeLine("- item").block).toBe("ul");
    expect(tokenizeLine("* item").block).toBe("ul");
  });

  it("detects numbered", () => {
    const t = tokenizeLine("12. item");
    expect(t.block).toBe("ol");
    expect(t.listMarker).toBe("12.");
  });

  it("detects task checked / unchecked", () => {
    expect(tokenizeLine("[ ] todo").taskChecked).toBe(false);
    expect(tokenizeLine("[x] done").taskChecked).toBe(true);
    expect(tokenizeLine("[X] done").taskChecked).toBe(true);
  });

  it("captures indent for lists", () => {
    expect(tokenizeLine("  - nested").indent).toBe(2);
    expect(tokenizeLine("    [ ] deep").indent).toBe(4);
  });

  it("plain line is a paragraph", () => {
    expect(tokenizeLine("just text").block).toBe("p");
    expect(tokenizeLine("").block).toBe("p");
  });
});

describe("tokenizeLine — inline parsing", () => {
  const inlineKinds = (raw) => tokenizeLine(raw).inline.filter(t => t.kind !== "text").map(t => t.kind);

  it("parses bold, italic, strike, code", () => {
    expect(inlineKinds("**bold**")).toEqual(["strong"]);
    expect(inlineKinds("*italic*")).toEqual(["em"]);
    expect(inlineKinds("~~strike~~")).toEqual(["strike"]);
    expect(inlineKinds("`code`")).toEqual(["code"]);
  });

  it("mixes kinds in one line", () => {
    expect(inlineKinds("**a** and *b*")).toEqual(["strong", "em"]);
  });

  it("unclosed delimiters are plain text", () => {
    expect(inlineKinds("**unclosed")).toEqual([]);
    expect(inlineKinds("*halfway")).toEqual([]);
  });

  it("does not treat ** as italic", () => {
    // Before fix, greedy * might catch **bold** as two italics
    expect(inlineKinds("**bold**")).toEqual(["strong"]);
  });

  it("empty delimited content is skipped", () => {
    expect(inlineKinds("** **")).toEqual([]);
    expect(inlineKinds("``")).toEqual([]);
  });

  it("computes contentStart/End for caret math", () => {
    const tk = tokenizeLine("**hi**");
    const strong = tk.inline.find(t => t.kind === "strong");
    expect(strong.contentStart).toBe(2);
    expect(strong.contentEnd).toBe(4);
  });

  it("inline under heading respects contentStart offset", () => {
    const tk = tokenizeLine("# **title**");
    const strong = tk.inline.find(t => t.kind === "strong");
    expect(strong.contentStart).toBe(4); // after "# **"
    expect(strong.contentEnd).toBe(9);
  });
});

describe("getListPrefix — smart Enter", () => {
  it("continues bullet", () => {
    expect(getListPrefix("- item")).toMatchObject({ mode: "continue", prefix: "- " });
  });

  it("continues numbered and increments", () => {
    expect(getListPrefix("3. item")).toMatchObject({ mode: "continue", prefix: "4. " });
  });

  it("continues task with unchecked box regardless of prior state", () => {
    expect(getListPrefix("[x] done")).toMatchObject({ mode: "continue", prefix: "[ ] " });
  });

  it("exits on empty list item", () => {
    expect(getListPrefix("- ")).toMatchObject({ mode: "exit" });
    expect(getListPrefix("[ ] ")).toMatchObject({ mode: "exit" });
    expect(getListPrefix("1. ")).toMatchObject({ mode: "exit" });
  });

  it("returns null for non-list lines", () => {
    expect(getListPrefix("plain text")).toBe(null);
    expect(getListPrefix("")).toBe(null);
  });

  it("preserves indent on continuation", () => {
    expect(getListPrefix("  - item")).toMatchObject({ prefix: "  - " });
    expect(getListPrefix("    [ ] deep")).toMatchObject({ prefix: "    [ ] " });
  });
});

describe("activeFormatsAt — toolbar state", () => {
  it("reports strong when caret is inside bold run", () => {
    // **hi**  cols: 0 1 2 3 4 5 6   caret at col 3 is between 'h' and 'i'
    expect(activeFormatsAt("**hi**", 3).has("strong")).toBe(true);
  });

  it("does not report strong when caret is outside", () => {
    expect(activeFormatsAt("**hi** there", 9).has("strong")).toBe(false);
  });

  it("reports block format", () => {
    expect(activeFormatsAt("# Heading", 5).has("h1")).toBe(true);
    expect(activeFormatsAt("- item", 3).has("ul")).toBe(true);
    expect(activeFormatsAt("[ ] todo", 5).has("task")).toBe(true);
  });
});

describe("toggleBlock — block-level toggle", () => {
  it("adds h1 to a plain line", () => {
    expect(toggleBlock("hi", "h1").line).toBe("# hi");
  });

  it("removes h1 when re-toggled", () => {
    expect(toggleBlock("# hi", "h1").line).toBe("hi");
  });

  it("converts ul to task", () => {
    const { line } = toggleBlock("- eggs", "task");
    expect(line).toBe("[ ] eggs");
  });

  it("preserves indent when toggling lists", () => {
    const { line } = toggleBlock("  - inner", "ol");
    expect(line).toBe("  1. inner");
  });
});

describe("toggleInline — inline wrap/unwrap", () => {
  it("wraps selection in bold", () => {
    const r = toggleInline("hello world", 0, 5, "strong");
    expect(r.line).toBe("**hello** world");
    expect(r.start).toBe(2);
    expect(r.end).toBe(7);
  });

  it("unwraps already-bold selection", () => {
    const r = toggleInline("**hello** world", 2, 7, "strong");
    expect(r.line).toBe("hello world");
    expect(r.start).toBe(0);
    expect(r.end).toBe(5);
  });

  it("inserts empty pair at caret with no selection", () => {
    const r = toggleInline("hi", 1, 1, "em");
    expect(r.line).toBe("h**i"); // actually em is single * — expect h*|*i
  });

  it("inserts empty italic pair at caret", () => {
    const r = toggleInline("hi", 1, 1, "em");
    expect(r.line).toBe("h**i");
    expect(r.start).toBe(2);
  });
});

describe("toggleTaskOnLine — checkbox toggle", () => {
  it("toggles unchecked to checked", () => {
    expect(toggleTaskOnLine("[ ] todo")).toEqual({ line: "[x] todo", nextChecked: true });
  });

  it("toggles checked to unchecked", () => {
    expect(toggleTaskOnLine("[x] done")).toEqual({ line: "[ ] done", nextChecked: false });
  });

  it("preserves indent", () => {
    expect(toggleTaskOnLine("  [ ] nested").line).toBe("  [x] nested");
  });

  it("no-op on non-task lines", () => {
    expect(toggleTaskOnLine("plain").line).toBe("plain");
  });
});

describe("renderLineHTML — structure", () => {
  it("wraps strong with md-syntax spans around content", () => {
    const html = renderLineHTML(tokenizeLine("**hi**"));
    expect(html).toContain('<strong class="md-strong">hi</strong>');
    expect(html).toContain('<span class="md-syntax" data-syn="2">**</span>');
  });

  it("renders heading block syntax and inline inside heading span", () => {
    const html = renderLineHTML(tokenizeLine("# Title"));
    expect(html).toContain('<span class="md-syntax" data-syn="2"># </span>');
    expect(html).toContain('<span class="md-heading md-h1">Title</span>');
  });

  it("renders task with interactive button", () => {
    const html = renderLineHTML(tokenizeLine("[ ] todo"), { lineIdx: 5 });
    expect(html).toContain('data-mde-checkbox');
    expect(html).toContain('data-line="5"');
    expect(html).toContain('aria-pressed="false"');
  });

  it("marks readonly task button as disabled", () => {
    const html = renderLineHTML(tokenizeLine("[x] done"), { readOnly: true });
    expect(html).toContain("disabled");
    expect(html).toContain('aria-pressed="true"');
  });

  it("escapes HTML in content", () => {
    const html = renderLineHTML(tokenizeLine("<script>alert(1)</script>"));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("round-trip — templates must be byte-exact", () => {
  it("every template round-trips through split/join", () => {
    for (const tpl of NOTE_TEMPLATES) {
      if (!tpl.content) continue;
      const lines = tpl.content.split("\n");
      // The source of truth is the raw line array — just verify it joins back.
      expect(lines.join("\n")).toBe(tpl.content);
      // And every line tokenizes without throwing and preserves its raw length.
      for (const ln of lines) {
        const tk = tokenizeLine(ln);
        expect(tk.rawLen).toBe(ln.length);
      }
    }
  });
});

describe("toPlainText — export / copy", () => {
  it("strips inline syntax", () => {
    expect(toPlainText("**hi** *there*")).toBe("hi there");
  });

  it("renders bullets as •", () => {
    expect(toPlainText("- one\n- two")).toBe("• one\n• two");
  });

  it("renders tasks as ○ / ✓", () => {
    expect(toPlainText("[ ] todo\n[x] done")).toBe("○ todo\n✓ done");
  });

  it("drops heading syntax but preserves text", () => {
    expect(toPlainText("# Title\nbody")).toBe("Title\nbody");
  });
});
