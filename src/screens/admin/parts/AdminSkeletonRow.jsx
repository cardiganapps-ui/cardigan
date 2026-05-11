/* ── AdminSkeletonRow ───────────────────────────────────────────────────
   Skeleton table row that mirrors an AdminTable `columns` shape. Uses
   the shared .sk-bar shimmer (defined in components.css) so the cadence
   matches every other loading skeleton in the app.

   Pure presentational — AdminTable instantiates `skeletonRows` of these
   while `loading && !rows`. Each skeleton bar's width is hashed from the
   column index so successive rows don't line up identically. */
export function AdminSkeletonRow({ columns, rowIndex = 0 }) {
  return (
    <tr className="admin-tbl-skeleton" aria-hidden="true">
      {columns.map((col, i) => {
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
