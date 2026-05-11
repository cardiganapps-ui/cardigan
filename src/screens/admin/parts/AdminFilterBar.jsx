import { IconSearch } from "../../../components/Icons";

/* ── AdminFilterBar ─────────────────────────────────────────────────────
   Standard filter row: search input on the left, filter pills on the
   right. Replaces every screen's hand-rolled filter wrapper.

   Phase 1: ships static pill arrays (per-screen filter definitions).
   Phase 2: layers typeahead `+ Filter` + saved-views dropdown on the
   same primitive — see the plan file.

   Props:
     searchValue:       controlled search string
     onSearchChange:    (next) => void
     searchPlaceholder: placeholder text
     pills:             [{ key, label, active, onClick, count?, icon? }]
                        — keep arrays small (≤8) for Phase 1; for larger
                        facet sets, defer to Phase 2 typeahead.
     children:          extra slot rendered after the pills (e.g. a sort
                        dropdown or a CSV-export button on screens that
                        don't use AdminListHeader). */
export function AdminFilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  pills,
  children,
}) {
  return (
    <div className="admin-filter-bar-v2" role="toolbar" aria-label={searchPlaceholder}>
      {typeof onSearchChange === "function" && (
        <div className="admin-filter-bar-v2-search">
          <span className="admin-filter-bar-v2-search-icon"><IconSearch size={14} /></span>
          <input
            type="search"
            className="admin-filter-bar-v2-search-input"
            value={searchValue || ""}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>
      )}
      {pills && pills.length > 0 && (
        <div className="admin-filter-bar-v2-pills" role="group">
          {pills.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`admin-filter-bar-v2-pill${p.active ? " admin-filter-bar-v2-pill--active" : ""}`}
              onClick={p.onClick}
              aria-pressed={p.active ? "true" : "false"}
            >
              {p.icon}
              <span>{p.label}</span>
              {typeof p.count === "number" && (
                <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.7 }}>{p.count}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
