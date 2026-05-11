import { AdminSkeletonRow } from "./AdminSkeletonRow";

/* ── AdminTable ─────────────────────────────────────────────────────────
   Dense data-table primitive used across every admin list (Audit,
   Revenue, Acquisition, Users, plus the User Detail sub-tables).
   Replaces eight ad-hoc <table> blocks and the horizontal-scroll
   treadmill on phone with a single component that:

     • Renders a sticky-header `<table>` at ≥700px (cool-gray surface)
     • Falls back to stacked `.admin-tbl-card` rows at <700px when a
       `mobileLayout` callback is provided
     • Supports sortable columns (click header → onSortChange({key,dir}))
     • Supports row selection (selectedRowKey + data-selected styling)
     • Supports row click (onRowClick(row))
     • Shows skeleton rows during initial load (`loading && !rows`)
     • Renders an empty state via the `empty` slot when no rows
     • Reserves a row-actions slot (kebab on hover) — Phase 2 wires the
       actual menu; Phase 1 ships the visual only

   Props:
     columns:     [{ key, label, sortable?, align?, render?, width?, mono?, headerExtra? }]
                  render(row) — defaults to row[col.key]
     rows:        any[]
     rowKey:      (row) => string                    (required)
     sort:        { key, dir: "asc"|"desc" } | null
     onSortChange:(nextSort) => void                 (passes null on clear)
     onRowClick:  (row) => void                      (optional — enables hover/cursor)
     selectedRowKey: string | null
     loading:     boolean
     skeletonRows:number (default 12)
     empty:       ReactNode rendered when !loading && rows.length === 0
     rowActions:  (row) => ReactNode                  (Phase 2; placeholder ok)
     mobileLayout:(row) => { primary, secondary?, meta?, badges?, right? }
                  When omitted, the <700px viewport falls back to a
                  horizontally-scrollable table. */
export function AdminTable({
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  onRowClick,
  selectedRowKey,
  loading = false,
  skeletonRows = 12,
  empty = null,
  rowActions,
  mobileLayout,
  ariaLabel,
}) {
  const showSkeletons = loading && (!rows || rows.length === 0);
  const showEmpty = !loading && rows && rows.length === 0;
  const hasRowActions = typeof rowActions === "function";

  const handleHeaderClick = (col) => {
    if (!col.sortable || typeof onSortChange !== "function") return;
    if (!sort || sort.key !== col.key) {
      onSortChange({ key: col.key, dir: "asc" });
      return;
    }
    if (sort.dir === "asc") {
      onSortChange({ key: col.key, dir: "desc" });
      return;
    }
    onSortChange(null);
  };

  return (
    <div className="admin-tbl-wrap">
      <table className="admin-tbl" aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((col) => {
              const active = sort && sort.key === col.key;
              return (
                <th
                  key={col.key}
                  data-sortable={col.sortable ? "true" : "false"}
                  data-sort-active={active ? "true" : "false"}
                  data-align={col.align || "left"}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={() => handleHeaderClick(col)}
                  scope="col"
                >
                  <span className="admin-tbl-th-inner">
                    {col.label}
                    {col.sortable && (
                      <span className="admin-tbl-sort-caret" aria-hidden="true">
                        {active ? (sort.dir === "asc" ? "▲" : "▼") : "▲"}
                      </span>
                    )}
                  </span>
                </th>
              );
            })}
            {hasRowActions && <th className="admin-tbl-row-actions" aria-label="" />}
          </tr>
        </thead>
        <tbody>
          {showSkeletons && Array.from({ length: skeletonRows }, (_, i) => (
            <AdminSkeletonRow key={`sk-${i}`} columns={columns} rowIndex={i} />
          ))}
          {showEmpty && (
            <tr>
              <td colSpan={columns.length + (hasRowActions ? 1 : 0)} style={{ padding: 0 }}>
                {empty}
              </td>
            </tr>
          )}
          {!showSkeletons && !showEmpty && (rows || []).map((row) => {
            const key = rowKey(row);
            const selected = selectedRowKey && key === selectedRowKey;
            const clickable = typeof onRowClick === "function";
            return (
              <tr
                key={key}
                data-clickable={clickable ? "true" : "false"}
                data-selected={selected ? "true" : "false"}
                onClick={clickable ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    data-align={col.align || "left"}
                    data-mono={col.mono ? "true" : "false"}
                  >
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
                {hasRowActions && (
                  <td className="admin-tbl-row-actions" onClick={(e) => e.stopPropagation()}>
                    {rowActions(row)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Mobile fallback — only renders at <700px (CSS gates it). */}
      {mobileLayout && (
        <div className="admin-tbl-cards" role="list">
          {showSkeletons && Array.from({ length: Math.min(6, skeletonRows) }, (_, i) => (
            <div className="admin-tbl-card" key={`mk-${i}`} aria-hidden="true">
              <div className="admin-tbl-card-row">
                <span className="sk-bar sk-bar-md" style={{ width: "60%" }} />
                <span className="sk-bar sk-bar-xs" style={{ width: 48 }} />
              </div>
              <span className="sk-bar sk-bar-sm" style={{ width: "78%", marginTop: 4 }} />
            </div>
          ))}
          {showEmpty && empty}
          {!showSkeletons && !showEmpty && (rows || []).map((row) => {
            const key = rowKey(row);
            const selected = selectedRowKey && key === selectedRowKey;
            const layout = mobileLayout(row) || {};
            const clickable = typeof onRowClick === "function";
            const Tag = clickable ? "button" : "div";
            const props = clickable
              ? { type: "button", onClick: () => onRowClick(row) }
              : {};
            return (
              <Tag
                key={key}
                className="admin-tbl-card"
                data-selected={selected ? "true" : "false"}
                role="listitem"
                style={clickable ? {
                  appearance: "none", background: "var(--admin-surface)", border: "none",
                  textAlign: "left", fontFamily: "inherit", color: "inherit", width: "100%",
                } : undefined}
                {...props}
              >
                <div className="admin-tbl-card-row">
                  <div className="admin-tbl-card-primary">{layout.primary}</div>
                  {(layout.badges || layout.right) && (
                    <div className="admin-tbl-card-badges">
                      {layout.badges}
                      {layout.right}
                    </div>
                  )}
                </div>
                {layout.secondary && <div className="admin-tbl-card-secondary">{layout.secondary}</div>}
                {layout.meta && <div className="admin-tbl-card-meta">{layout.meta}</div>}
              </Tag>
            );
          })}
        </div>
      )}
    </div>
  );
}
