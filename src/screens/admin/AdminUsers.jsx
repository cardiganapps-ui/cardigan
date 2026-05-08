import { useState, useMemo } from "react";
import { fetchAllAccounts } from "../../hooks/useCardiganData";
import { useT } from "../../i18n/index";
import { Avatar } from "../../components/Avatar";
import { TierBadge } from "./parts/TierBadge";
import { downloadCsv } from "./parts/csv";
import { IconDownload, IconSearch } from "../../components/Icons";
import { useAdminQuery } from "./useAdminQuery";

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

function initialsFor(name, email) {
  const src = (name || email || "?").trim();
  if (!src) return "?";
  const parts = src.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "2-digit" });
}

const TIER_FILTERS = [
  { k: "all", l: "Todos" },
  { k: "therapist", l: "Terapeutas" },
  { k: "patient", l: "Pacientes" },
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
   client-side over fetchAllAccounts (the row count is admin-tractable
   in v1). Click a row to open `/admin/users/<uid>`.

   Layout: a `.card` wrapping `.row-item` rows, identical to the
   Patients screen so this reads as a Cardigan list, not a dense
   Stripe-style table. The previous `<table>` rendering wrapped
   emails character-by-character on mobile and was unscannable.
   Per-row inline actions (View as / Block / etc.) are intentionally
   NOT here — the row click opens UserDetail where UserActionsMenu
   surfaces the full action set with proper self-protection guards. */
export function AdminUsers({ onSelect }) {
  const { t } = useT();
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState("all");
  const [sort, setSort] = useState("name");

  const { data: accounts = [], loading, error } = useAdminQuery("users:all", fetchAllAccounts);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = accounts.filter((a) => {
      if (tier === "blocked") { if (!a.blocked) return false; }
      else if (tier === "therapist" || tier === "patient") {
        if (a.accountType !== tier) return false;
      }
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
      { label: "Tipo", get: (a) => a.accountType || "" },
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
      {/* Filters surface (uses admin-card padding for breathing room) */}
      <div className="admin-card">
        <div className="admin-filters" style={{ marginBottom: 0 }}>
          <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--charcoal-xl)", display: "inline-flex", pointerEvents: "none" }}>
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
      </div>

      {/* Result count + list. The list lives in its OWN .card (not
          nested inside admin-card) so the row-item padding doesn't
          compound with the admin-card padding. .card has overflow:
          hidden so the row borders honor the rounded corners. */}
      <div style={{ fontSize: 11, color: "var(--charcoal-xl)", padding: "0 4px" }}>
        {filtered.length === accounts.length
          ? `${filtered.length} ${filtered.length === 1 ? "cuenta" : "cuentas"}`
          : `${filtered.length} de ${accounts.length}`}
      </div>

      {loading && <div className="admin-card admin-empty">Cargando…</div>}
      {error && !loading && (
        <div className="admin-card admin-empty" style={{ color: "var(--red)" }}>{error}</div>
      )}
      {!loading && !error && filtered.length === 0 && (
        <div className="admin-card admin-empty">Sin resultados.</div>
      )}
      {!loading && !error && filtered.length > 0 && (
        <div className="card admin-user-list">
          {filtered.map((a) => {
            const isPatient = a.accountType === "patient";
            return (
              <div key={a.userId}
                className="row-item"
                style={{ cursor: "pointer" }}
                onClick={() => onSelect?.(a.userId)}>
                <Avatar initials={initialsFor(a.fullName, a.email)} size="md" />
                <div className="row-content">
                  <div className="row-title" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: "0 1 auto" }}>
                      {a.fullName || <span style={{ color: "var(--charcoal-xl)", fontWeight: 500, fontStyle: "italic" }}>{t("admin.noName")}</span>}
                    </span>
                    {isPatient && <span className="badge badge-rose">Paciente</span>}
                    {a.blocked && <span className="badge badge-red">Bloqueado</span>}
                  </div>
                  <div className="row-sub admin-user-sub">
                    <span className="admin-user-email">{a.email || "—"}</span>
                    <span className="admin-user-meta-line">
                      {!isPatient && a.profession && (
                        <span style={{ color: "var(--teal-dark)", fontWeight: 700 }}>
                          {t(`onboarding.professions.${a.profession}.label`)}
                        </span>
                      )}
                      {!isPatient && a.profession && " · "}
                      {!isPatient && (
                        <>
                          {a.patientCount} {a.patientCount === 1 ? "paciente" : "pacientes"}
                          {" · "}
                        </>
                      )}
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>alta {fmtDate(a.firstSeen)}</span>
                    </span>
                  </div>
                </div>
                <div className="admin-user-tier" style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
                  {!isPatient && <TierBadge account={a} />}
                </div>
                <span className="row-chevron">›</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
