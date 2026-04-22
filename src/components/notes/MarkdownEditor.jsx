import { useEffect, useLayoutEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from "react";
import {
  tokenizeLine,
  renderLineHTML,
  lineClassNames,
  lineDataAttrs,
  getListPrefix,
  activeFormatsAt,
  toggleBlock,
  toggleInline,
  toggleTaskOnLine,
} from "./markdownModel";
import { haptic } from "../../utils/haptics";

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

function isMac() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
}
const MOD = isMac() ? "metaKey" : "ctrlKey";

/* ── DOM ↔ model translation ────────────────────────────────────────
   These helpers walk the DOM of a single line div. Text-bearing
   nodes contribute characters to the column count; anything marked
   with data-nocount doesn't. Scan order is document order. */
function walkColRecursive(lineDiv, container, offset) {
  let found = null;
  let count = 0;
  function visit(n) {
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
    if (n.nodeType === 3) { count += n.textContent.length; return; }
    for (const c of n.childNodes) visit(c);
  }
  visit(lineDiv);
  return found != null ? found : count;
}

function charsInSubtree(node) {
  if (isSkipped(node)) return 0;
  if (node.nodeType === 3) return node.textContent.length;
  let total = 0;
  for (const c of node.childNodes) total += charsInSubtree(c);
  return total;
}

function isSkipped(node) {
  if (!node || node.nodeType !== 1) return false;
  return node.dataset && node.dataset.nocount === "1";
}

/* Place caret at (lineDiv, col). Walks forward in document order,
   counting chars, and builds a Range at the first position where
   the cumulative count reaches col. */
