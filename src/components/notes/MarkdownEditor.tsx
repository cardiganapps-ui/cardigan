import { useEffect, useLayoutEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback, lazy, Suspense } from "react";
// Lazy-loaded so the portal-mounted slash menu doesn't bloat the
// main bundle — it's only ever needed AFTER the user types "/" on
// an empty line, by which point the chunk has time to fetch.
const SlashCommandMenu = lazy(() => import("./SlashCommandMenu").then(m => ({ default: m.SlashCommandMenu })));
import {
  tokenizeLine,
  renderLineHTML,
  lineClassNames,
  lineDataAttrs,
  getListPrefix,
  getShortcutTransform,
  isInsideFence,
  activeFormatsAt,
  toggleBlock,
  toggleInline,
  toggleTaskOnLine,
  escapeHtml,
} from "./markdownModel";
import { haptic } from "../../utils/haptics";
import { addBreadcrumb } from "../../lib/sentry";

interface Caret { line: number; col: number; endLine: number; endCol: number }
interface ModelResult { lines: string[]; caret: { line: number; col: number } }
interface EditorSelection { startLine: number; startCol: number; endLine: number; endCol: number }
interface Snapshot { lines: string[]; caret: Caret }
interface History { past: Snapshot[]; future: Snapshot[]; lastTs: number }
interface SlashMenuState { line: number; anchorRect: DOMRect }
interface FenceInfo { type: "marker" | "body" | "out"; pos: "top" | "bottom" | "only" | null }
type SlashCommandLike = { prefix: string };

export interface MarkdownEditorHandle {
  focus(): void;
  applyInlineFormat(kind: string): void;
  applyBlockFormat(block: string): void;
  setContent(content?: string): void;
  insertText(text?: string): void;
  getActiveFormats(): Set<string>;
  jumpTo(target: { line?: number | null; startCol?: number | null; endCol?: number | null }): void;
}

interface MarkdownEditorProps {
  initialContent?: string;
  readOnly?: boolean;
  onContentChange?: (content: string) => void;
  onSelectionChange?: (sel: { line: number; col: number; endLine: number; endCol: number; active: Set<string> }) => void;
  onRequestFind?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
  attachmentTiles?: Record<string, { url?: string; failed?: true }> | null;
}

/* Multi-line code-fence layout pre-pass. Walks `lines` once and
   returns an array of { type, pos } per line:
     • type: "marker"   — the line is a ``` (open or close)
              "body"    — the line is inside an open fence
              "out"     — normal markdown line
     • pos: "top"       — first marker/body of a run
            "bottom"    — last marker/body of a run
            "only"      — single-line fence run (rare)
            null        — middle of a multi-line run
   The CSS uses `data-fence-pos` to round corners + pad the run's
   first / last lines while keeping the middle uniform. */
