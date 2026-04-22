import { useState, useEffect, useRef, useMemo } from "react";
import { IconSearch, IconX } from "../Icons";
import { useT } from "../../i18n/index";
import { haptic } from "../../utils/haptics";

/* ── Cardigan notes — find-in-note overlay ──────────────────────────
   A slim floating bar that appears at the top of the editor scroll
   area when the user presses Cmd/Ctrl+F (or triggers it from the
   overflow menu on mobile). Case-insensitive substring search across
   title + body; as the user types, matches are precomputed. Enter
   advances to the next match; Shift-Enter to previous. Escape
   closes.

   The bar doesn't mutate content — it asks the parent to jump the
   editor caret/selection to each match via an imperative callback. */

export function FindInNote({ title, content, onJump, onClose, initialQuery = "" }) {
  const { t } = useT();
  const [query, setQuery] = useState(initialQuery);
  const [current, setCurrent] = useState(0);
  const inputRef = useRef(null);

  /* Compute matches over the whole document whenever the query or
     content changes. A match is { line, startCol, endCol }, scanning
     body only (title is handled separately because it's a plain
     input, not the contenteditable). */
  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    const out = [];
    const lines = (content || "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i].toLowerCase();
      let from = 0;
      while (from < ln.length) {
        const idx = ln.indexOf(q, from);
        if (idx < 0) break;
        out.push({ line: i, startCol: idx, endCol: idx + q.length });
        from = idx + Math.max(1, q.length);
      }
    }
    return out;
  }, [query, content]);

  // Clamp current pointer into the match array on every render. When
  // the query changes and matches shrink, this avoids out-of-range
  // indexes without needing a setState-in-effect.
  const safeCurrent = matches.length === 0 ? -1 : Math.min(current, matches.length - 1);

  // Jump to the current match via callback
  useEffect(() => {
    if (safeCurrent >= 0 && matches[safeCurrent]) {
      onJump?.(matches[safeCurrent]);
    }
  }, [safeCurrent, matches, onJump]);

  // Autofocus the input on mount
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, []);

  const next = () => {
    if (matches.length === 0) return;
    setCurrent(c => (c + 1) % matches.length);
    haptic.tap();
  };
  const prev = () => {
    if (matches.length === 0) return;
    setCurrent(c => (c - 1 + matches.length) % matches.length);
    haptic.tap();
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) prev(); else next();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
  };

  const titleHitIndex = useMemo(() => {
    if (!query.trim() || !title) return -1;
    return title.toLowerCase().indexOf(query.trim().toLowerCase());
  }, [query, title]);
  const hasTitleHit = titleHitIndex >= 0;
  const totalHits = matches.length + (hasTitleHit ? 1 : 0);
  const displayCurrent = matches.length > 0 ? safeCurrent + 1 + (hasTitleHit ? 1 : 0) : (hasTitleHit ? 1 : 0);

  return (
    <div className="mde-find">
      <div className="mde-find-input-wrap">
        <IconSearch size={14} style={{ color: "var(--charcoal-xl)" }} />
        <input
          ref={inputRef}
          className="mde-find-input"
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("notes.find.placeholder")}
          aria-label={t("notes.find.placeholder")}
        />
      </div>
      <div className="mde-find-counter" aria-live="polite">
        {query.trim()
          ? (totalHits > 0
              ? t("notes.find.match", { current: displayCurrent, total: totalHits })
              : t("notes.find.noMatches"))
          : ""}
      </div>
      <button className="mde-find-btn" onClick={prev} disabled={matches.length === 0} aria-label="Anterior">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6,15 12,9 18,15" />
        </svg>
      </button>
      <button className="mde-find-btn" onClick={next} disabled={matches.length === 0} aria-label="Siguiente">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6,9 12,15 18,9" />
        </svg>
      </button>
      <button className="mde-find-btn" onClick={onClose} aria-label="Cerrar">
        <IconX size={14} />
      </button>
    </div>
  );
}
