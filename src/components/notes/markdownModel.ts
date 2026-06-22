/* ── Cardigan notes — live markdown model ───────────────────────────
   Pure functions that translate raw markdown text into a token model
   and back. The source of truth in the editor is always `lines: string[]`
   of raw markdown; these helpers only derive DOM and restore caret
   positions. Stateless and safe to unit-test.

   Supported syntax (intentionally narrow — matches what Apple Notes
   and Bear render inline):
     • Block:  # / ## / ### heading, `- `/`* ` bullet, `1. ` numbered,
               `[ ]`/`[x]` task, blank paragraph.
     • Inline: **bold**, *italic*, ~~strike~~, `code`.

   Whitespace indent groups list items (two spaces per level). Nested
   inline (e.g. ***both***) is not honored — too ambiguous and not
   rendered by our reference apps either. */

export type InlineKind = "text" | "code" | "strong" | "strike" | "em" | "mark";

export interface InlineToken {
  kind: InlineKind;
  rawStart: number;
  rawEnd: number;
  text: string;
  contentStart?: number;
  contentEnd?: number;
  syntaxLen?: number;
  leftSyntax?: string;
  rightSyntax?: string;
}

export interface LineToken {
  block: string;
  blockSyntax: string;
  blockSyntaxLen: number;
  inline: InlineToken[];
  taskChecked: boolean;
  indent: number;
  listMarker: string | null;
  rawLen: number;
  contentStart: number;
  raw: string;
  attachmentId?: string;
  alt?: string;
}

export function escapeHtml(s?: string | null) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Inline: find balanced delimiter pairs in priority order, fill gaps
   with text tokens. Priority: code > strong > strike > em. A higher
   priority pair claims its range so a weaker rule can't re-match any
   character already inside. Single-line only. */
