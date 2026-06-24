import { useEffect, useMemo, useState, type RefObject } from "react";
import { extractOutline } from "./outlineUtil";

/* ── Heading scroll-spy (extracted from NoteEditor, WS-6) ──────────────
   An IntersectionObserver tracks the h1/h2/h3 lines inside the markdown
   editor root, identifies the topmost one currently in view, and returns
   its line index. The outline drawer reads it to highlight the matching
   entry — a "you are here" affordance while scrolling a long note.

   Observer scope = the editor's scroll viewport (scrollRef). A small
   rootMargin pulls the trigger zone toward the top so heading transitions
   feel anchored to the scroll-top rather than the centre. A MutationObserver
   re-wires the IO whenever the heading SET changes (new headings appear /
   disappear); the `headingsSignature` dep keeps that re-wire off the
   per-keystroke path. */
export function useNoteOutline(
  content: string,
  scrollRef: RefObject<HTMLDivElement | null>,
): number | null {
  const [activeHeadingLine, setActiveHeadingLine] = useState<number | null>(null);

  // Cheap signature of the heading set. `content` changes every keystroke;
  // the heading SET only changes when a line becomes / stops being a heading.
  const headingsSignature = useMemo(
    () => extractOutline(content).map(o => `${o.line}-${o.level}`).join(","),
    [content]
  );

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    if (typeof IntersectionObserver === "undefined") return;
    let raf = 0;
    const visible = new Map<number, number>(); // lineIdx → top (relative to viewport)
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const lineIdx = parseInt((entry.target as HTMLElement).dataset.line || "", 10);
        if (Number.isNaN(lineIdx)) continue;
        if (entry.isIntersecting) {
          visible.set(lineIdx, entry.boundingClientRect.top);
        } else {
          visible.delete(lineIdx);
        }
      }
      // rAF-coalesce so a burst of crossings doesn't thrash React.
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (visible.size === 0) {
          setActiveHeadingLine(null);
          return;
        }
        // The topmost visible heading by document order (smallest line idx).
        let best = Infinity;
        for (const lineIdx of visible.keys()) {
          if (lineIdx < best) best = lineIdx;
        }
        setActiveHeadingLine(best === Infinity ? null : best);
      });
    }, {
      root: scrollEl,
      // Trigger zone: top 12% of viewport.
      rootMargin: "0px 0px -88% 0px",
      threshold: 0,
    });

    const editorRoot = scrollEl.querySelector(".mde-root");
    if (!editorRoot) return () => { observer.disconnect(); if (raf) cancelAnimationFrame(raf); };
    const wireUp = () => {
      observer.disconnect();
      visible.clear();
      const headings = editorRoot.querySelectorAll(".mde-line--h1, .mde-line--h2, .mde-line--h3");
      headings.forEach(h => observer.observe(h));
    };
    wireUp();
    const mut = new MutationObserver(wireUp);
    mut.observe(editorRoot, { childList: true, subtree: false });
    return () => {
      mut.disconnect();
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
    // Only re-attach when the heading set changes (not per keystroke).
    // scrollRef is a stable ref object — listed to satisfy exhaustive-deps;
    // it never changes identity so it adds no extra runs.
  }, [headingsSignature, scrollRef]);

  return activeHeadingLine;
}
