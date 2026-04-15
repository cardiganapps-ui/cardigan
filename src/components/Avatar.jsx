/**
 * Shared circular avatar with initials.
 *
 * Replaces the ~five different `row-avatar` implementations that used
 * inline `width/height/fontSize` overrides (36, 40, 44). Two canonical
 * sizes:
 *   - "sm" — 36px, used inside rows (bal-row, row-item compact, expediente lists)
 *   - "md" — 40px, used as the default row avatar on Home/Patients
 *   - "lg" — 52px, used on the Settings profile card
 *
 * Props:
 *   initials  — text inside the circle
 *   color     — background color (CSS color or var)
 *   size      — "sm" | "md" | "lg" (default "md")
 *   tutor     — boolean; swaps to the purple "tutor" background if true
 *               and the caller hasn't overridden `color`
 *   style     — optional style overrides
 */
export function Avatar({ initials, color, size = "md", tutor = false, style }) {
  const dims = size === "lg" ? 52 : size === "sm" ? 36 : 40;
  const fontSize = size === "lg" ? 18 : size === "sm" ? 11 : 13;
  const bg = color || (tutor ? "var(--purple)" : "var(--teal)");
  return (
    <div
      className="row-avatar"
      style={{
        background: bg,
        width: dims,
        height: dims,
        fontSize,
        flexShrink: 0,
        ...style,
      }}
    >
      {initials}
    </div>
  );
}
