import { useEffect, useMemo, useRef, useState } from "react";
import { IconSearch, IconPlus, IconX } from "../../../components/Icons";
import { useEscape } from "../../../hooks/useEscape";

/* ── AdminFilterBar ─────────────────────────────────────────────────────
   Standard filter row: search input on the left, filter pills on the
   right.

   Phase 1 surface: static pill arrays per screen.
   Phase 2 additions:
     • children slot (e.g. <AdminSavedViews>)
     • `facets` typeahead picker — when provided, renders a "+ Filtro"
       affordance at the end of the pills row. Clicking opens a
       searchable popover listing all facet options not yet active.
       Picking one calls the option's `apply()` (typically the same
       handler the static pill would use). Useful when a screen has
       so many facets that a flat pill row gets noisy.

   Props:
     searchValue:       controlled search string
     onSearchChange:    (next) => void
     searchPlaceholder: placeholder text
     pills:             [{ key, label, active, onClick, count?, icon? }]
     facets:            [{ key, label, options: [{ key, label, apply,
                          active? }] }]
                        Pass alongside `pills` to enable +Filtro typeahead.
     children:          right-side slot (e.g. AdminSavedViews dropdown) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed filter pill / facet rows
type Row = any;

export function AdminFilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  pills,
  facets,
  children,
}: {
  searchValue?: string;
  onSearchChange?: (next: string) => void;
  searchPlaceholder?: string;
  pills?: Row[];
  facets?: Row[];
  children?: React.ReactNode;
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
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>
      )}
      {((pills && pills.length > 0) || (facets && facets.length > 0)) && (
        <div className="admin-filter-bar-v2-pills" role="group">
          {(pills || []).map((p: Row) => (
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
          {facets && facets.length > 0 && <FacetPicker facets={facets} />}
        </div>
      )}
      {children}
    </div>
  );
}

/* + Filtro typeahead. Lists all facet options across all groups, with a
   case-insensitive substring filter. Picking an option calls its
   apply() which the parent typically wires to the same handler the
   pill would call. Active options are visually marked but still
   selectable so the admin can re-apply / toggle. */
function FacetPicker({ facets }: { facets: Row[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Closing also resets the typed query — handled in this single
  // helper so both the Esc + outside-click + opt-click paths converge.
  const close = () => { setOpen(false); setQ(""); };

  useEscape(open ? close : null);

  // Outside-click closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Auto-focus the input when opened.
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
  }, [open]);

  const flat = useMemo(() => {
    const out: Row[] = [];
    for (const f of facets) {
      for (const o of f.options || []) {
        out.push({
          ...o,
          group: f.label,
          searchKey: `${f.label} ${o.label}`.toLowerCase(),
        });
      }
    }
    return out;
  }, [facets]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return flat;
    return flat.filter((o: Row) => o.searchKey.includes(needle));
  }, [flat, q]);

  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const o of filtered) {
      if (!map.has(o.group)) map.set(o.group, []);
      map.get(o.group)!.push(o);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div ref={containerRef} className="admin-filter-facet" style={{ position: "relative" }}>
      <button
        type="button"
        className="admin-filter-bar-v2-pill admin-filter-bar-v2-pill--add"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <IconPlus size={11} />
        <span>Filtro</span>
      </button>
      {open && (
        <div className="admin-filter-facet-pop" role="listbox">
          <div className="admin-filter-facet-search">
            <IconSearch size={12} />
            <input
              ref={inputRef}
              value={q}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
              placeholder="Buscar filtro…"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Limpiar"
                className="admin-filter-facet-clear"
              >
                <IconX size={11} />
              </button>
            )}
          </div>
          <div className="admin-filter-facet-list">
            {grouped.length === 0 ? (
              <div className="admin-filter-facet-empty">Sin coincidencias</div>
            ) : (
              grouped.map(([groupLabel, opts]: [string, Row[]]) => (
                <div key={groupLabel} className="admin-filter-facet-group">
                  <div className="admin-filter-facet-group-label">{groupLabel}</div>
                  {opts.map((o: Row) => (
                    <button
                      key={`${groupLabel}:${o.key}`}
                      type="button"
                      className={`admin-filter-facet-opt${o.active ? " admin-filter-facet-opt--active" : ""}`}
                      onClick={() => { o.apply?.(); close(); }}
                    >
                      <span>{o.label}</span>
                      {o.active && <span aria-hidden="true">✓</span>}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
