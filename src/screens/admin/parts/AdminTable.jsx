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
     • Supports MULTI-select (selectable + selectedKeys + onSelectionChange)
       — adds a checkbox column on the left with header "select all"

   Props:
     columns:     [{ key, label, sortable?, align?, render?, width?, mono?, headerExtra? }]
                  render(row) — defaults to row[col.key]
     rows:        any[]
     rowKey:      (row) => string                    (required)
     sort:        { key, dir: "asc"|"desc" } | null
     onSortChange:(nextSort) => void                 (passes null on clear)
     onRowClick:  (row) => void                      (optional — enables hover/cursor)
     selectedRowKey: string | null                   (single-select highlight)
     loading:     boolean
     skeletonRows:number (default 12)
     empty:       ReactNode rendered when !loading && rows.length === 0
     rowActions:  (row) => ReactNode                  (Phase 2; placeholder ok)
     mobileLayout:(row) => { primary, secondary?, meta?, badges?, right? }
                  When omitted, the <700px viewport falls back to a
                  horizontally-scrollable table.

     selectable:        boolean — show checkbox column for multi-select
     selectedKeys:      Set<string> | string[] of row keys currently checked
     onSelectionChange: (Set<string>) => void    — bulk add/remove handler
     selectionDisabled: (row) => boolean         — per-row checkbox disable
*/
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
  selectable = false,
  selectedKeys,
  onSelectionChange,
  selectionDisabled,
}) {
  const showSkeletons = loading && (!rows || rows.length === 0);
  const showEmpty = !loading && rows && rows.length === 0;
  const hasRowActions = typeof rowActions === "function";

  // Defensive normalization: selectable callers should pass either a
  // Set or an array; null/undefined falls back to an empty Set rather
  // than crashing on `new Set(undefined)`.
  const selectionSet = selectable
    ? (selectedKeys instanceof Set
        ? selectedKeys
        : new Set(Array.isArray(selectedKeys) ? selectedKeys : []))
    : null;

  const allRowKeys = (rows || []).map(rowKey);
  const eligibleKeys = selectable
    ? allRowKeys.filter((k, i) => !(typeof selectionDisabled === "function" && selectionDisabled(rows[i])))
    : [];
  const allSelected = selectable && eligibleKeys.length > 0 && eligibleKeys.every((k) => selectionSet.has(k));
  const someSelected = selectable && !allSelected && eligibleKeys.some((k) => selectionSet.has(k));

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

  const toggleAll = () => {
    if (!onSelectionChange) return;
    const next = new Set(selectionSet);
    if (allSelected) {
      eligibleKeys.forEach((k) => next.delete(k));
    } else {
      eligibleKeys.forEach((k) => next.add(k));
    }
    onSelectionChange(next);
  };

  const toggleRow = (key, disabled) => {
    if (!onSelectionChange || disabled) return;
    const next = new Set(selectionSet);
    if (next.has(key)) next.delete(key); else next.add(key);
    onSelectionChange(next);
  };

  return (
    <div className="admin-tbl-wrap">
      <table className="admin-tbl" aria-label={ariaLabel}>
        <thead>
          <tr>
            {selectable && (
              <th className="admin-tbl-select-col" scope="col" aria-label="Seleccionar todo">
                <input
                  type="checkbox"
                  className="admin-tbl-checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleAll}
                  disabled={eligibleKeys.length === 0}
                />
              </th>
            )}
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
            <AdminSkeletonRow key={`sk-${i}`} columns={columns} rowIndex={i} prefixCols={selectable ? 1 : 0} />
          ))}
          {showEmpty && (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0) + (hasRowActions ? 1 : 0)} style={{ padding: 0 }}>
                {empty}
              </td>
            </tr>
          )}
          {!showSkeletons && !showEmpty && (rows || []).map((row) => {
            const key = rowKey(row);
            const selected = selectedRowKey && key === selectedRowKey;
            const checked = selectable && selectionSet.has(key);
            const disabled = selectable && typeof selectionDisabled === "function" && selectionDisabled(row);
            const clickable = typeof onRowClick === "function";
            return (
              <tr
                key={key}
                data-clickable={clickable ? "true" : "false"}
                data-selected={selected ? "true" : "false"}
                data-checked={checked ? "true" : "false"}
                onClick={clickable ? () => onRowClick(row) : undefined}
              >
                {selectable && (
                  <td
                    className="admin-tbl-select-col"
                    onClick={(e) => { e.stopPropagation(); toggleRow(key, disabled); }}
                  >
                    <input
                      type="checkbox"
                      className="admin-tbl-checkbox"
                      checked={checked}
                      onChange={(e) => { e.stopPropagation(); toggleRow(key, disabled); }}
                      disabled={disabled}
                      aria-label="Seleccionar fila"
                    />
                  </td>
                )}
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
            const checked = selectable && selectionSet.has(key);
            const disabled = selectable && typeof selectionDisabled === "function" && selectionDisabled(row);
            const layout = mobileLayout(row) || {};
            const clickable = typeof onRowClick === "function";
            return (
              <div
                key={key}
                className="admin-tbl-card"
                data-selected={selected ? "true" : "false"}
                data-checked={checked ? "true" : "false"}
                role="listitem"
              >
                {selectable && (
                  <label
                    className="admin-tbl-card-checkbox"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      className="admin-tbl-checkbox"
                      checked={checked}
                      onChange={() => toggleRow(key, disabled)}
                      disabled={disabled}
                      aria-label="Seleccionar"
                    />
                  </label>
                )}
                <div
                  className="admin-tbl-card-body"
                  onClick={clickable ? () => onRowClick(row) : undefined}
                  style={clickable ? { cursor: "pointer" } : undefined}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onKeyDown={clickable ? (e) => { if (e.key === "Enter") onRowClick(row); } : undefined}
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
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
