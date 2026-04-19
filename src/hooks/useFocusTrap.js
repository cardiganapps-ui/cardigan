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

    // Park initial focus on the panel container itself (tabindex=-1) so
    // screen-reader users land inside the modal, but NO button appears
    // pre-selected. Focusing an actual <button> here would paint the
    // global :focus-visible ring (e.g. the trash icon looked selected
    // the instant the sheet opened). Keyboard users still Tab into the
    // content normally — focus trap below keeps them contained.
    const rafId = requestAnimationFrame(() => {
      if (container.contains(document.activeElement)) return;
      if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
      try { container.focus({ preventScroll: true }); } catch { container.focus(); }
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
