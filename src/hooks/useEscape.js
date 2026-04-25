import { useEffect } from "react";

// Single document-level keydown listener + a stack of registered
// handlers. When ESC is pressed, only the most recently mounted
// (topmost) handler fires — so closing a CommandPalette opened over
// a sheet doesn't ALSO close the sheet underneath. Previously each
// useEscape call attached its own document listener and they all
// fired on a single keypress, collapsing every open modal at once.
const escapeStack = [];
let listenerAttached = false;

function ensureListener() {
  if (listenerAttached || typeof document === "undefined") return;
  listenerAttached = true;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const top = escapeStack[escapeStack.length - 1];
    if (top) top();
  });
}

export function useEscape(onClose) {
  useEffect(() => {
    if (!onClose) return;
    ensureListener();
    escapeStack.push(onClose);
    return () => {
      // Use lastIndexOf so re-renders that swap the same callback
      // identity remove the right entry (top-of-stack).
      const idx = escapeStack.lastIndexOf(onClose);
      if (idx >= 0) escapeStack.splice(idx, 1);
    };
  }, [onClose]);
}