const INLINE_RULES = [
  { kind: "code",   re: /`([^`\n]+?)`/g,           syntax: 1 },
  { kind: "strong", re: /\*\*([^\n]+?)\*\*/g,      syntax: 2 },
  { kind: "strike", re: /~~([^\n]+?)~~/g,          syntax: 2 },
  // Highlight (`==text==`) — Obsidian / Bear use the same syntax.
  // Two equals signs, single-line, no nested wrapping. The
  // lookarounds prevent greedy match into triple-equals runs:
  // `===title===` should render literally, not as `<mark>=title=</mark>`.
  // The content also can't start or end with `=` for the same
  // reason. Renderer emits <mark>.
  { kind: "mark",   re: /(?<!=)==([^=\n](?:[^\n]*?[^=\n])?|[^=\n])==(?!=)/g, syntax: 2 },
  { kind: "em",     re: /(?<!\*)\*([^*\n]+?)\*(?!\*)/g, syntax: 1 },
];

function parseInline(text?: string | null, baseOffset = 0): InlineToken[] {
  if (!text) return [];
  const claims: { start: number; end: number; kind: InlineKind; syntaxLen: number }[] = [];
  for (const rule of INLINE_RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      // Skip if overlaps an existing claim
      if (claims.some(c => !(end <= c.start || start >= c.end))) continue;
      // Skip empty content (e.g. `** **` after trim)
      const inner = m[1];
      if (!inner || !inner.trim()) continue;
      claims.push({ start, end, kind: rule.kind as InlineKind, syntaxLen: rule.syntax });
    }
  }
  claims.sort((a, b) => a.start - b.start);

  const tokens: InlineToken[] = [];
  let cursor = 0;
  for (const c of claims) {
    if (c.start > cursor) {
      tokens.push({
        kind: "text",
        rawStart: baseOffset + cursor,
        rawEnd: baseOffset + c.start,
        text: text.slice(cursor, c.start),
      });
    }
    tokens.push({
      kind: c.kind,
      rawStart: baseOffset + c.start,
      rawEnd: baseOffset + c.end,
      contentStart: baseOffset + c.start + c.syntaxLen,
      contentEnd: baseOffset + c.end - c.syntaxLen,
      text: text.slice(c.start + c.syntaxLen, c.end - c.syntaxLen),
      syntaxLen: c.syntaxLen,
      leftSyntax: text.slice(c.start, c.start + c.syntaxLen),
      rightSyntax: text.slice(c.end - c.syntaxLen, c.end),
    });
    cursor = c.end;
  }
  if (cursor < text.length) {
    tokens.push({
      kind: "text",
      rawStart: baseOffset + cursor,
      rawEnd: baseOffset + text.length,
      text: text.slice(cursor),
    });
  }
  return tokens;
}

/* Block + inline tokenizer for a single line. `contentStart` is the
   raw-text column where the inline content begins (after block syntax
   like "# " or "  - "). */
export function tokenizeLine(raw?: string | null): LineToken {
  if (raw == null) raw = "";
  let m: RegExpMatchArray | null;

  // Image-only line: `![alt](attachment:<uuid>)` on its own. Whole
  // line = one image. We special-case at block level so the renderer
  // can swap visible content (inline <img> off-caret, raw markdown
  // on-caret) without disturbing the inline tokeniser. Inline image
  // mixing with paragraph text is out of scope for v1.
  // Trailing whitespace is forgiven (paste from another app can
   // leave a stray space) — the line still renders as an image.
  if ((m = raw.match(/^!\[([^\]]*)\]\(attachment:([0-9a-fA-F-]+)\)\s*$/))) {
    return {
      block: "image",
      blockSyntax: raw,
      blockSyntaxLen: raw.length,
      inline: [],
      taskChecked: false,
      indent: 0,
      listMarker: null,
      rawLen: raw.length,
      contentStart: 0,
      raw,
      attachmentId: m[2],
      alt: m[1],
    };
  }

  if ((m = raw.match(/^(#{1,3}) (.*)$/))) {
    const level = m[1].length;
    const contentStart = m[1].length + 1;
    return {
      block: "h" + level,
      blockSyntax: m[1] + " ",
      blockSyntaxLen: contentStart,
      inline: parseInline(m[2], contentStart),
      taskChecked: false,
      indent: 0,
      listMarker: null,
      rawLen: raw.length,
      contentStart,
      raw,
    };
  }
  if ((m = raw.match(/^( *)\[( |x|X)\] (.*)$/))) {
    const indent = m[1].length;
    const contentStart = indent + 4;
    return {
      block: "task",
      blockSyntax: raw.slice(0, contentStart),
      blockSyntaxLen: contentStart,
      inline: parseInline(m[3], contentStart),
      taskChecked: m[2].toLowerCase() === "x",
      indent,
      listMarker: "task",
      rawLen: raw.length,
      contentStart,
      raw,
    };
  }
  if ((m = raw.match(/^( *)([-*]) (.*)$/))) {
    const indent = m[1].length;
    const contentStart = indent + 2;
    return {
      block: "ul",
      blockSyntax: raw.slice(0, contentStart),
      blockSyntaxLen: contentStart,
      inline: parseInline(m[3], contentStart),
      taskChecked: false,
      indent,
      listMarker: m[2],
      rawLen: raw.length,
      contentStart,
      raw,
    };
  }
  if ((m = raw.match(/^( *)(\d+)\. (.*)$/))) {
    const indent = m[1].length;
    const contentStart = indent + m[2].length + 2;
    return {
      block: "ol",
      blockSyntax: raw.slice(0, contentStart),
      blockSyntaxLen: contentStart,
      inline: parseInline(m[3], contentStart),
      taskChecked: false,
      indent,
      listMarker: m[2] + ".",
      rawLen: raw.length,
      contentStart,
      raw,
    };
  }
  return {
    block: "p",
    blockSyntax: "",
    blockSyntaxLen: 0,
    inline: parseInline(raw, 0),
    taskChecked: false,
    indent: 0,
    listMarker: null,
    rawLen: raw.length,
    contentStart: 0,
    raw,
  };
}

/* Render one tokenized line to HTML. The output contains:
     - <span class="md-syntax" data-syn="n"> wrappers for raw
       markdown characters that must remain in the DOM for caret math
       but are visually collapsed when the line is not focused.
     - <button data-mde-checkbox> for task lines (a real interactive
       element; contenteditable=false so the browser doesn't treat it
       as editable text, and data-nocount so caret walker skips it).
     - Visible "decorator" markers (bullet dot, ordered number prefix,
       etc.) are rendered via CSS ::before on the line div, NOT in the
       DOM, so they don't affect caret positioning.

   Every text-bearing DOM node contributes exactly as many characters
   to `textContent` as the raw line's corresponding slice — this is
   how caret restoration maps `col` (raw markdown column) back to a
   DOM Range. Decorators that don't exist in the raw text use
   `data-nocount="1"` (or a DOM element with zero text) so the walker
   skips them. */
export function renderLineHTML(token: LineToken, { readOnly = false, lineIdx = 0 }: { readOnly?: boolean; lineIdx?: number; hasCaret?: boolean } = {}) {
  let html = "";

  // Image block — emit the raw markdown span AND a sibling <img>
  // placeholder. Existing `.md-syntax { display: none }` off-caret
  // CSS hides the raw text by default; CSS toggles below
  // (.mde-line.has-caret) flip the visibility so the user sees the
  // markdown when editing the line, and the image when not.
  // src is left blank — the editor's render effect resolves it from
  // useAttachmentSrc and sets it imperatively. data-mde-attachment
  // is the hook key.
  if (token.block === "image") {
    html += `<span class="md-syntax md-image-raw" data-syn="${token.raw.length}">${escapeHtml(token.raw)}</span>`;
    html += `<span class="md-image-frame" data-nocount="1" contenteditable="false"><img class="md-attachment-img" data-mde-attachment="${escapeHtml(token.attachmentId)}" alt="${escapeHtml(token.alt)}" /></span>`;
    html += `<span class="mde-eol" data-nocount="1">${"​"}</span>`;
    return html;
  }

  if (token.block === "task") {
    // Leading indent spaces + interactive checkbox + raw "[ ] ".
    // The button has no inner text and data-nocount so caret math
    // ignores it; it overlays the (hidden off-caret) raw "[ ] " span.
    const leadingSpaces = token.raw.slice(0, token.indent);
    if (leadingSpaces) html += `<span class="md-syntax" data-syn="${leadingSpaces.length}">${escapeHtml(leadingSpaces)}</span>`;
    const pressed = token.taskChecked ? "true" : "false";
    const disabled = readOnly ? "disabled" : "";
    html += `<button type="button" class="mde-check${token.taskChecked ? " is-checked" : ""}" data-mde-checkbox data-line="${lineIdx}" data-nocount="1" aria-pressed="${pressed}" contenteditable="false" tabindex="-1" ${disabled}></button>`;
    const bracket = token.taskChecked ? "x" : " ";
    html += `<span class="md-syntax" data-syn="4">[${bracket}] </span>`;
  } else if (token.blockSyntax) {
    html += `<span class="md-syntax" data-syn="${token.blockSyntax.length}">${escapeHtml(token.blockSyntax)}</span>`;
  }

  // Inline content, wrapped in the heading display tag if present.
  const inlineHTML = token.inline.map(renderInline).join("");
  if (token.block === "h1" || token.block === "h2" || token.block === "h3") {
    const emptyClass = token.inline.length === 0 ? " is-empty" : "";
    html += `<span class="md-heading md-${token.block}${emptyClass}">${inlineHTML}</span>`;
  } else {
    html += inlineHTML;
  }

  // Zero-width trailing caret target. Browsers struggle to place a
  // caret after the last character on a line that ends in a block
  // element; appending a zero-width space node gives the walker a
  // reliable endpoint. data-nocount so it doesn't skew columns.
  html += `<span class="mde-eol" data-nocount="1">${"\u200B"}</span>`;

  return html;
}

function renderInline(tok: InlineToken) {
  if (tok.kind === "text") return escapeHtml(tok.text);
  const leftSyn  = `<span class="md-syntax" data-syn="${tok.syntaxLen}">${escapeHtml(tok.leftSyntax)}</span>`;
  const rightSyn = `<span class="md-syntax" data-syn="${tok.syntaxLen}">${escapeHtml(tok.rightSyntax)}</span>`;
  const inner = escapeHtml(tok.text);
  if (tok.kind === "strong") return `${leftSyn}<strong class="md-strong">${inner}</strong>${rightSyn}`;
  if (tok.kind === "em")     return `${leftSyn}<em class="md-em">${inner}</em>${rightSyn}`;
  if (tok.kind === "strike") return `${leftSyn}<span class="md-strike">${inner}</span>${rightSyn}`;
  if (tok.kind === "code")   return `${leftSyn}<code class="md-code">${inner}</code>${rightSyn}`;
  if (tok.kind === "mark")   return `${leftSyn}<mark class="md-mark">${inner}</mark>${rightSyn}`;
  return escapeHtml(tok.text || "");
}

/* Line class list (applied to `<div class="mde-line …">` so CSS can
   handle display-font sizing, bullet/number ::before markers, task
   alignment, indent padding, etc.). Consumers also toggle
   "has-caret" based on selection state. */
export function lineClassNames(token: LineToken) {
  const cls = ["mde-line", `mde-line--${token.block}`];
  if (token.block === "task" && token.taskChecked) cls.push("is-checked");
  if (token.indent > 0) cls.push("mde-line--indent");
  return cls.join(" ");
}

/* Inline style for indent + ordered-list data attr so CSS ::before
   can render the right visible marker when off-caret. */
export function lineDataAttrs(token: LineToken) {
  const attrs: Record<string, string> = {};
  if (token.indent > 0) attrs["data-indent"] = String(Math.floor(token.indent / 2));
  if (token.block === "ol") attrs["data-marker"] = token.listMarker ?? ""; // "1."
  if (token.block === "ul") attrs["data-marker"] = token.listMarker ?? ""; // "-" / "*"
  return attrs;
}

/* True if `lineIdx` falls inside a multi-line code fence (or is a
   fence marker itself). Used by the editor to suppress markdown
   autoformat shortcuts and the slash-command menu when the caret
   is in a code block — typing "- " or "/" in pseudocode should
   stay literal, not transform. Pure O(lineIdx) scan; no allocation. */
export function isInsideFence(lines: string[], lineIdx?: number | null) {
  if (!Array.isArray(lines) || lineIdx == null || lineIdx < 0) return false;
  const upTo = Math.min(lineIdx, lines.length - 1);
  let inside = false;
  for (let i = 0; i <= upTo; i++) {
    const isMarker = /^ {0,3}```/.test(lines[i] || "");
    if (isMarker) {
      // The marker line itself counts as inside — typing on a fence
      // marker line is uncommon and shortcuts there would be confusing.
      if (i === upTo) return true;
      inside = !inside;
    } else if (i === upTo) {
      return inside;
    }
  }
  return inside;
}

