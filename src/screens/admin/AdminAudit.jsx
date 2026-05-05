import { useState, useEffect, useMemo, useCallback } from "react";
import { fetchAuditLog } from "../../hooks/useCardiganData";
import { downloadCsv } from "./parts/csv";
import { IconDownload, IconSearch } from "../../components/Icons";

const ACTION_LABELS = {
  block_user: "Bloqueo de usuario",
  unblock_user: "Desbloqueo",
  delete_user: "Eliminación",
  update_profession: "Cambio de profesión",
  grant_comp: "Comp otorgada",
  revoke_comp: "Comp revocada",
  create_code: "Código creado",
  toggle_code: "Código alternado",
  recover_encryption: "Recuperación de cifrado",
  view_as: "Ver como usuario",
};

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

const ACTION_FILTERS = [
  { k: "all", l: "Todas" },
  { k: "block_user", l: "Bloqueos" },
  { k: "delete_user", l: "Eliminaciones" },
  { k: "grant_comp", l: "Comp" },
  { k: "view_as", l: "Ver como" },
  { k: "create_code", l: "Códigos" },
  { k: "recover_encryption", l: "Cifrado" },
];

/* ── AdminAudit ──
   Chronological dump of admin_audit_log. Filters: action type + free
   text. CSV export supplies the raw rows for offline analysis. */
export function AdminAudit() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetchAuditLog({ limit: 500 });
      setRows(r);
    } catch (e) {
      setError(e.message || "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (actionFilter !== "all" && r.action !== actionFilter) return false;
      if (q) {
        const hay = `${r.action} ${r.actor_id || ""} ${r.target_user_id || ""} ${JSON.stringify(r.payload || {})}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, actionFilter, search]);

  const onCsv = () => {
    downloadCsv("cardigan-audit-{date}.csv", filtered, [
      { label: "Fecha", get: (r) => r.created_at },
      { label: "Acción", get: (r) => r.action },
      { label: "Actor ID", get: (r) => r.actor_id },
      { label: "Target ID", get: (r) => r.target_user_id || "" },
      { label: "Payload", get: (r) => r.payload ? JSON.stringify(r.payload) : "" },
      { label: "IP", get: (r) => r.ip || "" },
      { label: "User-Agent", get: (r) => r.ua || "" },
    ]);
  };

  return (
    <div className="admin-card">
      <div style={{ marginBottom: 12 }}>
        <div className="admin-card-title">Registro de auditoría</div>
        <div className="admin-card-sub">
          Cada acción administrativa queda registrada con actor, objetivo, IP y user-agent.
          Inmutable; sólo los administradores pueden leerlo (RLS).
        </div>
      </div>

      <div className="admin-filters">
        <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--charcoal-xl)", display: "inline-flex" }}>
            <IconSearch size={14} />
          </span>
          <input className="admin-search-input" type="search"
            placeholder="Buscar actor, objetivo, payload…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 32 }} />
        </div>
        {ACTION_FILTERS.map((af) => (
          <button key={af.k} type="button"
            className={`admin-filter-pill${actionFilter === af.k ? " admin-filter-pill--active" : ""}`}
            onClick={() => setActionFilter(af.k)}>
            {af.l}
          </button>
        ))}
        <button type="button" className="admin-filter-pill" onClick={onCsv}
          style={{ background: "var(--teal-pale)", borderColor: "var(--teal)", color: "var(--teal-dark)" }}>
          <IconDownload size={13} /> CSV
        </button>
      </div>

      {loading && <div className="admin-empty">Cargando…</div>}
      {error && <div className="admin-empty" style={{ color: "var(--red)" }}>{error}</div>}
      {!loading && !error && filtered.length === 0 && <div className="admin-empty">Sin eventos registrados.</div>}
      {!loading && !error && filtered.length > 0 && (
        <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Acción</th>
              <th>Actor</th>
              <th>Objetivo</th>
              <th>Payload</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.created_at)}</td>
                <td style={{ fontWeight: 600 }}>{ACTION_LABELS[r.action] || r.action}</td>
                <td style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11 }}>
                  {(r.actor_id || "").slice(0, 8)}…
                </td>
                <td style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11 }}>
                  {r.target_user_id ? `${r.target_user_id.slice(0, 8)}…` : "—"}
                </td>
                <td style={{ fontSize: 11, fontFamily: "var(--font-mono, monospace)", color: "var(--charcoal-xl)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.payload ? JSON.stringify(r.payload) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
