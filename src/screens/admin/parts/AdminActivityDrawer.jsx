import { useEffect, useMemo, useState } from "react";
import { fetchAuditLog } from "../../../hooks/useCardiganData";
import { useEscape } from "../../../hooks/useEscape";
import { useFocusTrap } from "../../../hooks/useFocusTrap";
import { IconX } from "../../../components/Icons";
import { useAuditLabel } from "./auditLabels";
import { AdminEmpty } from "./AdminEmpty";

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

function fmtRelative(iso) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `hace ${months}mo`;
  const years = Math.floor(days / 365);
  return `hace ${years}a`;
}

/* ── AdminActivityDrawer ────────────────────────────────────────────────
   Right-edge slide-in drawer that surfaces the last 50 admin_audit_log
   rows globally (not scoped to a single user). Toggled from a bell-icon
   button in AdminLayout's header.

   Behaviors:
     • Esc closes (useEscape)
     • Focus trapped while open (useFocusTrap)
     • Overlay click closes
     • Filter dropdown lists all distinct actor IDs from the loaded set
     • Each row navigates to the related user's detail when an actor
       button is clicked (NOT the row body — a click on the body would
       conflict with read-then-act intent)

   Lazy fetch — the audit log only loads the first time the drawer
   opens, then stays cached for the session. */
export function AdminActivityDrawer({ open, onClose, onJumpToUser }) {
  const auditLabel = useAuditLabel();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actorFilter, setActorFilter] = useState("all");
  const [loaded, setLoaded] = useState(false);

  const trapRef = useFocusTrap(open);
  useEscape(open ? onClose : null);

  // Lock body scroll while open. Mirrors the pattern in app sheets.
  // Two effects: the first ties the lock to `open`, the second is a
  // belt-and-suspenders unmount cleanup that always clears the inline
  // override on tear-down, so a parent re-mount that snaps `open=true`
  // away mid-render can't leave the body permanently un-scrollable.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [open]);
  useEffect(() => () => {
    // Guarantee cleanup if the drawer is open at unmount time.
    document.body.style.overflow = "";
  }, []);

  // Lazy fetch on first open. Refetch each open is too aggressive for
  // a side-panel; admins can re-open if they want a fresh pull. The
  // setState-in-effect pattern is correct here — the fetch lifecycle
  // is genuinely derived from `open && !loaded`, not from local input.
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError("");
    fetchAuditLog({ limit: 50 })
      .then((r) => { if (!cancelled) { setRows(r || []); setLoaded(true); } })
      .catch((e) => { if (!cancelled) setError(e?.message || "Error"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, loaded]);

  const actorOptions = useMemo(() => {
    const set = new Set();
    for (const r of rows) if (r.actor_id) set.add(r.actor_id);
    return Array.from(set);
  }, [rows]);

  const filtered = useMemo(() => {
    if (actorFilter === "all") return rows;
    return rows.filter((r) => r.actor_id === actorFilter);
  }, [rows, actorFilter]);

  if (!open) return null;

  return (
    <>
      <div
        className="admin-activity-drawer-scrim"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={trapRef}
        className="admin-activity-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Actividad reciente"
      >
        <header className="admin-activity-drawer-header">
          <div>
            <div className="admin-activity-drawer-title">Actividad reciente</div>
            <div className="admin-activity-drawer-sub">Últimas 50 acciones de admin</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="admin-activity-drawer-close"
            aria-label="Cerrar"
          >
            <IconX size={16} />
          </button>
        </header>

        <div className="admin-activity-drawer-toolbar">
          <select
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="admin-list-header-v2-sort"
            aria-label="Filtrar por actor"
          >
            <option value="all">Todos los actores</option>
            {actorOptions.map((id) => (
              <option key={id} value={id}>{id.slice(0, 8)}…</option>
            ))}
          </select>
          <button
            type="button"
            className="admin-bulk-bar-clear"
            onClick={() => { setLoaded(false); }}
          >
            Recargar
          </button>
        </div>

        <div className="admin-activity-drawer-body">
          {loading && rows.length === 0 ? (
            <div role="status" aria-busy="true">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="admin-activity-row" aria-hidden="true">
                  <span className="sk-circle" style={{ width: 24, height: 24, flexShrink: 0 }} />
                  <span className="sk-bar sk-bar-sm" style={{ flex: 1, maxWidth: "60%" }} />
                  <span className="sk-bar sk-bar-xs" style={{ width: 56 }} />
                </div>
              ))}
            </div>
          ) : error ? (
            <AdminEmpty title="No se pudo cargar" body={error} />
          ) : filtered.length === 0 ? (
            <AdminEmpty
              title={rows.length === 0 ? "Sin actividad" : "Sin coincidencias"}
              body={rows.length === 0 ? "Cuando ocurran acciones de admin, aparecerán aquí." : "Cambia el filtro de actor."}
            />
          ) : (
            filtered.map((r) => {
              const targetSlug = r.target_user_id ? r.target_user_id.slice(0, 8) : null;
              return (
                <div key={r.id} className="admin-activity-row">
                  <span
                    className="admin-activity-row-icon"
                    style={{ background: "var(--admin-accent-soft)", color: "var(--admin-accent)" }}
                    aria-hidden="true"
                  >
                    ⚙
                  </span>
                  <span className="admin-activity-row-body">
                    <span className="admin-activity-row-actor">{auditLabel(r.action)}</span>
                    {r.target_user_id && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="admin-activity-drawer-target"
                          onClick={() => { onClose?.(); onJumpToUser?.(r.target_user_id); }}
                          title={`Abrir ${r.target_user_id}`}
                        >
                          {targetSlug}…
                        </button>
                      </>
                    )}
                    {r.actor_id && (
                      <>
                        {" "}
                        <span className="admin-activity-row-target">por {r.actor_id.slice(0, 8)}…</span>
                      </>
                    )}
                  </span>
                  <span className="admin-activity-row-time" title={fmtDateTime(r.created_at)}>
                    {fmtRelative(r.created_at)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}
