import { useRef, useState, useEffect, useCallback } from "react";

/**
 * Shared pill segmented control with animated slider.
 *
 * Props:
 *   items   — [{ k, l }] where k is the value, l is the label
 *   value   — currently selected key
 *   onChange(key)
 *   size    — "sm" (default) | "md" — md uses heavier font for primary tabs
 *   dataTour, role, ariaLabel — optional pass-through
 */
export function SegmentedControl({ items, value, onChange, size = "sm", dataTour, role = "tablist", ariaLabel, style }) {
  const containerRef = useRef(null);
  const btnRefs = useRef({});
  const [slider, setSlider] = useState(null);
  // Track which edge (if any) the slider just arrived at so we can
  // play a momentum-squish animation anchored to that wall. The
  // bouncy transition on left/width overshoots the container when
  // the target is the first or last tab — instead of clipping the
  // overflow, we swap to a softer slide + compress the slider
  // against the wall, then spring back to shape. Nulled out after
  // the animation duration so repeating the same selection replays.
  const [edgeBounce, setEdgeBounce] = useState(null); // 'left' | 'right' | null
  const prevValueRef = useRef(value);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const btn = btnRefs.current[value];
    if (!container || !btn) { setSlider(null); return; }
    const cRect = container.getBoundingClientRect();
    const bRect = btn.getBoundingClientRect();
    setSlider({
      left: bRect.left - cRect.left,
      width: bRect.width,
    });
  }, [value]);

  useEffect(() => {
    measure();
  }, [measure, items]);

  // Re-measure on resize (handles orientation changes, font load, etc.)
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // Detect arrivals at the leftmost / rightmost tab and tag the
  // slider with the right edge class for the duration of the bounce.
  useEffect(() => {
    if (prevValueRef.current === value) return;
    prevValueRef.current = value;
    if (!items?.length) return;
    if (items[0].k === value) setEdgeBounce("left");
    else if (items[items.length - 1].k === value) setEdgeBounce("right");
    else setEdgeBounce(null);
  }, [value, items]);

  // Clear the edge flag after the animation finishes so the next
  // selection (including re-selecting the same tab) re-arms it.
  useEffect(() => {
    if (!edgeBounce) return;
    const id = setTimeout(() => setEdgeBounce(null), 620);
    return () => clearTimeout(id);
  }, [edgeBounce]);

  const sliderClass = `segmented-slider${
    edgeBounce === "left" ? " segmented-slider--edge-left"
      : edgeBounce === "right" ? " segmented-slider--edge-right"
      : ""
  }`;

  return (
    <div
      ref={containerRef}
      className={`segmented segmented--${size}`}
      role={role}
      aria-label={ariaLabel}
      data-tour={dataTour}
      style={style}
    >
      {slider && (
        <span
          className={sliderClass}
          style={{ left: slider.left, width: slider.width }}
        />
      )}
      {items.map(it => (
        <button
          key={it.k}
          ref={el => { btnRefs.current[it.k] = el; }}
          role={role === "tablist" ? "tab" : undefined}
          aria-selected={role === "tablist" ? value === it.k : undefined}
          className={`segmented-btn ${value === it.k ? "active" : ""}`}
          onClick={() => onChange(it.k)}
          type="button"
        >
          {it.l}
        </button>
      ))}
    </div>
  );
}
