import { useState, useEffect, useMemo, useCallback } from "react";
import { fetchAllAccounts } from "../../hooks/useCardiganData";
import { useT } from "../../i18n/index";
import { TierBadge } from "./parts/TierBadge";
import { downloadCsv } from "./parts/csv";
import { IconDownload, IconSearch } from "../../components/Icons";

function nameParts(fullName) {
  const tokens = (fullName || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { first: "", last: "" };
  if (tokens.length === 1) return { first: tokens[0], last: "" };
  return { first: tokens[0], last: tokens.slice(1).join(" ") };
}
function compareNames(a, b) {
  const an = nameParts(a.fullName);
  const bn = nameParts(b.fullName);
  const cmp = (x, y) => x.localeCompare(y, "es", { sensitivity: "base" });
  return cmp(an.first, bn.first) || cmp(an.last, bn.last)
    || cmp((a.email || "").toLowerCase(), (b.email || "").toLowerCase());
}

const TIER_FILTERS = [
  { k: "all", l: "Todos" },
  { k: "pro", l: "Pro" },
  { k: "trial", l: "Prueba" },
  { k: "comp", l: "Comp" },
  { k: "expired", l: "Vencida" },
  { k: "blocked", l: "Bloqueados" },
];

const SORTS = [
  { k: "name", l: "Nombre" },
  { k: "signup", l: "Alta" },
  { k: "patients", l: "Pacientes" },
];

/* ── AdminUsers ──
   Searchable, filterable, sortable list of every user. Filters are
   client-side over the result of fetchAllAccounts (already paginates
   via Supabase and the row count is admin-tractable). Click a row to
   open `/admin/users/<uid>`.

   Per-row inline View-as / Block / etc. is intentionally NOT rendered
   here in v1 — the row click opens UserDetail, where UserActionsMenu
   surfaces the full action set with proper self-protection guards.
   Keeping the list dense reads more like a real admin list (Stripe /
   Linear) than rows that grow inline action strips. */
export function AdminUsers({ onSelect }) {
  const { t } = useT();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState("all");
  const [sort, setSort] = useState("name");

  const load = useCallback(() => {
    setLoading(true);
    fetchAllAccounts()
      .then((a) => { setAccounts(a); setError(""); setLoading(false); })
      .catch((e) => { setError(e.message || "Error al cargar"); setLoading(false); });
  }, []);

  // setLoading(true) inside load() is a no-op on mount since loading
  // initialises to true; matches the AccountsTab pattern in
  // AdminPanel.jsx.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = accounts.filter((a) => {
      if (tier === "blocked") { if (!a.blocked) return false; }
      else if (tier !== "all" && a.tier !== tier) return false;
      if (q) {
        const hay = `${a.fullName || ""} ${a.email || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (sort === "signup") {
      rows = rows.slice().sort((a, b) => (b.firstSeen || "").localeCompare(a.firstSeen || ""));
    } else if (sort === "patients") {
      rows = rows.slice().sort((a, b) => (b.patientCount || 0) - (a.patientCount || 0));
    } else {
      rows = rows.slice().sort(compareNames);
    }
    return rows;
  }, [accounts, search, tier, sort]);

  const onExport = () => {
    downloadCsv("cardigan-users-{date}.csv", filtered, [
      { label: "Nombre", get: (a) => a.fullName || "" },
      { label: "Email", get: (a) => a.email || "" },
      { label: "Profesión", get: (a) => a.profession || "" },
      { label: "Tier", get: (a) => a.tier || "" },
      { label: "Pacientes", get: (a) => a.patientCount },
      { label: "Bloqueado", get: (a) => a.blocked ? "sí" : "no" },
      { label: "Alta", get: (a) => a.firstSeen || "" },
      { label: "User ID", get: (a) => a.userId },
    ]);
  };

  return (
    <>
      <div className="admin-card">
        <div className="admin-filters">
          <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--charcoal-xl)", display: "inline-flex" }}>
              <IconSearch size={14} />
            </span>
            <input
              className="admin-search-input"
              type="search"
              placeholder="Buscar nombre o email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 32 }}
            />
          </div>
          {TIER_FILTERS.map((tf) => (
            <button key={tf.k} type="button"
              className={`admin-filter-pill${tier === tf.k ? " admin-filter-pill--active" : ""}`}
              onClick={() => setTier(tf.k)}>
              {tf.l}
            </button>
          ))}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="admin-filter-pill"
            style={{ appearance: "none", paddingRight: 24 }}>
            {SORTS.map((s) => <option key={s.k} value={s.k}>Ordenar: {s.l}</option>)}
          </select>
          <button type="button" className="admin-filter-pill" onClick={onExport}
            style={{ background: "var(--teal-pale)", borderColor: "var(--teal)", color: "var(--teal-dark)" }}>
            <IconDownload size={13} /> CSV
          </button>
        </div>

        {loading && <div className="admin-empty">Cargando…</div>}
        {error && !loading && (
          <div className="admin-empty" style={{ color: "var(--red)" }}>{error}</div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="admin-empty">Sin resultados.</div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Profesión</th>
                <th>Tier</th>
                <th style={{ textAlign: "right" }}>Pacientes</th>
                <th>Alta</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.userId}
                  className="admin-table-row--clickable"
                  onClick={() => onSelect?.(a.userId)}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 600 }}>{a.fullName || <span style={{ color: "var(--charcoal-xl)" }}>{t("admin.noName")}</span>}</span>
                      {a.blocked && <span className="badge badge-red" style={{ fontSize: 10 }}>Bloqueado</span>}
                    </div>
                  </td>
                  <td style={{ color: "var(--charcoal-md)", wordBreak: "break-all" }}>
                    {a.email || <span style={{ color: "var(--charcoal-xl)" }}>—</span>}
                  </td>
                  <td style={{ color: "var(--teal-dark)", fontWeight: 600 }}>
                    {a.profession ? t(`onboarding.professions.${a.profession}.label`) : "—"}
                  </td>
                  <td><TierBadge account={a} /></td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{a.patientCount}</td>
                  <td style={{ color: "var(--charcoal-xl)", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                    {a.firstSeen ? new Date(a.firstSeen).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "2-digit" }) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
