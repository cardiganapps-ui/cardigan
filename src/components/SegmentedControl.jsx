/**
 * Shared pill segmented control with animated slider.
 *
 * The slider's position is driven by CSS variables (--active-i,
 * --tab-count) on the container — see .segmented-slider in
 * components.css. Earlier this component measured each button's
 * getBoundingClientRect() and applied the result as inline
 * `style={{ left, width }}` on the slider. That approach was
 * unreliable on iOS WKWebView under certain layout timings: the
 * measurement could capture button positions before flex layout
 * stabilized post-mount, producing a slider that visually landed
 * one slot off from the active button. Since all buttons in this
 * control share `flex: 1 1 0` (equal width), the position can be
 * computed purely from `active-index / total-count` via CSS calc
 * — no measurement, no timing windows, deterministic across every
 * render path.
 *
 * Props:
 *   items   — [{ k, l }] where k is the value, l is the label
 *   value   — currently selected key
 *   onChange(key)
 *   size    — "sm" (default) | "md" — md uses heavier font for primary tabs
 *   dataTour, role, ariaLabel — optional pass-through
 */
import { useEffect, useState } from "react";

export function SegmentedControl({ items, value, onChange, size = "sm", dataTour, role = "tablist", ariaLabel, style }) {
  const activeIndex = items.findIndex(it => it.k === value);
  const showSlider = activeIndex >= 0;

  // Edge bounce — same intent as before: when the slider lands on
  // the first or last tab, swap the easing to a momentum-squish
  // anchored to that wall so the spring overshoot doesn't poke
  // past the container. Tracked locally; nulled out after the
  // animation duration so repeating the same selection replays.
  const [edgeBounce, setEdgeBounce] = useState(null);
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (items?.length) {
      if (items[0].k === value) setEdgeBounce("left");
      else if (items[items.length - 1].k === value) setEdgeBounce("right");
      else setEdgeBounce(null);
    }
  }
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
      className={`segmented segmented--${size}`}
      role={role}
      aria-label={ariaLabel}
      data-tour={dataTour}
      style={{ "--active-i": activeIndex, "--tab-count": items.length, ...style }}
    >
      {showSlider && <span className={sliderClass} aria-hidden="true" />}
      {items.map(it => (
        <button
          key={it.k}
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
