/**
 * Shared pill segmented control.
 *
 * Replaces the near-identical implementations that existed as
 * .seg-btn, .view-btn, .fin-tab and .auth-tab — all "cream-dark pill
 * track + white active pill with teal text". One component, one CSS
 * block (.segmented / .segmented-btn in styles.css).
 *
 * Props:
 *   items   — [{ k, l }] where k is the value, l is the label
 *   value   — currently selected key
 *   onChange(key)
 *   size    — "sm" (default) | "md" — md uses heavier font for primary tabs
 *   dataTour, role, ariaLabel — optional pass-through
 */
export function SegmentedControl({ items, value, onChange, size = "sm", dataTour, role = "tablist", ariaLabel, style }) {
  return (
    <div
      className={`segmented segmented--${size}`}
      role={role}
      aria-label={ariaLabel}
      data-tour={dataTour}
      style={style}
    >
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
