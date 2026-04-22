import { useRef, useEffect, useState } from "react";

/* Height-animated reveal. Wraps children in a div whose max-height
   transitions between 0 and the measured content height, producing a
   smooth slide-open without the usual "unknown height" tricks.

   Why: toggling notifications.enabled used to snap the reminder-time,
   preview, and test rows into view in a single paint. The jank was
   subtle but readable. This wraps the whole conditional block so it
   unfolds instead. Transitions opacity in tandem for a slight fade. */

export function Expando({ open, duration = 260, children }) {
  const innerRef = useRef(null);
  const [maxH, setMaxH] = useState(open ? "none" : 0);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    if (open) {
      // Measure then animate to that height; switch to "none" once
      // settled so the content can grow freely (e.g. if the preview
      // re-renders with a longer body).
      const h = el.scrollHeight;
      setMaxH(h);
      const id = setTimeout(() => setMaxH("none"), duration);
      return () => clearTimeout(id);
    } else {
      // Snap to the current measured height first so the subsequent
      // transition has a concrete starting point, then animate down.
      const h = el.scrollHeight;
      setMaxH(h);
      requestAnimationFrame(() => setMaxH(0));
    }
  }, [open, duration]);

  return (
    <div
      aria-hidden={!open}
      style={{
        overflow: "hidden",
        maxHeight: maxH === "none" ? "none" : `${maxH}px`,
        opacity: open ? 1 : 0,
        transition: `max-height ${duration}ms cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity ${Math.max(150, duration - 60)}ms ease`,
      }}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}
