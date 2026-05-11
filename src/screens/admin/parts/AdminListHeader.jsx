/* ── AdminListHeader ────────────────────────────────────────────────────
   Sits above an AdminTable as a unified strip with title + total/filtered
   counts + sort dropdown + actions slot. Lives inside a `.admin-page-v2-section`.

   Props:
     title:        section title (e.g. "Usuarios")
     totalCount?:  number — total before filters (renders "N total")
     resultCount?: number — visible after filters (renders only when
                   it differs from totalCount, e.g. "12 of 247")
     sort?:        { value, options: [{ value, label }], onChange }
                   When provided, renders a native <select> for sort
     children:     right-aligned action buttons (e.g. "Exportar CSV") */
export function AdminListHeader({ title, totalCount, resultCount, sort, children }) {
  const hasFilter = typeof resultCount === "number" && typeof totalCount === "number" && resultCount !== totalCount;
  return (
    <div className="admin-list-header-v2">
      <div className="admin-list-header-v2-left">
        <div className="admin-list-header-v2-title">{title}</div>
        {(typeof totalCount === "number" || typeof resultCount === "number") && (
          <div className="admin-list-header-v2-count">
            {hasFilter
              ? `${resultCount?.toLocaleString?.("es-MX") ?? resultCount} de ${totalCount?.toLocaleString?.("es-MX") ?? totalCount}`
              : (totalCount ?? resultCount ?? 0)?.toLocaleString?.("es-MX") ?? totalCount ?? resultCount ?? 0}
          </div>
        )}
      </div>
      <div className="admin-list-header-v2-right">
        {sort && Array.isArray(sort.options) && (
          <select
            className="admin-list-header-v2-sort"
            value={sort.value}
            onChange={(e) => sort.onChange(e.target.value)}
            aria-label={sort.ariaLabel || "Ordenar"}
          >
            {sort.options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )}
        {children}
      </div>
    </div>
  );
}