function placeCaret(lineDiv, col) {
  if (!lineDiv) return;
  let remaining = col;
  let target = null;
  let targetOffset = 0;

  function visit(n) {
    if (target != null) return;
    if (isSkipped(n)) return;
    if (n.nodeType === 3) {
      const len = n.textContent.length;
      if (remaining <= len) {
        target = n;
        targetOffset = remaining;
        remaining = 0;
        return;
      }
      remaining -= len;
      return;
    }
    for (const c of n.childNodes) {
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

function placeSelection(lineDivs, startLine, startCol, endLine, endCol) {
  const startDiv = lineDivs[startLine];
  const endDiv = lineDivs[endLine];
  if (!startDiv || !endDiv) return;
  // Build ranges at each endpoint, combine.
  const makePoint = (div, col) => {
    let remaining = col;
    let targetNode = null, targetOffset = 0;
    function visit(n) {
      if (targetNode != null) return;
      if (isSkipped(n)) return;
      if (n.nodeType === 3) {
        const len = n.textContent.length;
        if (remaining <= len) { targetNode = n; targetOffset = remaining; remaining = 0; return; }
        remaining -= len;
        return;
      }
      for (const c of n.childNodes) { visit(c); if (targetNode != null) return; }
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
  sel.removeAllRanges();
  sel.addRange(range);
}

/* ── Model ops ──────────────────────────────────────────────────────
   Pure functions over the `lines` array. Each returns the next
   `lines` plus the caret/selection to restore. */

function replaceRange(lines, startLine, startCol, endLine, endCol, replacement) {
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

function deleteBackward(lines, startLine, startCol, endLine, endCol) {
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

function deleteForward(lines, startLine, startCol, endLine, endCol) {
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

function deleteWordBackward(lines, line, col) {
  if (col === 0) return deleteBackward(lines, line, col, line, col);
  const text = lines[line].slice(0, col);
  // Strip trailing whitespace, then trailing non-whitespace.
  let i = text.length;
  while (i > 0 && /\s/.test(text[i - 1])) i--;
  while (i > 0 && !/\s/.test(text[i - 1])) i--;
  return replaceRange(lines, line, i, line, col, "");
}

/* ── Component ─────────────────────────────────────────────────────── */
export const MarkdownEditor = forwardRef(function MarkdownEditor({
  initialContent = "",
  readOnly = false,
  onContentChange,
  onSelectionChange,
  onRequestFind,
  autoFocus = false,
  placeholder = PLACEHOLDER,
}, ref) {
  const rootRef = useRef(null);
  const [lines, setLines] = useState(() => (initialContent || "").split("\n"));
  const [caretVersion, setCaretVersion] = useState(0);
  const caretRef = useRef({ line: 0, col: 0, endLine: 0, endCol: 0 });
  const prevLinesRef = useRef(null);
  const prevCaretLineRef = useRef(-1);
  const composingRef = useRef(false);
  const historyRef = useRef({ past: [], future: [], lastTs: 0 });
  const pendingFocusRef = useRef(autoFocus);
  const lineDivsRef = useRef([]);

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

    const html = lines.map((raw, i) => {
      const token = tokenizeLine(raw);
      const cls = lineClassNames(token);
      const attrs = lineDataAttrs(token);
      const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ");
      const isFocused = i === focusedLine;
      const lineCls = cls + (isFocused ? " has-caret" : "");
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
    applyInlineFormat(kind) {
      if (readOnly) return;
      const c = caretRef.current;
      if (c.line !== c.endLine) return; // cross-line wrap not supported v1
      const line = lines[c.line] || "";
      const start = Math.min(c.col, c.endCol);
      const end = Math.max(c.col, c.endCol);
      const r = toggleInline(line, start, end, kind);
      const nextLines = [...lines.slice(0, c.line), r.line, ...lines.slice(c.line + 1)];
      pushHistory(historyRef.current, lines, caretRef.current);
      caretRef.current = { line: c.line, col: r.end, endLine: c.line, endCol: r.end };
      setLines(nextLines);
      haptic.tap();
    },
    applyBlockFormat(block) {
      if (readOnly) return;
      const c = caretRef.current;
      const line = lines[c.line] || "";
      const r = toggleBlock(line, block);
      const nextLines = [...lines.slice(0, c.line), r.line, ...lines.slice(c.line + 1)];
      pushHistory(historyRef.current, lines, caretRef.current);
      const nextCol = Math.max(0, c.col + r.colShift);
      caretRef.current = { line: c.line, col: nextCol, endLine: c.line, endCol: nextCol };
      setLines(nextLines);
      haptic.tap();
    },
    setContent(content) {
      setLines((content || "").split("\n"));
      caretRef.current = { line: 0, col: 0, endLine: 0, endCol: 0 };
      historyRef.current = { past: [], future: [], lastTs: 0 };
    },
    getActiveFormats() {
      const c = caretRef.current;
      return activeFormatsAt(lines[c.line] || "", c.col);
    },
    /* Jump to a range in the document: select it and scroll into
       view. Used by find-in-note and the outline drawer. */
    jumpTo({ line, startCol, endCol }) {
      if (line == null || line >= lines.length) return;
      const targetLine = Math.max(0, Math.min(line, lines.length - 1));
      const s = Math.max(0, startCol ?? 0);
      const e = Math.max(s, endCol ?? s);
      caretRef.current = { line: targetLine, col: s, endLine: targetLine, endCol: e };
      setCaretVersion(v => v + 1);
      requestAnimationFrame(() => {
        rootRef.current?.focus({ preventScroll: true });
        const div = lineDivsRef.current[targetLine];
        if (div) div.scrollIntoView({ behavior: "smooth", block: "center" });
        if (s !== e) {
          placeSelection(lineDivsRef.current, targetLine, s, targetLine, e);
        } else {
          placeCaret(lineDivsRef.current[targetLine], s);
        }
      });
    },
  }), [lines, readOnly]);

  /* ── Event handlers ─────────────────────────────────────────────── */
  const applyModel = (result, opts = {}) => {
    if (!result) return;
    if (!opts.skipHistory) pushHistory(historyRef.current, lines, caretRef.current);
    caretRef.current = {
      line: result.caret.line,
      col: result.caret.col,
      endLine: result.caret.line,
      endCol: result.caret.col,
    };
    setLines(result.lines);
  };

  const onBeforeInput = (e) => {
    if (readOnly) { e.preventDefault(); return; }
    // Composition input — let the browser manage the DOM temporarily;
    // we resync on compositionend.
    if (composingRef.current || e.inputType === "insertCompositionText") return;

    const sel = currentModelSelection(rootRef.current, lineDivsRef.current);
    if (!sel) return;

    switch (e.inputType) {
      case "insertText": {
        e.preventDefault();
        applyModel(replaceRange(lines, sel.startLine, sel.startCol, sel.endLine, sel.endCol, e.data || ""));
        return;
      }
      case "insertReplacementText": {
        // Autocorrect / suggestion replacement. `dataTransfer` holds text.
        e.preventDefault();
        const replacement = (e.dataTransfer && e.dataTransfer.getData("text/plain")) || e.data || "";
        // Range may span multiple text nodes; the browser already moved
        // selection to the range-to-replace. Use current selection.
        applyModel(replaceRange(lines, sel.startLine, sel.startCol, sel.endLine, sel.endCol, replacement));
        return;
      }
      case "insertLineBreak":
      case "insertParagraph": {
        e.preventDefault();
        handleEnter(sel);
        return;
      }
      case "deleteContentBackward": {
        e.preventDefault();
        applyModel(deleteBackward(lines, sel.startLine, sel.startCol, sel.endLine, sel.endCol));
        return;
      }
      case "deleteContentForward": {
        e.preventDefault();
        applyModel(deleteForward(lines, sel.startLine, sel.startCol, sel.endLine, sel.endCol));
        return;
      }
      case "deleteWordBackward": {
        e.preventDefault();
        applyModel(deleteWordBackward(lines, sel.startLine, sel.startCol));
        return;
      }
      case "deleteByCut":
      case "insertFromPaste":
      case "insertFromDrop":
        // Handled by onPaste / onCopy / onCut / onDrop dedicated handlers.
        return;
      default: {
        // Unknown input type — preventDefault and best-effort fall-through.
        e.preventDefault();
        if (e.data) {
          applyModel(replaceRange(lines, sel.startLine, sel.startCol, sel.endLine, sel.endCol, e.data));
        }
      }
    }
  };

  const handleEnter = (sel) => {
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

  const onKeyDown = (e) => {
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

  const applyInline = (kind) => {
    const c = caretRef.current;
    if (c.line !== c.endLine) return;
    const line = lines[c.line] || "";
    const start = Math.min(c.col, c.endCol);
    const end = Math.max(c.col, c.endCol);
    const r = toggleInline(line, start, end, kind);
    const nextLines = [...lines.slice(0, c.line), r.line, ...lines.slice(c.line + 1)];
    pushHistory(historyRef.current, lines, caretRef.current);
    caretRef.current = { line: c.line, col: r.start, endLine: c.line, endCol: r.end };
    setLines(nextLines);
    haptic.tap();
  };

  const applyBlockAt = (block) => {
    const c = caretRef.current;
    const line = lines[c.line] || "";
    const r = toggleBlock(line, block);
    const nextLines = [...lines.slice(0, c.line), r.line, ...lines.slice(c.line + 1)];
    pushHistory(historyRef.current, lines, caretRef.current);
    const nextCol = Math.max(0, c.col + r.colShift);
    caretRef.current = { line: c.line, col: nextCol, endLine: c.line, endCol: nextCol };
    setLines(nextLines);
    haptic.tap();
  };

  const handleTab = (shift) => {
    const c = caretRef.current;
    const line = lines[c.line] || "";
    // Only indent/outdent for list lines
    const token = tokenizeLine(line);
    if (token.block !== "ul" && token.block !== "ol" && token.block !== "task") {
      // Plain tab insertion
      applyModel(replaceRange(lines, c.line, c.col, c.endLine, c.endCol, "  "));
      return;
    }
    if (shift) {
      if (token.indent < 2) return; // nothing to outdent
      const stripped = line.slice(2); // remove 2 leading spaces
      const nextLines = [...lines.slice(0, c.line), stripped, ...lines.slice(c.line + 1)];
      pushHistory(historyRef.current, lines, caretRef.current);
      const nextCol = Math.max(0, c.col - 2);
      caretRef.current = { line: c.line, col: nextCol, endLine: c.line, endCol: nextCol };
      setLines(nextLines);
    } else {
      const indented = "  " + line;
      const nextLines = [...lines.slice(0, c.line), indented, ...lines.slice(c.line + 1)];
      pushHistory(historyRef.current, lines, caretRef.current);
      caretRef.current = { line: c.line, col: c.col + 2, endLine: c.line, endCol: c.col + 2 };
      setLines(nextLines);
    }
  };

  const undo = () => {
    const h = historyRef.current;
    if (!h.past.length) return;
    const snap = h.past.pop();
    h.future.push({ lines, caret: { ...caretRef.current } });
    caretRef.current = { ...snap.caret };
    setLines(snap.lines);
    haptic.tap();
  };

  const redo = () => {
    const h = historyRef.current;
    if (!h.future.length) return;
    const snap = h.future.pop();
    h.past.push({ lines, caret: { ...caretRef.current } });
    caretRef.current = { ...snap.caret };
    setLines(snap.lines);
    haptic.tap();
  };

  const onCompositionStart = () => { composingRef.current = true; };
  const onCompositionEnd = () => {
    composingRef.current = false;
    // Re-sync the affected line(s) from the DOM. The browser may have
    // inserted the composed text directly; we read it back and
    // canonicalise via our model so the next render is clean.
    const root = rootRef.current;
    if (!root) return;
    // Walk current DOM and rebuild lines from text of each .mde-line.
    const nextLines = [];
    for (const div of root.children) {
      if (!div.dataset || div.dataset.line == null) continue;
      // textContent gives raw text from all text nodes — decorator
      // ::before content is not included; data-nocount children (like
      // checkbox buttons) contribute 0 chars because they have no
      // text content.
      nextLines.push(div.textContent.replace(/\u200B/g, ""));
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
    setLines(nextLines);
  };

  const onPaste = (e) => {
    if (readOnly) { e.preventDefault(); return; }
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") || "";
    if (!text) return;
    const sel = currentModelSelection(rootRef.current, lineDivsRef.current);
    if (!sel) return;
    applyModel(replaceRange(lines, sel.startLine, sel.startCol, sel.endLine, sel.endCol, text));
  };

  const onDrop = (e) => { e.preventDefault(); };

  const onClick = (e) => {
    const target = e.target.closest("[data-mde-checkbox]");
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    if (readOnly) { haptic.warn(); return; }
    const lineIdx = parseInt(target.dataset.line, 10);
    if (isNaN(lineIdx)) return;
    const line = lines[lineIdx];
    const { line: nextLine } = toggleTaskOnLine(line);
    const nextLines = [...lines.slice(0, lineIdx), nextLine, ...lines.slice(lineIdx + 1)];
    pushHistory(historyRef.current, lines, caretRef.current);
    setLines(nextLines);
    haptic.tap();
  };

  return (
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
      onBeforeInput={onBeforeInput}
      onKeyDown={onKeyDown}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
      onPaste={onPaste}
      onDrop={onDrop}
      onClick={onClick}
    />
  );
});

/* ── helpers external to component ─────────────────────────────────── */
function findLineIdx(container, lineDivs) {
  for (let i = 0; i < lineDivs.length; i++) {
    if (lineDivs[i].contains(container) || lineDivs[i] === container) return i;
  }
  return null;
}

function currentModelSelection(root, lineDivs) {
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

function pushHistory(h, lines, caret) {
  const now = Date.now();
  const coalesce = now - h.lastTs < 400 && h.past.length > 0;
  if (!coalesce) {
    h.past.push({ lines: lines.slice(), caret: { ...caret } });
    if (h.past.length > 100) h.past.shift();
  }
  h.lastTs = now;
  h.future.length = 0;
}
