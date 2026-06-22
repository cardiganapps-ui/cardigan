import { useEffect, useRef, useState } from "react";
import {
  fetchAdminSavedViews,
  createAdminSavedView,
  deleteAdminSavedView,
} from "../../../hooks/useCardiganData";
import { useEscape } from "../../../hooks/useEscape";
import { IconChevron, IconTrash, IconPlus } from "../../../components/Icons";

/* ── AdminSavedViews ────────────────────────────────────────────────────
   Dropdown on the right side of AdminFilterBar that lets the admin team
   share filter presets per screen. Backed by /api/admin-saved-views
   (table admin_saved_views, mig 063).

   Props:
     screen:           one of the SCREENS the table check accepts
     currentState:     the current filter snapshot (passed into "Save")
     onApply:          (filterState) => void — called when admin picks a view
     ariaLabel:        accessible label for the dropdown trigger

   The component lazy-loads the views list the first time the dropdown
   is opened (a screen change resets `loaded` so the next open refetches).
*/
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed saved-view / filter-state rows
type Row = any;

export function AdminSavedViews({ screen, currentState, onApply, ariaLabel }: {
  screen: string;
  currentState?: Row;
  onApply?: (filterState: Row) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingName, setSavingName] = useState("");
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEscape(open ? () => setOpen(false) : null);

  // Outside-click closes the popover.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Reset loaded state when screen changes — a different screen has a
  // different list. Lazy-load on next open.
  useEffect(() => { setLoaded(false); setViews([]); }, [screen]);

  useEffect(() => {
    if (!open || loaded || loading) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchAdminSavedViews(screen)
      .then((rows: Row[]) => { if (!cancelled) { setViews(rows); setLoaded(true); } })
      .catch((e: Row) => { if (!cancelled) setError(e?.message || "Error"); })
      .finally(() => {
        // Mirror the .then/.catch cancellation gate so a popover that
        // unmounts mid-flight doesn't drop a stale setLoading(false)
        // into a defunct render tree.
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, loaded, loading, screen]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !savingName.trim()) return;
    setSaving(true);
    setError("");
    try {
      const view = await createAdminSavedView({
        screen,
        name: savingName.trim(),
        filterState: currentState,
      });
      setViews((prev: Row[]) => [view, ...prev]);
      setSavingName("");
    } catch (err) {
      setError((err as Error)?.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: Row) => {
    setError("");
    try {
      await deleteAdminSavedView(id);
      setViews((prev: Row[]) => prev.filter((v: Row) => v.id !== id));
    } catch (err) {
      setError((err as Error)?.message || "Error al eliminar");
    }
  };

  const handleApply = (v: Row) => {
    onApply?.(v.filter_state);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="admin-saved-views" style={{ position: "relative" }}>
      <button
        type="button"
        className="admin-filter-bar-v2-pill"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel || "Vistas guardadas"}
        onClick={() => setOpen((v) => !v)}
      >
        Vistas
        <IconChevron size={11} />
      </button>
      {open && (
        <div className="admin-saved-views-pop" role="menu">
          <div className="admin-saved-views-pop-section">
            <div className="admin-saved-views-pop-label">Guardadas</div>
            {loading && views.length === 0 ? (
              <div className="admin-saved-views-pop-empty">Cargando…</div>
            ) : views.length === 0 ? (
              <div className="admin-saved-views-pop-empty">Sin vistas. Guarda una con el filtro actual.</div>
            ) : (
              <ul className="admin-saved-views-pop-list">
                {views.map((v: Row) => (
                  <li key={v.id} className="admin-saved-views-pop-item">
                    <button
                      type="button"
                      className="admin-saved-views-pop-item-name"
                      onClick={() => handleApply(v)}
                      title={`Aplicar "${v.name}"`}
                    >
                      {v.name}
                    </button>
                    <button
                      type="button"
                      className="admin-saved-views-pop-item-del"
                      onClick={() => handleDelete(v.id)}
                      aria-label={`Eliminar "${v.name}"`}
                      title="Eliminar"
                    >
                      <IconTrash size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form onSubmit={handleSave} className="admin-saved-views-pop-section admin-saved-views-pop-save">
            <div className="admin-saved-views-pop-label">Guardar filtro actual</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                value={savingName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSavingName(e.target.value)}
                placeholder="Nombre…"
                className="admin-filter-bar-v2-search-input"
                style={{ height: 28, paddingLeft: 10, paddingRight: 10 }}
                maxLength={60}
                disabled={saving}
              />
              <button
                type="submit"
                className="admin-saved-views-pop-save-btn"
                disabled={saving || !savingName.trim()}
                aria-label="Guardar"
              >
                <IconPlus size={12} />
                {saving ? "…" : "Guardar"}
              </button>
            </div>
            {error && <div className="admin-saved-views-pop-error">{error}</div>}
          </form>
        </div>
      )}
    </div>
  );
}
