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
          className="segmented-slider"
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
