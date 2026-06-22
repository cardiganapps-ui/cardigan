/* ── AdminSkeletonRow ───────────────────────────────────────────────────
   Skeleton table row that mirrors an AdminTable `columns` shape. Uses
   the shared .sk-bar shimmer (defined in components.css) so the cadence
   matches every other loading skeleton in the app.

   Pure presentational — AdminTable instantiates `skeletonRows` of these
   while `loading && !rows`. Each skeleton bar's width is hashed from the
   column index so successive rows don't line up identically.

   `prefixCols` reserves N empty leading <td>s — used by AdminTable
   when a checkbox-select column is rendered, so the skeleton's column
   alignment matches the populated rows. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed AdminTable column rows
type Row = any;

export function AdminSkeletonRow({ columns, rowIndex = 0, prefixCols = 0 }: {
  columns: Row[];
  rowIndex?: number;
  prefixCols?: number;
}) {
  return (
    <tr className="admin-tbl-skeleton" aria-hidden="true">
      {Array.from({ length: prefixCols }, (_, i) => (
        <td key={`prefix-${i}`} className="admin-tbl-select-col" />
      ))}
      {columns.map((col: Row, i: number) => {
        // Pseudo-random width per (row, col) so skeleton rows don't all
        // look identical. Modulo a few buckets keeps it deterministic.
        const seed = (rowIndex * 7 + i * 13) % 5;
        const width = ["68%", "82%", "55%", "74%", "90%"][seed];
        return (
          <td key={col.key} data-align={col.align || "left"}>
            <span className="sk-bar" style={{ display: "inline-block", width }} />
          </td>
        );
      })}
    </tr>
  );
}