function computeFenceLayout(lines: string[]): FenceInfo[] {
  const out: FenceInfo[] = new Array(lines.length);
  let insideFence = false;
  let runStart = -1;
  for (let i = 0; i < lines.length; i++) {
    // CommonMark allows up to 3 leading spaces before a fence
    // marker. We honour that so a fence inside a quoted/indented
    // context renders as a code block instead of literal backticks.
    const isFence = /^ {0,3}```/.test(lines[i] || "");
    if (isFence) {
      // The fence marker itself is part of the run's first / last
      // visual position. Open: pos="top" (run starts here). Close:
      // pos="bottom".
      const pos = insideFence ? "bottom" : "top";
      out[i] = { type: "marker", pos };
      if (insideFence) {
        // Closing the run — backfill body positions if the run
        // contained only one body line, it gets pos="only"? No —
        // body alone in a 3-line run (top marker / body / bottom
        // marker) doesn't need pos differentiation since the
        // markers carry the rounding.
      }
      insideFence = !insideFence;
      runStart = insideFence ? i : -1;
    } else if (insideFence) {
      out[i] = { type: "body", pos: null };
    } else {
      out[i] = { type: "out", pos: null };
    }
  }
  // Suppress the runStart unused-var warning while keeping the
  // variable readable in case future logic needs the open index.
  void runStart;
  return out;
}

/* ── Cardigan notes — live markdown editor component ────────────────
   A contenteditable div whose source of truth is a `lines: string[]`
   model in React state. Every user input is intercepted via
   `beforeinput`, translated into a model mutation, and React then
   re-renders the DOM and restores the caret. This is the same pattern
   Bear / Ulysses use; it's what makes contenteditable stable on
   mobile (no cursor jumps, no browser-inserted <div>/<br> cruft, no
   drift between DOM and model).

   Caret coordinates are always expressed as (lineIdx, col) where
   `col` is the column in the RAW markdown text, not in the rendered
   DOM. Any DOM element that doesn't correspond to raw text (the
   checkbox button, the end-of-line anchor) carries `data-nocount="1"`
   so the caret walker skips it. */

const PLACEHOLDER = "Escribe aquí…";

/* Tiny wrappers around Date.now() / setTimeout. The React Compiler's
   react-hooks/purity rule flags impure calls inline inside the
   component body — moving them to module scope satisfies the linter
   while keeping the behavior identical. */
function nowMs() { return Date.now(); }

function isMac() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
}
const MOD: "metaKey" | "ctrlKey" = isMac() ? "metaKey" : "ctrlKey";

/* ── DOM ↔ model translation ────────────────────────────────────────
   These helpers walk the DOM of a single line div. Text-bearing
   nodes contribute characters to the column count; anything marked
   with data-nocount doesn't. Scan order is document order. */
function walkColRecursive(lineDiv: Node, container: Node, offset: number) {
  let found: number | null = null;
  let count = 0;
  function visit(n: Node) {
    if (found != null) return;
    if (isSkipped(n)) return;
    if (n === container) {
      if (n.nodeType === 3) { found = count + offset; return; }
      for (let i = 0; i < offset && i < n.childNodes.length; i++) {
        count += charsInSubtree(n.childNodes[i]);
      }
      found = count;
      return;
    }
    if (n.nodeType === 3) { count += (n.textContent || "").length; return; }
    for (const c of Array.from(n.childNodes)) visit(c);
  }
  visit(lineDiv);
  return found != null ? found : count;
}

function charsInSubtree(node: Node): number {
  if (isSkipped(node)) return 0;
  if (node.nodeType === 3) return (node.textContent || "").length;
  let total = 0;
  for (const c of Array.from(node.childNodes)) total += charsInSubtree(c);
  return total;
}

function isSkipped(node?: Node | null) {
  if (!node || node.nodeType !== 1) return false;
  const el = node as HTMLElement;
  return !!el.dataset && el.dataset.nocount === "1";
}

/* Place caret at (lineDiv, col). Walks forward in document order,
   counting chars, and builds a Range at the first position where
   the cumulative count reaches col. */
function placeCaret(lineDiv: Node | null | undefined, col: number) {
  if (!lineDiv) return;
  let remaining = col;
  let target: Node | null = null;
  let targetOffset = 0;

  function visit(n: Node) {
    if (target != null) return;
    if (isSkipped(n)) return;
    if (n.nodeType === 3) {
      const len = (n.textContent || "").length;
      if (remaining <= len) {
        target = n;
        targetOffset = remaining;
        remaining = 0;
        return;
      }
      remaining -= len;
      return;
    }
    for (const c of Array.from(n.childNodes)) {
      visit(c);
      if (target != null) return;
    }
  }
  visit(lineDiv);

  const sel = document.getSelection();
  if (!sel) return;
  const range = document.createRange();
  if (target) {
    range.setStart(target, targetOffset);
    range.setEnd(target, targetOffset);
  } else {
    // Fall back to end of line (before the EOL anchor so the caret
    // sits visually at the end of the rendered content).
    range.selectNodeContents(lineDiv);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

function placeSelection(lineDivs: Element[], startLine: number, startCol: number, endLine: number, endCol: number) {
  const startDiv = lineDivs[startLine];
  const endDiv = lineDivs[endLine];
  if (!startDiv || !endDiv) return;
  // Build ranges at each endpoint, combine.
  const makePoint = (div: Node, col: number) => {
    let remaining = col;
    let targetNode: Node | null = null, targetOffset = 0;
    function visit(n: Node) {
      if (targetNode != null) return;
      if (isSkipped(n)) return;
      if (n.nodeType === 3) {
        const len = (n.textContent || "").length;
        if (remaining <= len) { targetNode = n; targetOffset = remaining; remaining = 0; return; }
        remaining -= len;
        return;
      }
      for (const c of Array.from(n.childNodes)) { visit(c); if (targetNode != null) return; }
    }
    visit(div);
    if (!targetNode) {
      // End-of-content fallback
      const r = document.createRange();
      r.selectNodeContents(div);
      r.collapse(false);
      return { node: r.endContainer, offset: r.endOffset };
    }
    return { node: targetNode, offset: targetOffset };
  };
  const start = makePoint(startDiv, startCol);
  const end = makePoint(endDiv, endCol);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const sel = document.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

/* ── Model ops ──────────────────────────────────────────────────────
   Pure functions over the `lines` array. Each returns the next
   `lines` plus the caret/selection to restore. */

function replaceRange(lines: string[], startLine: number, startCol: number, endLine: number, endCol: number, replacement?: string): ModelResult {
  const before = lines[startLine].slice(0, startCol);
  const after = lines[endLine].slice(endCol);
  const inserted = (replacement || "").split("\n");
  if (inserted.length === 1) {
    const next = before + inserted[0] + after;
    return {
      lines: [...lines.slice(0, startLine), next, ...lines.slice(endLine + 1)],
      caret: { line: startLine, col: before.length + inserted[0].length },
    };
  }
  const first = before + inserted[0];
  const last = inserted[inserted.length - 1] + after;
  const middle = inserted.slice(1, -1);
  const caretLine = startLine + inserted.length - 1;
  const caretCol = inserted[inserted.length - 1].length;
  return {
    lines: [...lines.slice(0, startLine), first, ...middle, last, ...lines.slice(endLine + 1)],
    caret: { line: caretLine, col: caretCol },
  };
}

function deleteBackward(lines: string[], startLine: number, startCol: number, endLine: number, endCol: number): ModelResult | null {
  if (startLine !== endLine || startCol !== endCol) {
    return replaceRange(lines, startLine, startCol, endLine, endCol, "");
  }
  if (startCol > 0) {
    return replaceRange(lines, startLine, startCol - 1, startLine, startCol, "");
  }
  if (startLine > 0) {
    const prevLen = lines[startLine - 1].length;
    return replaceRange(lines, startLine - 1, prevLen, startLine, 0, "");
  }
  return null;
}

function deleteForward(lines: string[], startLine: number, startCol: number, endLine: number, endCol: number): ModelResult | null {
  if (startLine !== endLine || startCol !== endCol) {
    return replaceRange(lines, startLine, startCol, endLine, endCol, "");
  }
  if (startCol < lines[startLine].length) {
    return replaceRange(lines, startLine, startCol, startLine, startCol + 1, "");
  }
  if (startLine < lines.length - 1) {
    return replaceRange(lines, startLine, startCol, startLine + 1, 0, "");
  }
  return null;
}

function deleteWordBackward(lines: string[], line: number, col: number): ModelResult | null {
  if (col === 0) return deleteBackward(lines, line, col, line, col);
  const text = lines[line].slice(0, col);
  // Strip trailing whitespace, then trailing non-whitespace.
  let i = text.length;
  while (i > 0 && /\s/.test(text[i - 1])) i--;
  while (i > 0 && !/\s/.test(text[i - 1])) i--;
  return replaceRange(lines, line, i, line, col, "");
}

/* ── Component ─────────────────────────────────────────────────────── */
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor({
  initialContent = "",
  readOnly = false,
  onContentChange,
  onSelectionChange,
  onRequestFind,
  autoFocus = false,
  placeholder = PLACEHOLDER,
  // Map of attachment id → { url?, failed? }. Resolved by
  // useAttachmentSrc upstream (NoteEditor). Whenever a line tokenises
  // as an image block, the renderer emits an <img data-mde-
  // attachment="..."> placeholder; a second useLayoutEffect walks
  // the DOM after every render + tile update to set src from this
  // map. Decoupling the resolution from the renderer keeps the
  // markdown model pure — it has no idea attachments exist server-
  // side.
  attachmentTiles = null,
}, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<string[]>(() => (initialContent || "").split("\n"));
  const [caretVersion, setCaretVersion] = useState(0);
  // Synchronous mirror of `lines`. setLines is async — between
  // rapid keystrokes (or delete-then-type) React hasn't re-rendered
  // yet, so the `lines` closure in input handlers is STALE. Reading
  // a stale array means edits land at the right column against the
  // wrong content: e.g. delete "y" → type "z" → "z" overwrites "y"'s
  // neighbour instead of replacing it, resurrecting the deleted
  // char. linesRef.current is the truth; applyModel updates it
  // synchronously before scheduling the React state update.
  // Synchronous mirror of `lines`, always non-null (initialized from the
  // same initial split as the state) so input handlers never read stale
  // closure content. See the long-form note that follows.
  const linesRef = useRef<string[]>((initialContent || "").split("\n"));
  const caretRef = useRef<Caret>({ line: 0, col: 0, endLine: 0, endCol: 0 });
  const prevLinesRef = useRef<string[] | null>(null);
  const prevCaretLineRef = useRef(-1);
  const composingRef = useRef(false);
  // Timestamp of the most recent user-initiated deletion. Used by
  // onCompositionEnd to detect "iOS predictive text is restoring
  // the just-deleted character" — when a delete happened within
  // the last ~2s, we distrust the DOM-as-truth resync that the
  // compositionend path would otherwise do, and force a re-render
  // from linesRef (our model). See onCompositionEnd for full detail.
  const lastDeleteAtRef = useRef(0);
  const historyRef = useRef<History>({ past: [], future: [], lastTs: 0 });
  const pendingFocusRef = useRef(autoFocus);
  const lineDivsRef = useRef<Element[]>([]);
  // Slash command menu — open when the user types "/" at the start
  // of an otherwise-empty line. State holds the line index it
  // opened on + the anchor rect so the portal can position the
  // popover near the caret. null when closed.
  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
  // rAF handle for a pending slash-trigger open. Tracked so a fast
  // typist who lands a char between "/" and the rAF can cancel the
  // pending open (so the menu doesn't pop on a line that's no
  // longer just "/").
  const slashPendingRef = useRef(0);

  /* Notify parent of content changes (skip the initial mount). */
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return; }
    onContentChange?.(lines.join("\n"));
  }, [lines, onContentChange]);

  /* Notify parent of selection/caret changes for toolbar active-format. */
  const notifySelection = useCallback(() => {
    const c = caretRef.current;
    const line = lines[c.line] || "";
    const active = activeFormatsAt(line, c.col);
    onSelectionChange?.({
      line: c.line, col: c.col,
      endLine: c.endLine, endCol: c.endCol,
      active,
    });
  }, [lines, onSelectionChange]);

  /* ── Render ────────────────────────────────────────────────────────
     Full re-render every time `lines` changes. Line-level diff is an
     optimization we could add later, but even a 500-line note costs
     ~8ms to regenerate — well within a frame, and it keeps the code
     small and correct. */
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const caret = caretRef.current;
    const hasFocus = document.activeElement === root;
    const focusedLine = hasFocus || pendingFocusRef.current ? caret.line : -1;

    // Pre-pass: multi-line code fences are inherently stateful (no
    // single line carries the "we're inside a fence" context),
    // so walk top-to-bottom once and classify each line as a
    // fence-marker, fence body, or out-of-fence. The renderer then
    // diverges per case.
    const fence = computeFenceLayout(lines);

    const html = lines.map((raw, i) => {
      const finfo = fence[i];
      const isFocused = i === focusedLine;
      const caretCls = isFocused ? " has-caret" : "";
      // Fence-marker line (``` or ```js). Plain monospace, no
      // inline tokenising — the user's syntax stays literal.
      if (finfo.type === "marker") {
        const pos = finfo.pos ? ` data-fence-pos="${finfo.pos}"` : "";
        return `<div class="mde-line mde-line--code-fence-marker${caretCls}" data-line="${i}"${pos}>${escapeHtml(raw) || "&#8203;"}<span class="mde-eol" data-nocount="1">${"​"}</span></div>`;
      }
      // Fence-body line. Render the raw text monospace, untokenised.
      if (finfo.type === "body") {
        const pos = finfo.pos ? ` data-fence-pos="${finfo.pos}"` : "";
        const content = raw === "" ? "&#8203;" : escapeHtml(raw);
        return `<div class="mde-line mde-line--code-fence${caretCls}" data-line="${i}"${pos}>${content}<span class="mde-eol" data-nocount="1">${"​"}</span></div>`;
      }
      // Out-of-fence: standard token-driven path.
      const token = tokenizeLine(raw);
      const cls = lineClassNames(token);
      const attrs = lineDataAttrs(token);
      const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ");
      const lineCls = cls + caretCls;
      return `<div class="${lineCls}" data-line="${i}" ${attrStr}>${renderLineHTML(token, { hasCaret: isFocused, readOnly, lineIdx: i })}</div>`;
    }).join("");

    root.innerHTML = html;
    lineDivsRef.current = Array.from(root.children);
    prevLinesRef.current = lines;
    prevCaretLineRef.current = focusedLine;

    root.dataset.empty = (lines.length === 1 && lines[0] === "") ? "true" : "false";

    if (hasFocus || pendingFocusRef.current) {
      if (caret.line !== caret.endLine || caret.col !== caret.endCol) {
        placeSelection(lineDivsRef.current, caret.line, caret.col, caret.endLine, caret.endCol);
      } else {
        placeCaret(lineDivsRef.current[caret.line], caret.col);
      }
      if (pendingFocusRef.current) {
        root.focus({ preventScroll: true });
        pendingFocusRef.current = false;
      }
    }
  }, [lines, caretVersion, readOnly]);

  /* Wire attachment image sources whenever the resolution map
     changes OR the body re-renders (which would have nuked the
     previously-set src attributes). Walk runs every render the
     body content changes; the includes() pre-check short-circuits
     instantly on notes with no attachment syntax (the common
     case). querySelectorAll is microseconds but adds up across
     500-line notes typed at speed; the string scan beats it on
     the cold path and the gate keeps lines as a real dep so
     image insertions on previously-attachment-free notes still
     wire up. */
  useLayoutEffect(() => {
    if (!attachmentTiles) return;
    if (!lines.some(l => l && l.includes("attachment:"))) return;
    const root = rootRef.current;
    if (!root) return;
    const imgs = root.querySelectorAll<HTMLImageElement>("img[data-mde-attachment]");
    imgs.forEach((img) => {
      const id = img.dataset.mdeAttachment;
      const tile = id ? attachmentTiles[id] : null;
      if (tile?.url && img.getAttribute("src") !== tile.url) {
        img.setAttribute("src", tile.url);
      } else if (!tile?.url && img.hasAttribute("src")) {
        img.removeAttribute("src");
      }
    });
  }, [lines, attachmentTiles]);

  /* Re-render when focus changes across lines (so the `.has-caret`
     class moves, and syntax dimming follows the caret). */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onSel = () => {
      if (!root.contains(document.activeElement) && document.activeElement !== root) return;
      const sel = document.getSelection();
      if (!sel || !sel.rangeCount) return;
      const r = sel.getRangeAt(0);
      if (!root.contains(r.startContainer)) return;
      const startLine = findLineIdx(r.startContainer, lineDivsRef.current);
      const endLine = findLineIdx(r.endContainer, lineDivsRef.current);
      if (startLine == null || endLine == null) return;
      const startCol = walkColRecursive(lineDivsRef.current[startLine], r.startContainer, r.startOffset);
      const endCol = walkColRecursive(lineDivsRef.current[endLine], r.endContainer, r.endOffset);
      caretRef.current = { line: startLine, col: startCol, endLine, endCol };
      if (startLine !== prevCaretLineRef.current) {
        // Re-render so has-caret class moves line. We bump caretVersion
        // instead of calling setLines (which would alloc a new array).
        setCaretVersion(v => v + 1);
      }
      notifySelection();
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [notifySelection]);

  /* Expose imperative API to parent (apply formats, get selection, etc.) */
  useImperativeHandle(ref, () => ({
    focus() {
      if (rootRef.current) {
        rootRef.current.focus({ preventScroll: true });
        // Place caret at end of current line if none set.
        const c = caretRef.current;
        placeCaret(lineDivsRef.current[c.line] || lineDivsRef.current[0], c.col);
      }
    },
    applyInlineFormat(kind: string) {
      if (readOnly) return;
      const c = caretRef.current;
      if (c.line !== c.endLine) return; // cross-line wrap not supported v1
      const curLines = linesRef.current;
      const line = curLines[c.line] || "";
      const start = Math.min(c.col, c.endCol);
      const end = Math.max(c.col, c.endCol);
      const r = toggleInline(line, start, end, kind);
      const nextLines = [...curLines.slice(0, c.line), r.line, ...curLines.slice(c.line + 1)];
      pushHistory(historyRef.current, curLines, caretRef.current);
      caretRef.current = { line: c.line, col: r.end, endLine: c.line, endCol: r.end };
      linesRef.current = nextLines;
      setLines(nextLines);
      haptic.tap();
    },
    applyBlockFormat(block: string) {
      if (readOnly) return;
      const c = caretRef.current;
      const curLines = linesRef.current;
      const line = curLines[c.line] || "";
      const r = toggleBlock(line, block);
      const nextLines = [...curLines.slice(0, c.line), r.line, ...curLines.slice(c.line + 1)];
      pushHistory(historyRef.current, curLines, caretRef.current);
      const nextCol = Math.max(0, c.col + r.colShift);
      caretRef.current = { line: c.line, col: nextCol, endLine: c.line, endCol: nextCol };
      linesRef.current = nextLines;
      setLines(nextLines);
      haptic.tap();
    },
    setContent(content?: string) {
      const nextLines = (content || "").split("\n");
      linesRef.current = nextLines;
      setLines(nextLines);
      caretRef.current = { line: 0, col: 0, endLine: 0, endCol: 0 };
      historyRef.current = { past: [], future: [], lastTs: 0 };
    },
    /* Insert text at the caret (replacing any selection). Used by
       voice dictation to push transcript chunks into the document
       without going through the DOM input event pipeline. Pushes
       history first so the user can undo the whole dictation pass
       chunk by chunk. */
    insertText(text?: string) {
      if (readOnly || !text) return;
      const c = caretRef.current;
      const curLines = linesRef.current;
      const start = Math.min(c.col, c.endCol);
      const end = Math.max(c.col, c.endCol);
      const startLine = Math.min(c.line, c.endLine);
      const endLine = Math.max(c.line, c.endLine);
      pushHistory(historyRef.current, curLines, caretRef.current);
      const r = replaceRange(curLines, startLine, start, endLine, end, text);
      caretRef.current = {
        line: r.caret.line, col: r.caret.col,
        endLine: r.caret.line, endCol: r.caret.col,
      };
      linesRef.current = r.lines;
      setLines(r.lines);
    },
    getActiveFormats() {
      const c = caretRef.current;
      return activeFormatsAt(linesRef.current[c.line] || "", c.col);
    },
    /* Jump to a range in the document: select it and scroll into
       view. Used by find-in-note and the outline drawer. */
    jumpTo({ line, startCol, endCol }: { line?: number | null; startCol?: number | null; endCol?: number | null }) {
      const curLines = linesRef.current;
      if (line == null || line >= curLines.length) return;
      const targetLine = Math.max(0, Math.min(line, curLines.length - 1));
      const s = Math.max(0, startCol ?? 0);
      const e = Math.max(s, endCol ?? s);
      caretRef.current = { line: targetLine, col: s, endLine: targetLine, endCol: e };
      setCaretVersion(v => v + 1);
      requestAnimationFrame(() => {
        rootRef.current?.focus({ preventScroll: true });
        const div = lineDivsRef.current[targetLine];
        if (div) {
          div.scrollIntoView({ behavior: "smooth", block: "center" });
          // Brief landing flash so the eye finds the new position
          // when jumping in from Find or the outline drawer. The CSS
          // animation auto-resets via `forwards: none`; we still
          // strip the class so a subsequent jump to the same line
          // re-triggers the keyframe.
          div.classList.add("is-jump-flash");
          setTimeout(() => div.classList.remove("is-jump-flash"), 700);
        }
        if (s !== e) {
          placeSelection(lineDivsRef.current, targetLine, s, targetLine, e);
        } else {
          placeCaret(lineDivsRef.current[targetLine], s);
        }
      });
    },
  }), [readOnly]);

  /* ── Event handlers ─────────────────────────────────────────────── */
  const applyModel = (result: ModelResult | null, opts: { skipHistory?: boolean } = {}) => {
    if (!result) return;
    if (!opts.skipHistory) pushHistory(historyRef.current, linesRef.current, caretRef.current);
    caretRef.current = {
      line: result.caret.line,
      col: result.caret.col,
      endLine: result.caret.line,
      endCol: result.caret.col,
    };
    // Write the ref BEFORE setLines so any synchronous handler that
    // re-enters before React re-renders sees the fresh content.
    linesRef.current = result.lines;
    setLines(result.lines);
  };

  // exhaustive-deps suggests wrapping this in useCallback — but that's
  // the wrong fix here. onBeforeInput calls handleEnter (a `const`
  // declared BELOW it), so a useCallback dep array listing handleEnter
  // would evaluate it at render → a temporal-dead-zone ReferenceError,
  // the exact TDZ-at-mount class e2e/notes-editor.spec.js guards. The
  // handler reads ALL editor content from refs (linesRef/caretRef/…), so
  // re-creating it each render is harmless and the native listener just
  // re-attaches in one cheap DOM op (see useEffect below). Suppress at
  // the source rather than contort the editor's function ordering.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const onBeforeInput = (e: InputEvent) => {
    // Attached via a native addEventListener (see useEffect below),
    // NOT via React's onBeforeInput prop. React polyfills
    // onBeforeInput via the legacy DOM3 `textInput` event in some
    // scenarios — those synthesized events don't carry `inputType`
    // OR even put it on the nativeEvent. Sentry breadcrumbs from
    // two consecutive bug repros on iOS Safari confirmed inputType
    // was empty across every event, including via e.nativeEvent.
    // A direct addEventListener gets the real InputEvent with
    // inputType populated per spec.
    const inputType = e.inputType;
    // Breadcrumb: every input event into the editor. Data field
    // truncated to avoid logging large pasted blobs; the bug we're
    // tracking only needs the inputType + 1-2 chars of data. PII
    // scrubber in initSentry's beforeSend strips this further before
    // the event leaves the client.
    addBreadcrumb({
      category: "editor.input",
      level: "info",
      message: inputType || "(unknown)",
      data: {
        inputType: inputType || "",
        eventType: e.type || "",
        dataLen: typeof e.data === "string" ? e.data.length : -1,
        composing: composingRef.current ? 1 : 0,
      },
    });
    if (readOnly) { e.preventDefault(); return; }
    // Real IME composition (CJK / dead-key accents on desktop
    // Spanish): compositionstart fires first → composingRef = true.
    // Let the browser handle the partial-state DOM updates; we
    // resync on compositionend. Early-return WITHOUT preventDefault
    // so the browser's composition machinery proceeds.
    if (composingRef.current) return;
    // insertCompositionText WITHOUT an active compositionstart is
    // iOS predictive text dispatching a "fake composition" to
    // overwrite recently-typed text with its completion guess —
    // the bug that reanimates just-deleted characters. Fall through
    // to the switch so it lands in the default case + gets
    // preventDefault'd. e.data here is usually a single typed char,
    // which we apply via our model just like insertText.

    // Read from the ref, NOT the closure. Between rapid keystrokes
    // (or delete-then-type) React hasn't re-rendered, so the `lines`
    // closure here is stale by one or more edits. Shadow the binding
    // so the rest of this handler reads the freshest content.
    const lines = linesRef.current;

    // Read selection from the DOM, then CLAMP to the current model
    // bounds. The DOM lags behind linesRef during rapid input
    // bursts (iOS predictive text dispatching events synchronously,
    // autorepeat, etc.) — each beforeinput fires while the DOM
    // still shows the prior edit's content. Without clamping, the
    // stale DOM positions point past the end of the freshly-edited
    // line, and slice math no-ops the delete:
    //
    //   user types "Jajxg sa jxs", backspaces twice quickly:
    //   1st BS: sel.col=12 against 12-char DOM, deletes "s" → "jx"
    //   2nd BS: sel.col=12 against still-12-char DOM, but linesRef
    //           is "jx" (11 chars). deleteBackward at col 12 in 11
    //           chars is a no-op. The second delete never happened.
    //   user types "x": sel.col=12 against 12-char DOM, linesRef
    //           "jx" (11 chars). slice(0,12) clamps to "jx" anyway,
    //           inserts "x" → "jxx". User sees the "s" they thought
    //           they deleted come back.
    //
    // Clamping the sel cols to the current model's line lengths
    // makes the delete operate at the line's actual end. The 2nd
    // backspace would then run at col 11 (clamped from 12) and
    // delete "x" → "j". Same fix repairs the type-after-delete
    // case symmetrically.
    const rawSel = currentModelSelection(rootRef.current, lineDivsRef.current);
    if (!rawSel) return;
    const clampLine = (l: number) => Math.max(0, Math.min(l, lines.length - 1));
    const clampCol = (l: number, col: number) => Math.max(0, Math.min(col, (lines[l] || "").length));
    const startLine = clampLine(rawSel.startLine);
    const endLine = clampLine(rawSel.endLine);
    const sel = {
      startLine,
      endLine,
      startCol: clampCol(startLine, rawSel.startCol),
      endCol: clampCol(endLine, rawSel.endCol),
    };

    switch (inputType) {
      case "insertText": {
        e.preventDefault();
        // Markdown autoformat shortcuts. Only fires on single-caret
        // input (no selection) — replacing a selected range with
        // a typed char shouldn't trigger a syntactic transform.
        // The transform absorbs the typed char if it fires (no extra
        // insertion below). Suppress inside code fences so typing
        // "*" + space inside a pseudocode block stays literal.
        const insideFence = isInsideFence(lines, sel.startLine);
        if (!insideFence && sel.startLine === sel.endLine && sel.startCol === sel.endCol) {
          const shortcut = getShortcutTransform(lines[sel.startLine], sel.startCol, e.data);
          if (shortcut) {
            const next = lines.slice();
            next[sel.startLine] = shortcut.newLine;
            applyModel({ lines: next, caret: { line: sel.startLine, col: shortcut.newCol } });
            // Typing any char while the slash menu is open dismisses
            // it (we don't support filter-as-you-type in v1).
            if (slashPendingRef.current) {
          cancelAnimationFrame(slashPendingRef.current);
          slashPendingRef.current = 0;
        }
        if (slashMenu) setSlashMenu(null);
            return;
          }
        }
        applyModel(replaceRange(lines, sel.startLine, sel.startCol, sel.endLine, sel.endCol, e.data || ""));
        // Slash command trigger: "/" at the start of an otherwise-
        // empty line opens the menu. We defer to the next animation
        // frame so the DOM has rendered the new "/" line — only then
        // can we read the line's bounding rect for the menu anchor.
        if (
          e.data === "/" &&
          !insideFence &&
          sel.startLine === sel.endLine &&
          sel.startCol === 0 &&
          (lines[sel.startLine] || "") === ""
        ) {
          const targetLineIdx = sel.startLine;
          if (slashPendingRef.current) cancelAnimationFrame(slashPendingRef.current);
          slashPendingRef.current = requestAnimationFrame(() => {
            slashPendingRef.current = 0;
            const div = lineDivsRef.current[targetLineIdx];
            if (!div) return;
            // Re-verify the line is still "/" — a fast typist can
            // land another char in the rAF gap (~16ms). Reading the
            // DOM's current textContent (post-render) sidesteps the
            // stale closure problem of reading `lines` here. Strip
            // the zero-width-space sentinel the renderer appends.
            const text = (div.textContent || "").replace(/\u200B/g, "");
            if (text !== "/") return;
            const rect = div.getBoundingClientRect();
            setSlashMenu({ line: targetLineIdx, anchorRect: rect });
          });
        } else if (slashMenu || slashPendingRef.current) {
          // Any other typed char dismisses the open OR pending menu.
          if (slashPendingRef.current) {
            cancelAnimationFrame(slashPendingRef.current);
            slashPendingRef.current = 0;
          }
          if (slashPendingRef.current) {
          cancelAnimationFrame(slashPendingRef.current);
          slashPendingRef.current = 0;
        }
        if (slashMenu) setSlashMenu(null);
        }
        return;
      }
      case "insertReplacementText": {
        // Autocorrect / smart-punctuation / "did you mean"
        // suggestion. iOS uses this for legitimate substitutions
        // (double-space → ". ", straight quotes → smart quotes,
        // common misspellings) AND to UNDO its own substitutions
        // when the user presses past the corrected sequence (e.g.
        // tapping a third space after a smart-punctuation period
        // → iOS dispatches insertReplacementText with empty data
        // and a selection spanning the period it wants to remove).
        // Apply even when the replacement is empty — that's a
        // legitimate delete-the-selection op.
        e.preventDefault();
        const replacement = (e.dataTransfer && e.dataTransfer.getData("text/plain")) || e.data || "";
        applyModel(replaceRange(lines, sel.startLine, sel.startCol, sel.endLine, sel.endCol, replacement));
        return;
      }
      case "insertCompositionText": {
        // iOS dispatches this for the user's typed-via-composition
        // character. Apply via the model just like insertText. The
        // real IME composition case (CJK / dead-key) is caught by
        // the composingRef early-return above; only "fake" comps
        // (predictive text wrapping a single char) reach here.
        // Empty data with a non-empty selection = delete; apply.
        e.preventDefault();
        const data = e.data || "";
        applyModel(replaceRange(lines, sel.startLine, sel.startCol, sel.endLine, sel.endCol, data));
        return;
      }
      case "insertLineBreak":
      case "insertParagraph": {
        e.preventDefault();
        if (slashPendingRef.current) {
          cancelAnimationFrame(slashPendingRef.current);
          slashPendingRef.current = 0;
        }
        if (slashMenu) setSlashMenu(null);
        handleEnter(sel);
        return;
      }
      case "deleteContentBackward": {
        e.preventDefault();
        if (slashPendingRef.current) {
          cancelAnimationFrame(slashPendingRef.current);
          slashPendingRef.current = 0;
        }
        if (slashMenu) setSlashMenu(null);
        lastDeleteAtRef.current = nowMs();
        applyModel(deleteBackward(lines, sel.startLine, sel.startCol, sel.endLine, sel.endCol));
        return;
      }
      case "deleteContentForward": {
        e.preventDefault();
        if (slashPendingRef.current) {
          cancelAnimationFrame(slashPendingRef.current);
          slashPendingRef.current = 0;
        }
        if (slashMenu) setSlashMenu(null);
        lastDeleteAtRef.current = nowMs();
        applyModel(deleteForward(lines, sel.startLine, sel.startCol, sel.endLine, sel.endCol));
        return;
      }
      case "deleteWordBackward": {
        e.preventDefault();
        if (slashPendingRef.current) {
          cancelAnimationFrame(slashPendingRef.current);
          slashPendingRef.current = 0;
        }
        if (slashMenu) setSlashMenu(null);
        lastDeleteAtRef.current = nowMs();
        applyModel(deleteWordBackward(lines, sel.startLine, sel.startCol));
        return;
      }
      case "deleteByCut":
      case "insertFromPaste":
      case "insertFromDrop":
        // Handled by onPaste / onCopy / onCut / onDrop dedicated handlers.
        return;
      default: {
        // Unknown input type (often iOS predictive text dispatching
        // insertCompositionText without a real compositionstart, or
        // some other browser quirk). preventDefault to block the
        // browser's mutation; then a best-effort apply via our model.
        e.preventDefault();
        if (!e.data) return;
        // iOS predictive-text pattern: a selection spanning backwards
        // over text the user just typed, combined with a multi-char
        // .data that's the engine's "completion guess". Applying that
        // resurrects whatever the user just deleted. Detect + reject:
        // if the selection has any width AND the data is multi-char,
        // it's almost certainly a smart-replacement attempt. The
        // user's actual single keystroke arrives via a subsequent
        // insertText event.
        const selWidth = (sel.endLine - sel.startLine) + (sel.endCol - sel.startCol);
        if (selWidth > 0 && e.data.length > 1) return;
        applyModel(replaceRange(lines, sel.startLine, sel.startCol, sel.endLine, sel.endCol, e.data));
      }
    }
  };
  const handleEnter = (sel: EditorSelection) => {
    // Read from the ref so rapid Enter-after-edit doesn't operate
    // on stale closure state. Same rationale as onBeforeInput.
    const lines = linesRef.current;
    // Smart list continuation on single-caret Enter inside a list line.
    if (sel.startLine === sel.endLine && sel.startCol === sel.endCol) {
      const line = lines[sel.startLine];
      const listInfo = getListPrefix(line);
      if (listInfo) {
        if (listInfo.mode === "exit") {
          // Empty list item: replace line with empty paragraph, caret at start.
          const next = [...lines.slice(0, sel.startLine), "", ...lines.slice(sel.startLine + 1)];
          pushHistory(historyRef.current, lines, caretRef.current);
          caretRef.current = { line: sel.startLine, col: 0, endLine: sel.startLine, endCol: 0 };
          linesRef.current = next;
          setLines(next);
          return;
        }
        // Continue list on next line
        applyModel(replaceRange(lines, sel.startLine, sel.startCol, sel.endLine, sel.endCol, "\n" + listInfo.prefix));
        return;
      }
    }
    // Plain Enter / Enter over a selection: insert newline.
    applyModel(replaceRange(lines, sel.startLine, sel.startCol, sel.endLine, sel.endCol, "\n"));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (readOnly) return;
    // Shortcuts
    if (e[MOD]) {
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); return; }
      if (k === "b") { e.preventDefault(); applyInline("strong"); return; }
      if (k === "i") { e.preventDefault(); applyInline("em"); return; }
      if (k === "e") { e.preventDefault(); applyInline("code"); return; }
      if (e.shiftKey && (k === "x")) { e.preventDefault(); applyInline("strike"); return; }
      if (e.shiftKey && (k === "h")) { e.preventDefault(); applyInline("mark");   return; }
      if (k === "1") { e.preventDefault(); applyBlockAt("h1"); return; }
      if (k === "2") { e.preventDefault(); applyBlockAt("h2"); return; }
      if (k === "3") { e.preventDefault(); applyBlockAt("h3"); return; }
      if (e.shiftKey && k === "7") { e.preventDefault(); applyBlockAt("ol"); return; }
      if (e.shiftKey && k === "8") { e.preventDefault(); applyBlockAt("ul"); return; }
      if (e.shiftKey && k === "9") { e.preventDefault(); applyBlockAt("task"); return; }
      if (k === "f" && onRequestFind) { e.preventDefault(); onRequestFind(); return; }
    }
    if (e.key === "Tab") {
      e.preventDefault();
      handleTab(e.shiftKey);
      return;
    }
  };

  const applyInline = (kind: string) => {
    const c = caretRef.current;
    if (c.line !== c.endLine) return;
    const curLines = linesRef.current;
    const line = curLines[c.line] || "";
    const start = Math.min(c.col, c.endCol);
    const end = Math.max(c.col, c.endCol);
    const r = toggleInline(line, start, end, kind);
    const nextLines = [...curLines.slice(0, c.line), r.line, ...curLines.slice(c.line + 1)];
    pushHistory(historyRef.current, curLines, caretRef.current);
    caretRef.current = { line: c.line, col: r.start, endLine: c.line, endCol: r.end };
    linesRef.current = nextLines;
    setLines(nextLines);
    haptic.tap();
  };

  const applyBlockAt = (block: string) => {
    const c = caretRef.current;
    const curLines = linesRef.current;
    const line = curLines[c.line] || "";
    const r = toggleBlock(line, block);
    const nextLines = [...curLines.slice(0, c.line), r.line, ...curLines.slice(c.line + 1)];
    pushHistory(historyRef.current, curLines, caretRef.current);
    const nextCol = Math.max(0, c.col + r.colShift);
    caretRef.current = { line: c.line, col: nextCol, endLine: c.line, endCol: nextCol };
    linesRef.current = nextLines;
    setLines(nextLines);
    haptic.tap();
  };

  const handleTab = (shift: boolean) => {
    const c = caretRef.current;
    const curLines = linesRef.current;
    const line = curLines[c.line] || "";
    // Only indent/outdent for list lines
    const token = tokenizeLine(line);
    if (token.block !== "ul" && token.block !== "ol" && token.block !== "task") {
      // Plain tab insertion
      applyModel(replaceRange(curLines, c.line, c.col, c.endLine, c.endCol, "  "));
      return;
    }
    if (shift) {
      if (token.indent < 2) return; // nothing to outdent
      const stripped = line.slice(2); // remove 2 leading spaces
      const nextLines = [...curLines.slice(0, c.line), stripped, ...curLines.slice(c.line + 1)];
      pushHistory(historyRef.current, curLines, caretRef.current);
      const nextCol = Math.max(0, c.col - 2);
      caretRef.current = { line: c.line, col: nextCol, endLine: c.line, endCol: nextCol };
      linesRef.current = nextLines;
      setLines(nextLines);
    } else {
      const indented = "  " + line;
      const nextLines = [...curLines.slice(0, c.line), indented, ...curLines.slice(c.line + 1)];
      pushHistory(historyRef.current, curLines, caretRef.current);
      caretRef.current = { line: c.line, col: c.col + 2, endLine: c.line, endCol: c.col + 2 };
      linesRef.current = nextLines;
      setLines(nextLines);
    }
  };

  const undo = () => {
    const h = historyRef.current;
    if (!h.past.length) return;
    const snap = h.past.pop();
    if (!snap) return;
    h.future.push({ lines: linesRef.current, caret: { ...caretRef.current } });
    caretRef.current = { ...snap.caret };
    linesRef.current = snap.lines;
    setLines(snap.lines);
    haptic.tap();
  };

  const redo = () => {
    const h = historyRef.current;
    if (!h.future.length) return;
    const snap = h.future.pop();
    if (!snap) return;
    h.past.push({ lines: linesRef.current, caret: { ...caretRef.current } });
    caretRef.current = { ...snap.caret };
    linesRef.current = snap.lines;
    setLines(snap.lines);
    haptic.tap();
  };

  const onCompositionStart = () => {
    composingRef.current = true;
    addBreadcrumb({ category: "editor.comp", message: "start", level: "info" });
  };
  const onCompositionEnd = () => {
    composingRef.current = false;

    // Diagnostic breadcrumb: length-only diff between DOM and model
    // so we can see (post-hoc, via Sentry) whether iOS composition
    // changed line lengths behind our back. No content logged — just
    // counts, so PII never leaves the client even pre-scrubber.
    const breadRoot = rootRef.current;
    if (breadRoot) {
      const domLens: number[] = [];
      for (const div of Array.from(breadRoot.children)) {
        const el = div as HTMLElement;
        if (!el.dataset || el.dataset.line == null) continue;
        domLens.push((el.textContent || "").replace(/\u200B/g, "").length);
      }
      const modelLens = linesRef.current.map(l => (l || "").length);
      addBreadcrumb({
        category: "editor.comp",
        message: "end",
        level: "info",
        data: {
          recentDelete: nowMs() - lastDeleteAtRef.current < 2000 ? 1 : 0,
          domLens: domLens.join(","),
          modelLens: modelLens.join(","),
        },
      });
    }

    // Distrust the DOM if a delete happened within the last 2s.
    //
    // iOS predictive text routinely wraps the user's NEXT keystroke
    // after a delete in a composition, with the "smart" intent of
    // restoring the just-deleted word. compositionend's DOM-as-truth
    // resync below would write that restored text back into linesRef,
    // resurrecting the character the user explicitly deleted.
    //
    // Symptom: user types "Jajxg sa jxs", deletes last char(s), types
    // again, and "jxs" reappears after the cursor. Every subsequent
    // keystroke re-triggers the same fight because each typed char
    // gets composed.
    //
    // The 2-second window catches the delete-then-type sequence
    // without permanently disabling composition — a user genuinely
    // composing Spanish text via dictation > 2s after their last
    // delete will still have their input accepted via the resync.
    //
    // Force a render so the DOM rebuilds from linesRef, clearing
    // whatever iOS inserted during the composition.
    if (nowMs() - lastDeleteAtRef.current < 2000) {
      setCaretVersion(v => v + 1);
      return;
    }

    // Re-sync the affected line(s) from the DOM. The browser may have
    // inserted the composed text directly; we read it back and
    // canonicalise via our model so the next render is clean.
    const root = rootRef.current;
    if (!root) return;
    // Walk current DOM and rebuild lines from text of each .mde-line.
    const nextLines: string[] = [];
    for (const el of Array.from(root.children) as HTMLElement[]) {
      if (!el.dataset || el.dataset.line == null) continue;
      // textContent gives raw text from all text nodes — decorator
      // ::before content is not included; data-nocount children (like
      // checkbox buttons) contribute 0 chars because they have no
      // text content.
      nextLines.push((el.textContent || "").replace(/\u200B/g, ""));
    }
    if (nextLines.length === 0) nextLines.push("");
    // Infer caret from current selection
    const sel = document.getSelection();
    let caretLine = caretRef.current.line;
    let caretCol = caretRef.current.col;
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      const li = findLineIdx(r.startContainer, Array.from(root.children));
      if (li != null) {
        caretLine = li;
        caretCol = walkColRecursive(root.children[li], r.startContainer, r.startOffset);
      }
    }
    caretRef.current = { line: caretLine, col: caretCol, endLine: caretLine, endCol: caretCol };
    linesRef.current = nextLines;
    setLines(nextLines);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (readOnly) { e.preventDefault(); return; }
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") || "";
    if (!text) return;
    const sel = currentModelSelection(rootRef.current, lineDivsRef.current);
    if (!sel) return;
    const lines = linesRef.current;
    // Smart paste: if the clipboard holds a single URL AND the user
    // has selected text, wrap the selection in a markdown link
    // [selection](url). Matches the muscle memory from Notion / Bear
    // / Google Docs. Plain URL with no selection: just paste the URL
    // (no transform — the user may want to type their own anchor).
    const trimmed = text.trim();
    const isUrl = /^https?:\/\/\S+$/i.test(trimmed) && !/\s/.test(trimmed);
    const hasSelection = sel.startLine !== sel.endLine || sel.startCol !== sel.endCol;
    if (isUrl && hasSelection) {
      const sameLine = sel.startLine === sel.endLine;
      const selText = sameLine
        ? lines[sel.startLine].slice(sel.startCol, sel.endCol)
        : null;
      // Multi-line selections fall through to a plain paste — wrapping
      // a paragraph break inside a [link] makes a broken link.
      // Skip the link wrap when the selection is whitespace-only —
      // produces ugly empty-anchor markdown like `[   ](url)` and
      // is almost always a missed-selection accident.
      if (selText != null && selText.trim().length > 0) {
        const wrapped = `[${selText}](${trimmed})`;
        applyModel(replaceRange(lines, sel.startLine, sel.startCol, sel.endLine, sel.endCol, wrapped));
        return;
      }
    }
    applyModel(replaceRange(lines, sel.startLine, sel.startCol, sel.endLine, sel.endCol, text));
  };

  const onDrop = (e: React.DragEvent) => { e.preventDefault(); };

  const onClick = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest("[data-mde-checkbox]") as HTMLElement | null;
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    if (readOnly) { haptic.warn(); return; }
    const lineIdx = parseInt(target.dataset.line || "", 10);
    if (isNaN(lineIdx)) return;
    const line = lines[lineIdx];
    const { line: nextLine } = toggleTaskOnLine(line);
    const nextLines = [...lines.slice(0, lineIdx), nextLine, ...lines.slice(lineIdx + 1)];
    pushHistory(historyRef.current, lines, caretRef.current);
    setLines(nextLines);
    haptic.tap();
  };

  // Slash-menu selection: replace the "/" on the trigger line with
  // the chosen command's block prefix, position the caret after it.
  // The trigger line is always the line stored when the menu opened
  // (not the current caret line — selection may have moved).
  const handleSlashSelect = useCallback((cmd: SlashCommandLike) => {
    if (!slashMenu) return;
    const lineIdx = slashMenu.line;
    const curLines = linesRef.current;
    const line = curLines[lineIdx] || "";
    // The line should be "/" (we only opened on an empty line +
    // typed "/"). Replace from col 0 to col 1 with the prefix, even
    // if the user typed extra chars after — those get nuked too,
    // since the menu acts as a definitive intent to use that format.
    const slashIdx = line.indexOf("/");
    if (slashIdx < 0) { setSlashMenu(null); return; }
    const newLine = cmd.prefix + line.slice(slashIdx + 1).trimStart();
    const next = curLines.slice();
    next[lineIdx] = newLine;
    applyModel({ lines: next, caret: { line: lineIdx, col: cmd.prefix.length } });
    setSlashMenu(null);
    // Re-focus the editor — clicking the menu may have moved focus
    // to the popover's button. Defer one frame so the lineDivs ref
    // update settles first.
    requestAnimationFrame(() => {
      rootRef.current?.focus({ preventScroll: true });
    });
    // applyModel isn't memoized — re-runs each render alongside
    // `lines`. That's fine: the menu opens rarely enough that the
    // callback identity churn doesn't matter.
  }, [slashMenu]);

  /* Editor element attributes:
     - spellCheck: on — visual squiggles flag typos, and iOS's
       predictive bar can suggest words. Now safe to leave on
       because the native beforeinput listener gets the correct
       inputType, so the switch in onBeforeInput matches the right
       cases (no more falling into default with empty inputType).
     - autoCapitalize="sentences": iOS capitalises the first letter
       of a paragraph but doesn't second-guess in-word edits.
     - Other attributes left at browser defaults so the iOS keyboard
       behaves normally (double-space → period, smart quotes, etc.). */

  // Native beforeinput listener attached directly to the
  // contenteditable root, bypassing React's onBeforeInput prop.
  // React polyfills onBeforeInput via legacy textInput events on
  // some platforms — confirmed via Sentry breadcrumbs that on iOS
  // Safari those synthesized events arrived with inputType empty
  // on BOTH the synthetic event and the underlying nativeEvent.
  // Without inputType the switch in onBeforeInput fell into the
  // default branch for every event (deletes included), which
  // preventDefaults and then early-returns on `!e.data`, so
  // backspace became a no-op and typed chars inserted against the
  // un-deleted model.
  //
  // Re-attaches when onBeforeInput's closure identity changes
  // (rare — most state used by the handler is via refs, so the
  // dep only churns when slashMenu state flips).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.addEventListener("beforeinput", onBeforeInput);
    return () => root.removeEventListener("beforeinput", onBeforeInput);
    // onBeforeInput is recreated each render (it can't be a useCallback —
    // see the note at its definition); re-attaching is a single cheap DOM
    // op. It's correctly listed as the only dependency, so no suppression
    // is needed here.
  }, [onBeforeInput]);

  return (
    <>
      <div
        ref={rootRef}
        className="mde-root"
        contentEditable={!readOnly}
        suppressContentEditableWarning
        aria-readonly={readOnly ? "true" : "false"}
        role="textbox"
        aria-multiline="true"
        aria-label="Editor de nota"
        data-placeholder={placeholder}
        data-empty={lines.length === 1 && lines[0] === "" ? "true" : "false"}
        spellCheck
        autoCapitalize="sentences"
        onKeyDown={onKeyDown}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onPaste={onPaste}
        onDrop={onDrop}
        onClick={onClick}
      />
      {slashMenu && (
        <Suspense fallback={null}>
          <SlashCommandMenu
            open
            anchorRect={slashMenu.anchorRect}
            onSelect={handleSlashSelect}
            onClose={() => setSlashMenu(null)}
          />
        </Suspense>
      )}
    </>
  );
});

/* ── helpers external to component ─────────────────────────────────── */
function findLineIdx(container: Node, lineDivs: Element[]): number | null {
  for (let i = 0; i < lineDivs.length; i++) {
    if (lineDivs[i].contains(container) || lineDivs[i] === container) return i;
  }
  return null;
}

function currentModelSelection(root: HTMLElement | null, lineDivs: Element[]): EditorSelection | null {
  if (!root) return null;
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer)) return null;
  const startLine = findLineIdx(r.startContainer, lineDivs);
  const endLine = findLineIdx(r.endContainer, lineDivs);
  if (startLine == null || endLine == null) return null;
  const startCol = walkColRecursive(lineDivs[startLine], r.startContainer, r.startOffset);
  const endCol = walkColRecursive(lineDivs[endLine], r.endContainer, r.endOffset);
  if (startLine < endLine || (startLine === endLine && startCol <= endCol)) {
    return { startLine, startCol, endLine, endCol };
  }
  return { startLine: endLine, startCol: endCol, endLine: startLine, endCol: startCol };
}

function pushHistory(h: History, lines: string[], caret: Caret) {
  const now = Date.now();
  const coalesce = now - h.lastTs < 400 && h.past.length > 0;
  if (!coalesce) {
    h.past.push({ lines: lines.slice(), caret: { ...caret } });
    if (h.past.length > 100) h.past.shift();
  }
  h.lastTs = now;
  h.future.length = 0;
}
