/* ── AdminBulkBar ───────────────────────────────────────────────────────
   Sticky bottom action bar that appears when ≥1 row is checked in an
   AdminTable. Lives INSIDE the list-pane scroll container so it stays
   above the list at the bottom of the viewport without floating over
   the rest of the screen.

   Props:
     count:      number of selected rows (renders nothing when 0)
     actions:    [{ key, label, Icon?, onClick, danger?, disabled? }]
     onClear:    () => void  — called by the "Limpiar" button
     pendingKey: optional key of an action that's mid-flight; that
                 action shows "…" and disables siblings
*/
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely-typed bulk-action rows
type Row = any;

export function AdminBulkBar({ count, actions, onClear, pendingKey }: {
  count?: number;
  actions: Row[];
  onClear?: () => void;
  pendingKey?: string | null;
}) {
  if (!count) return null;
  const anyPending = !!pendingKey;
  return (
    <div className="admin-bulk-bar" role="region" aria-label={`${count} seleccionado${count === 1 ? "" : "s"}`}>
      <span className="admin-bulk-bar-count">
        <strong>{count}</strong>
        seleccionado{count === 1 ? "" : "s"}
      </span>
      <div className="admin-bulk-bar-actions">
        {actions.map((a: Row) => (
          <button
            key={a.key}
            type="button"
            className={`admin-bulk-bar-action${a.danger ? " admin-bulk-bar-action--danger" : ""}`}
            disabled={a.disabled || (anyPending && pendingKey !== a.key)}
            onClick={a.onClick}
          >
            {a.Icon && <a.Icon size={13} />}
            {pendingKey === a.key ? "…" : a.label}
          </button>
        ))}
        <button type="button" className="admin-bulk-bar-clear" onClick={onClear}>
          Limpiar
        </button>
      </div>
    </div>
  );
}