/* Smart Enter continuation: the caller feeds the current line text;
   we return the prefix that should start the next line, or null if
   we should exit list mode. Empty list item → exit. */
export function getListPrefix(line?: string | null): { mode: string; prefix: string } | null {
  if (line == null) return null;
  let m: RegExpMatchArray | null;
  if ((m = line.match(/^( *)[-*] /))) {
    const prefix = m[0];
    if (line.trim() === prefix.trim()) return { mode: "exit", prefix };
    return { mode: "continue", prefix };
  }
  if ((m = line.match(/^( *)(\d+)\. /))) {
    const prefix = m[0];
    if (line.trim() === prefix.trim()) return { mode: "exit", prefix };
    const next = `${m[1]}${parseInt(m[2], 10) + 1}. `;
    return { mode: "continue", prefix: next };
  }
  if ((m = line.match(/^( *)\[( |x|X)\] /))) {
    const prefix = m[0];
    if (line.trim() === prefix.trim()) return { mode: "exit", prefix };
    return { mode: "continue", prefix: `${m[1]}[ ] ` };
  }
  return null;
}

/* ── Markdown autoformat shortcuts ─────────────────────────────────
   Called from MarkdownEditor's insertText path before the typed char
   lands. Given the current line, the col where the new character is
   about to be inserted, and the character being typed, returns
   { newLine, newCol } if a shortcut applies — the caller commits
   that as the next state IN PLACE OF inserting the char normally
   (i.e. the typed char is absorbed by the transform). Returns null
   for no transform; caller falls through to default insertion.

   Triggers:
     • "*" + " " at line start (or indented) → "- " (canonical bullet)
     • "[]" + " " at line start (or indented) → "[ ] " (task syntax)
     • "-" + "-" anywhere with col ≥ 2 → "—" (em-dash). The previous
       dash is replaced; the typed dash is absorbed. Skipped when the
       caret would otherwise produce "---", so a deliberate triple-
       dash sequence still types as "—-" (em-dash + hyphen).
     • "." + "." + "." → "…" (ellipsis). Same absorbed-char pattern.

   Deliberately narrow set: every transform here has to either be
   purely typographic (em-dash, ellipsis) or canonicalise a syntax
   the markdown model already understands. We don't introduce NEW
   syntax via shortcuts — the in-app reference for "what markdown
   does this editor support" stays the renderer, not this list. */
