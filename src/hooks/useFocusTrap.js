import { useEffect, useRef } from "react";

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Trap keyboard focus inside a modal/sheet while `active` is true.
 *
 * - On activation, focuses the first focusable descendant.
 * - Intercepts Tab / Shift+Tab to cycle inside the container.
 * - Restores focus to the element that had it before the modal opened
 *   so the trigger button keeps its place in the tab order.
 *
 * Usage:
 *   const ref = useFocusTrap(isOpen);
 *   return <div ref={ref} ...>...</div>;
 */
export function useFocusTrap(active) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const prevFocus = document.activeElement;
    const focusables = () => Array.from(container.querySelectorAll(FOCUSABLE))
      .filter(el => !el.hasAttribute("aria-hidden") && el.offsetParent !== null);

    // Defer initial focus one frame so entrance animations don't steal it.
    // Skip the sheet-close (X) button when picking the initial target — it's
    // usually the first focusable child on a bottom sheet, and auto-focusing
    // it makes the X look "pressed" the instant the sheet opens.
    const rafId = requestAnimationFrame(() => {
      const list = focusables();
      if (list.length > 0 && !container.contains(document.activeElement)) {
        const initial = list.find(el => !el.classList.contains("sheet-close")) || list[0];
        initial.focus();
      }
    });

    const onKeyDown = (e) => {
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) { e.preventDefault(); return; }
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    container.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(rafId);
      container.removeEventListener("keydown", onKeyDown);
      if (prevFocus && typeof prevFocus.focus === "function") {
        try { prevFocus.focus(); } catch { /* noop */ }
      }
    };
  }, [active]);

  return containerRef;
}
