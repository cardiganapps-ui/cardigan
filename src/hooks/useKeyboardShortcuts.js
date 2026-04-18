import { useEffect, useRef } from "react";

const IGNORE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isTypingTarget(el) {
  if (!el) return false;
  if (IGNORE_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  return false;
}

function normalizeKey(e) {
  const parts = [];
  if (e.metaKey) parts.push("meta");
  if (e.ctrlKey) parts.push("ctrl");
  if (e.altKey)  parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  parts.push(k);
  return parts.join("+");
}

/**
 * Global keyboard-shortcut dispatcher.
 *
 * Accepts a map of chord → handler. Chord format: "meta+k", "ctrl+k",
 * "shift+n", "n", "?". Also supports two-step "leader" chords via the
 * `leader` option — e.g. leader "g" with bindings { h: goHome, a:
 * goAgenda } to mean "press G, then H".
 *
 * Typing inside inputs/textareas/contentEditable disables single-key
 * shortcuts; modifier-chord shortcuts (meta/ctrl) still fire so ⌘K
 * opens the palette from anywhere.
 */
export function useKeyboardShortcuts(bindings, { enabled = true, leader = null, leaderBindings = null } = {}) {
  const bindingsRef = useRef(bindings);
  const leaderRef = useRef(null);
  bindingsRef.current = bindings;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e) => {
      const typing = isTypingTarget(document.activeElement);
      const chord = normalizeKey(e);
      const hasModifier = e.metaKey || e.ctrlKey;

      // Leader chord: expect the second key within 1200ms
      if (leaderRef.current) {
        const { timeout, bindings: lb } = leaderRef.current;
        clearTimeout(timeout);
        leaderRef.current = null;
        if (typing) return;
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (lb[key]) { e.preventDefault(); lb[key](e); return; }
        return;
      }

      if (leader && leaderBindings && !hasModifier && !typing) {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (key === leader) {
          e.preventDefault();
          leaderRef.current = {
            bindings: leaderBindings,
            timeout: setTimeout(() => { leaderRef.current = null; }, 1200),
          };
          return;
        }
      }

      const handler = bindingsRef.current[chord];
      if (!handler) return;
      if (typing && !hasModifier) return;
      e.preventDefault();
      handler(e);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (leaderRef.current) clearTimeout(leaderRef.current.timeout);
    };
  }, [enabled, leader, leaderBindings]);
}