export function getShortcutTransform(line: string | null | undefined, caretCol: number, typed?: string | null): { newLine: string; newCol: number } | null {
  if (line == null) line = "";
  if (typed == null) return null;
  const before = line.slice(0, caretCol);

  // Em-dash: two dashes collapse on the second keystroke. Skip when
  // a third dash would land (preserve the user's literal "---").
  if (typed === "-" && before.endsWith("-") && !before.endsWith("--")) {
    return {
      newLine: line.slice(0, caretCol - 1) + "—" + line.slice(caretCol),
      newCol: caretCol,
    };
  }

  // Ellipsis: three dots collapse on the third keystroke. Skip when
  // a fourth would land.
  if (typed === "." && before.endsWith("..") && !before.endsWith("...")) {
    return {
      newLine: line.slice(0, caretCol - 2) + "…" + line.slice(caretCol),
      newCol: caretCol - 1,
    };
  }

  // Below this point: space-triggered canonicalisations only.
  if (typed !== " ") return null;

  // "*" at line start (possibly indented) → "- " (canonical bullet
  // marker). Both "* " and "- " render identically, but "- " is what
  // the rest of the codebase produces (toolbar insert, list-prefix
  // continuation). Canonicalise so the source stays consistent.
  const starMatch = before.match(/^( *)\*$/);
  if (starMatch) {
    const indent = starMatch[1];
    return {
      newLine: indent + "- " + line.slice(caretCol),
      newCol: indent.length + 2,
    };
  }

  // "[]" at line start (possibly indented) → "[ ] " (task syntax).
  // Apple Notes + iA Writer both auto-expand the empty-bracket
  // shorthand into a real task on space; matches the muscle memory.
  const taskMatch = before.match(/^( *)\[\]$/);
  if (taskMatch) {
    const indent = taskMatch[1];
    return {
      newLine: indent + "[ ] " + line.slice(caretCol),
      newCol: indent.length + 4,
    };
  }

  return null;
}

