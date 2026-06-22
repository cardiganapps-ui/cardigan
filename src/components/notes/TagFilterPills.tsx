/* ── TagFilterPills ─────────────────────────────────────────────
   Horizontal pill row above the Notes list. Each pill is a tag with
   its note count; tapping toggles a filter so only notes carrying
   that tag are shown. Multiple selections AND-narrow the list
   (note must carry every selected tag).

   The pill row hides itself when the user has zero tags — no
   visual noise on a fresh account; the first tag creation in the
   props sheet brings the row in. */

import { useMemo } from "react";

interface Tag { id: string; label?: string }
interface TagLink { tag_id: string }

export function TagFilterPills({ tags, tagLinks, selectedIds, onToggle }: {
  tags?: Tag[];
  tagLinks?: TagLink[];
  selectedIds?: string[];
  onToggle?: (id: string) => void;
}) {
  // Count per tag — single pass over the link table; the row reads
  // tabular-nums for steady-width counts so the row doesn't jiggle
  // as filters narrow.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of (tagLinks || [])) {
      m.set(l.tag_id, (m.get(l.tag_id) || 0) + 1);
    }
    return m;
  }, [tagLinks]);

  const visible = (tags || []).filter(t => (counts.get(t.id) || 0) > 0);
  if (visible.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Filtrar por etiqueta"
      style={{
        display: "flex",
        gap: 8,
        marginBottom: 12,
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        // Edge-bleed: bars stay 4px shy of the scroll edges so the
        // last pill's :focus-visible ring doesn't get clipped.
        padding: "2px 4px 6px",
        margin: "0 -4px 12px",
        scrollbarWidth: "none",
      }}
    >
      {visible.map(tag => {
        const active = (selectedIds || []).includes(tag.id);
        const count = counts.get(tag.id) || 0;
        return (
          <button
            key={tag.id}
            type="button"
            className={"tag-filter-pill btn-tap" + (active ? " is-active" : "")}
            aria-pressed={active}
            onClick={() => onToggle?.(tag.id)}
          >
            <span style={{
              maxWidth: 140,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>{tag.label || "—"}</span>
            <span style={{
              fontVariantNumeric: "tabular-nums",
              fontWeight: 500,
              fontSize: 11,
              color: active ? "var(--teal-dark)" : "var(--charcoal-xl)",
            }}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}