/* Which inline formats does the caret currently sit inside? Used by
   the toolbar to light up active buttons. `col` is the raw-markdown
   column in `line`. Block format is included alongside inline. */
export function activeFormatsAt(line: string | null | undefined, col: number) {
  const token = tokenizeLine(line || "");
  const set = new Set<string>();
  if (token.block !== "p") set.add(token.block);
  for (const inline of token.inline) {
    if (inline.kind === "text") continue;
    if (col >= (inline.contentStart ?? 0) && col <= (inline.contentEnd ?? 0)) set.add(inline.kind);
  }
  return set;
}

/* Toggle a block format on the current line. Used by toolbar buttons
   and keyboard shortcuts. Returns { line, colShift } where colShift
   is the delta to apply to the caret column (positive if syntax was
   added, negative if removed). Preserves the line's inline content. */
export function toggleBlock(line: string | null | undefined, block: string) {
  if (line == null) line = "";
  const token = tokenizeLine(line);
  if (token.block === block) {
    // Toggling off: strip the block syntax.
    const stripped = line.slice(token.blockSyntaxLen);
    // For tasks the syntax includes indent — preserve the indent.
    if (token.block === "task" || token.block === "ul" || token.block === "ol") {
      return { line: " ".repeat(token.indent) + stripped, colShift: token.indent - token.blockSyntaxLen };
    }
    return { line: stripped, colShift: -token.blockSyntaxLen };
  }
  // Convert: strip existing block syntax, then add new.
  const bare = line.slice(token.blockSyntaxLen);
  const indentStr = " ".repeat(token.indent);
  let addition = "";
  if (block === "h1") addition = "# ";
  else if (block === "h2") addition = "## ";
  else if (block === "h3") addition = "### ";
  else if (block === "ul") addition = indentStr + "- ";
  else if (block === "ol") addition = indentStr + "1. ";
  else if (block === "task") addition = indentStr + "[ ] ";
  // Indent already consumed for list blocks; don't double-prefix.
  const prefixed = (block === "h1" || block === "h2" || block === "h3")
    ? indentStr + addition + bare
    : addition + bare;
  return { line: prefixed, colShift: prefixed.length - line.length };
}

/* Toggle an inline wrap around [start, end] on a single line. If the
   selection is already fully wrapped in that delimiter, unwrap. If
   empty selection, insert delimiters at the caret. */
export function toggleInline(line: string | null | undefined, start: number, end: number, kind: string) {
  const delimiter = kind === "strong" ? "**" : kind === "em" ? "*" : kind === "strike" ? "~~" : kind === "code" ? "`" : kind === "mark" ? "==" : null;
  if (!delimiter) return { line: line ?? "", start, end };
  if (line == null) line = "";
  const len = delimiter.length;
  const sel = line.slice(start, end);

  // Already wrapped? Unwrap.
  const hasLeftOuter  = line.slice(Math.max(0, start - len), start) === delimiter;
  const hasRightOuter = line.slice(end, end + len) === delimiter;
  if (hasLeftOuter && hasRightOuter) {
    const next = line.slice(0, start - len) + sel + line.slice(end + len);
    return { line: next, start: start - len, end: end - len };
  }
  // Empty selection: insert pair and put caret between.
  if (start === end) {
    const next = line.slice(0, start) + delimiter + delimiter + line.slice(end);
    return { line: next, start: start + len, end: start + len };
  }
  // Wrap.
  const next = line.slice(0, start) + delimiter + sel + delimiter + line.slice(end);
  return { line: next, start: start + len, end: end + len };
}

/* Check if a markdown task line is checked (for tapping the checkbox
   in the editor). Returns { line, nextChecked } with the `[ ]` / `[x]`
   flipped. */
export function toggleTaskOnLine(line: string | null | undefined) {
  if (!line) return { line: line ?? "", nextChecked: false };
  const m = line.match(/^( *)\[( |x|X)\] /);
  if (!m) return { line, nextChecked: false };
  const wasChecked = m[2].toLowerCase() === "x";
  const next = line.slice(0, m[1].length) + (wasChecked ? "[ ] " : "[x] ") + line.slice(m[0].length);
  return { line: next, nextChecked: !wasChecked };
}

/* Plain-text rendering of a note (strips markdown syntax, preserves
   line breaks). Used by the copy / export menu. */
export function toPlainText(content?: string | null) {
  if (!content) return "";
  return content.split("\n").map(line => {
    const token = tokenizeLine(line);
    const body = token.inline.map(tok => tok.kind === "text" ? tok.text : tok.text).join("");
    if (token.block === "task") {
      const mark = token.taskChecked ? "✓" : "○";
      return " ".repeat(token.indent) + `${mark} ${body}`;
    }
    if (token.block === "ul") return " ".repeat(token.indent) + `• ${body}`;
    if (token.block === "ol") return " ".repeat(token.indent) + `${token.listMarker} ${body}`;
    return body;
  }).join("\n");
}
