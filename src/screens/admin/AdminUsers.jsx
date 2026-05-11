import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  fetchAllAccounts,
  adminBlockUser,
  adminGrantComp,
} from "../../hooks/useCardiganData";
import { useT } from "../../i18n/index";
import { useCardigan } from "../../context/CardiganContext";
import { Avatar } from "../../components/Avatar";
import { TierBadge } from "./parts/TierBadge";
import { downloadCsv } from "./parts/csv";
import {
  IconDownload, IconArrowLeft, IconShield, IconCheck, IconUserPlus,
} from "../../components/Icons";
import { useAdminQuery, invalidateAdminCache } from "./useAdminQuery";
import { AdminPage } from "./parts/AdminPage";
import { AdminFilterBar } from "./parts/AdminFilterBar";
import { AdminListHeader } from "./parts/AdminListHeader";
import { AdminTable } from "./parts/AdminTable";
import { AdminBadge } from "./parts/AdminBadge";
import { AdminEmpty } from "./parts/AdminEmpty";
import { AdminBulkBar } from "./parts/AdminBulkBar";
import { AdminSavedViews } from "./parts/AdminSavedViews";
import { AdminUserDetail } from "./AdminUserDetail";
import { useAdminSort } from "./parts/useAdminSort";

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

/* ── AdminUsers ─────────────────────────────────────────────────────────
   v2: master-detail split-view.
     • ≥1024px: list (380px) + AdminUserDetail (flex:1, embedded)
     • <1024px: list takes full width; selecting a user swaps to detail
                via data-mobile-pane (CSS).
   URL drives selection (`route.id` arrives as `selectedId`).
   List is now an AdminTable with sortable columns + mobile stacked
   cards. Filter pills + search go through AdminFilterBar; sort lives
   in AdminListHeader. */
export function AdminUsers({ selectedId, onSelect, onClearSelection, onViewAs, currentAdminId }) {
  const { t } = useT();
  const { showToast } = useCardigan();
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState("all");
  const [bulkSelected, setBulkSelected] = useState(() => new Set());
  const [bulkPending, setBulkPending] = useState(null); // "block" | "unblock" | "comp" | "uncomp" | "csv" | null
  const { sort: sortKey, setSort: setSortKey } = useAdminSort("users", { key: "name", dir: "asc" });

  const { data: accounts = [], loading, error, refetch } = useAdminQuery("users:all", fetchAllAccounts);

  // Scroll restoration across the mobile list↔detail flip. At <1024px,
  // both panes share `.admin-content`'s scroll context — so entering
  // detail leaks the list's scrollTop into the detail view (and exiting
  // leaks back). Snapshot+restore via useLayoutEffect on selectedId
  // transitions. Desktop (≥1024px) keeps independent scroll on each
  // pane, no capture needed.
  const listScrollRef = useRef(0);
  const prevSelectedRef = useRef(selectedId);
  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    const scrollEl = document.querySelector(".admin-content");
    if (!scrollEl) return;
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      prevSelectedRef.current = selectedId;
      return;
    }
    const prev = prevSelectedRef.current;
    if (!prev && selectedId) {
      // Entering detail from list: capture list scroll, jump detail to top.
      listScrollRef.current = scrollEl.scrollTop;
      scrollEl.scrollTop = 0;
    } else if (prev && !selectedId) {
      // Exiting detail back to list: restore captured scroll.
      scrollEl.scrollTop = listScrollRef.current;
    }
    prevSelectedRef.current = selectedId;
  }, [selectedId]);

  // Right-from-left-edge swipe to pop the detail pane back to the list.
  // Mirrors AdminLayout.jsx's drawer-swipe pattern (EDGE_BAND + ENGAGE_PX
  // + preventDefault on horizontal commit to suppress iOS history-back).
  // Only fires at <1024px and only when there's an active selection.
  const splitRef = useRef(null);
  const selectedIdRef = useRef(selectedId);
  const onClearSelectionRef = useRef(onClearSelection);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { onClearSelectionRef.current = onClearSelection; }, [onClearSelection]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = splitRef.current;
    if (!el) return;
    const EDGE_BAND = 26;
    const ENGAGE_PX = 10;
    const POP_THRESHOLD = 60;
    const isMobile = () => window.innerWidth < 1024;
    let drag = null;

    const onStart = (e) => {
      if (!selectedIdRef.current || !isMobile() || e.touches.length !== 1) { drag = null; return; }
      const t = e.touches[0];
      if (t.clientX > EDGE_BAND) { drag = null; return; }
      drag = { startX: t.clientX, startY: t.clientY, active: false };
    };
    const onMove = (e) => {
      if (!drag) return;
      const t = e.touches[0];
      const dx = t.clientX - drag.startX;
      const dy = t.clientY - drag.startY;
      if (!drag.active) {
        if (Math.abs(dx) > ENGAGE_PX && Math.abs(dx) > Math.abs(dy)) {
          drag.active = true;
        } else if (Math.abs(dy) > ENGAGE_PX) {
          drag = null;
          return;
        }
      }
      // Suppress iOS Safari's history-back peek once we've committed.
      if (drag.active && dx > 0 && e.cancelable) e.preventDefault();
    };
    const onEnd = (e) => {
      const captured = drag;
      drag = null;
      if (!captured || !captured.active) return;
      const t = (e.changedTouches && e.changedTouches[0]) || null;
      if (!t) return;
      const dx = t.clientX - captured.startX;
      if (dx > POP_THRESHOLD) onClearSelectionRef.current?.();
    };

    const opts = { passive: false };
    el.addEventListener("touchstart", onStart, opts);
    el.addEventListener("touchmove", onMove, opts);
    el.addEventListener("touchend", onEnd, opts);
    el.addEventListener("touchcancel", onEnd, opts);
    return () => {
      el.removeEventListener("touchstart", onStart, opts);
      el.removeEventListener("touchmove", onMove, opts);
      el.removeEventListener("touchend", onEnd, opts);
      el.removeEventListener("touchcancel", onEnd, opts);
    };
  }, []);

  const tierFilters = useMemo(() => [
    { k: "all",       l: t("admin.users.filter.all") },
    { k: "therapist", l: t("admin.users.filter.therapist") },
    { k: "patient",   l: t("admin.users.filter.patient") },
    { k: "pro",       l: t("admin.users.filter.pro") },
    { k: "trial",     l: t("admin.users.filter.trial") },
    { k: "comp",      l: t("admin.users.filter.comp") },
    { k: "expired",   l: t("admin.users.filter.expired") },
    { k: "blocked",   l: t("admin.users.filter.blocked") },
  ], [t]);

  const sortOptions = useMemo(() => [
    { value: "name:asc",       label: t("admin.users.sortName") },
    { value: "signup:desc",    label: t("admin.users.sortSignupDesc") },
    { value: "signup:asc",     label: t("admin.users.sortSignupAsc") },
    { value: "patients:desc",  label: t("admin.users.sortPatientsDesc") },
    { value: "patients:asc",   label: t("admin.users.sortPatientsAsc") },
  ], [t]);

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
    const dir = sortKey?.dir === "desc" ? -1 : 1;
    if (sortKey?.key === "signup") {
      rows = rows.slice().sort((a, b) => ((a.firstSeen || "")).localeCompare(b.firstSeen || "") * dir);
    } else if (sortKey?.key === "patients") {
      rows = rows.slice().sort((a, b) => ((a.patientCount || 0) - (b.patientCount || 0)) * dir);
    } else {
      // Default: name asc; respect dir=desc by reversing.
      rows = rows.slice().sort((a, b) => compareNames(a, b) * dir);
    }
    return rows;
  }, [accounts, search, tier, sortKey]);

  const sortDropdownValue = sortKey ? `${sortKey.key}:${sortKey.dir}` : "name:asc";
  const handleSortChange = (v) => {
    const [key, dir] = v.split(":");
    setSortKey({ key, dir });
  };

  // Bulk operations. Run sequentially via Promise.allSettled so a
  // single failure doesn't stall the rest of the batch. Self-protection
  // is handled at the row level via selectionDisabled — admin's own
  // userId is never even checkable.
  const selectedAccounts = useMemo(() => {
    if (bulkSelected.size === 0) return [];
    return accounts.filter((a) => bulkSelected.has(a.userId));
  }, [accounts, bulkSelected]);

  const runBulk = useCallback(async (key, runOne) => {
    if (bulkPending || bulkSelected.size === 0) return;
    setBulkPending(key);
    try {
      const results = await Promise.allSettled(selectedAccounts.map(runOne));
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const fail = results.length - ok;
      if (fail === 0) showToast?.(`Listo · ${ok} cuenta${ok === 1 ? "" : "s"}`, "success");
      else if (ok === 0) showToast?.(`Falló: ${fail} cuenta${fail === 1 ? "" : "s"}`, "error");
      else showToast?.(`${ok} OK · ${fail} con error`, "warning");
      // Drop caches that depend on the changed rows.
      invalidateAdminCache("users:all");
      invalidateAdminCache("audit");
      invalidateAdminCache("overview");
      setBulkSelected(new Set());
      refetch?.();
    } finally {
      setBulkPending(null);
    }
  }, [bulkPending, bulkSelected.size, selectedAccounts, showToast, refetch]);

  const bulkActions = useMemo(() => [
    {
      key: "comp",
      label: "Otorgar comp",
      Icon: IconUserPlus,
      onClick: () => runBulk("comp", (a) => adminGrantComp(a.userId, true)),
    },
    {
      key: "block",
      label: "Bloquear",
      Icon: IconShield,
      danger: true,
      onClick: () => runBulk("block", (a) => adminBlockUser(a.userId, true)),
    },
    {
      key: "unblock",
      label: "Desbloquear",
      Icon: IconCheck,
      onClick: () => runBulk("unblock", (a) => adminBlockUser(a.userId, false)),
    },
    {
      key: "csv",
      label: "Exportar CSV",
      Icon: IconDownload,
      onClick: () => {
        downloadCsv("cardigan-users-selected-{date}.csv", selectedAccounts, [
          { label: t("admin.userDetail.labelName"), get: (a) => a.fullName || "" },
          { label: t("admin.userDetail.labelEmail"), get: (a) => a.email || "" },
          { label: "Tier", get: (a) => a.tier || "" },
          { label: t("admin.users.colPatients"), get: (a) => a.patientCount },
          { label: t("admin.users.colSignup"), get: (a) => a.firstSeen || "" },
          { label: "User ID", get: (a) => a.userId },
        ]);
      },
    },
  ], [runBulk, selectedAccounts, t]);

  const selectionDisabled = useCallback((row) => row.userId === currentAdminId, [currentAdminId]);

  const onExport = () => {
    downloadCsv("cardigan-users-{date}.csv", filtered, [
      { label: t("admin.userDetail.labelName"), get: (a) => a.fullName || "" },
      { label: t("admin.userDetail.labelEmail"), get: (a) => a.email || "" },
      { label: "Tipo", get: (a) => a.accountType || "" },
      { label: t("admin.userDetail.labelProfession"), get: (a) => a.profession || "" },
      { label: "Tier", get: (a) => a.tier || "" },
      { label: t("admin.users.colPatients"), get: (a) => a.patientCount },
      { label: "Bloqueado", get: (a) => a.blocked ? "sí" : "no" },
      { label: t("admin.users.colSignup"), get: (a) => a.firstSeen || "" },
      { label: "User ID", get: (a) => a.userId },
    ]);
  };

  const initialLoading = loading && accounts.length === 0;
  const hasError = !!error && accounts.length === 0;

  const columns = [
    {
      key: "name",
      label: t("admin.users.colName"),
      sortable: true,
      render: (a) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <Avatar initials={initialsFor(a.fullName, a.email)} size="sm" />
          <span style={{
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            maxWidth: 160, fontWeight: 600,
          }}>
            {a.fullName || <span style={{ color: "var(--admin-text-faint)", fontStyle: "italic" }}>{t("admin.noName")}</span>}
          </span>
        </span>
      ),
    },
    {
      key: "email",
      label: t("admin.users.colEmail"),
      render: (a) => (
        <span style={{
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          display: "inline-block", maxWidth: 240, color: "var(--admin-text-meta)",
        }}>
          {a.email || "—"}
        </span>
      ),
    },
    {
      key: "tier",
      label: t("admin.users.colTier"),
      width: 120,
      render: (a) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {a.accountType === "patient"
            ? <AdminBadge tone="info">{t("admin.users.tier.patient")}</AdminBadge>
            : <TierBadge account={a} />}
          {a.blocked && <AdminBadge tone="danger">Bloqueado</AdminBadge>}
        </span>
      ),
    },
    {
      key: "patients",
      label: t("admin.users.colPatients"),
      align: "right",
      sortable: true,
      width: 90,
      render: (a) => (a.accountType === "patient" ? "—" : (a.patientCount ?? 0)),
    },
    {
      key: "signup",
      label: t("admin.users.colSignup"),
      sortable: true,
      width: 110,
      render: (a) => fmtDate(a.firstSeen),
    },
  ];

  const mobileLayout = (a) => ({
    primary: a.fullName || a.email || t("admin.noName"),
    secondary: a.email,
    meta: [
      a.profession ? <span key="p">{t(`onboarding.professions.${a.profession}.label`)}</span> : null,
      a.accountType !== "patient" ? <span key="c">{a.patientCount ?? 0} {(a.patientCount === 1) ? "paciente" : "pacientes"}</span> : null,
      <span key="d">alta {fmtDate(a.firstSeen)}</span>,
    ].filter(Boolean),
    badges: (
      <>
        {a.accountType === "patient"
          ? <AdminBadge tone="info">{t("admin.users.tier.patient")}</AdminBadge>
          : <TierBadge account={a} />}
        {a.blocked && <AdminBadge tone="danger">Bloqueado</AdminBadge>}
      </>
    ),
  });

  const handleSortByColumn = (next) => {
    if (!next) {
      setSortKey({ key: "name", dir: "asc" });
      return;
    }
    setSortKey(next);
  };

  const mobilePane = selectedId ? "detail" : "list";

  return (
    <AdminPage
      title={t("admin.users.title")}
      subtitle={t("admin.users.subtitle")}
      actions={(
        <button
          type="button"
          onClick={onExport}
          className="admin-filter-pill"
          style={{ background: "var(--admin-accent-soft)", borderColor: "var(--admin-accent)", color: "var(--admin-accent)" }}
        >
          <IconDownload size={13} /> CSV
        </button>
      )}
    >
      <div className="admin-split-view" data-mobile-pane={mobilePane} ref={splitRef}>
        {/* List pane */}
        <div className="admin-split-view-list">
          <AdminListHeader
            title={t("admin.users.title")}
            totalCount={accounts.length}
            resultCount={filtered.length}
            sort={{
              value: sortDropdownValue,
              onChange: handleSortChange,
              options: sortOptions,
              ariaLabel: t("admin.ui.sortBy"),
            }}
          />
          <AdminFilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder={t("admin.users.searchPlaceholder")}
            pills={tierFilters.map((tf) => ({
              key: tf.k,
              label: tf.l,
              active: tier === tf.k,
              onClick: () => setTier(tf.k),
            }))}
            facets={[
              {
                key: "tier",
                label: "Tier",
                options: tierFilters.map((tf) => ({
                  key: tf.k,
                  label: tf.l,
                  active: tier === tf.k,
                  apply: () => setTier(tf.k),
                })),
              },
              {
                key: "sort",
                label: "Ordenar",
                options: sortOptions.map((opt) => ({
                  key: opt.value,
                  label: opt.label,
                  active: sortDropdownValue === opt.value,
                  apply: () => handleSortChange(opt.value),
                })),
              },
            ]}
          >
            <AdminSavedViews
              screen="users"
              currentState={{
                search,
                tier,
                sort: sortKey,
              }}
              onApply={(state) => {
                if (state?.search !== undefined) setSearch(state.search || "");
                if (state?.tier !== undefined) setTier(state.tier || "all");
                if (state?.sort) setSortKey(state.sort);
                setBulkSelected(new Set());
              }}
            />
          </AdminFilterBar>
          {hasError ? (
            <AdminEmpty title={t("admin.ui.error")} body={String(error)} />
          ) : (
            <AdminTable
              columns={columns}
              rows={filtered}
              rowKey={(a) => a.userId}
              sort={sortKey}
              onSortChange={handleSortByColumn}
              onRowClick={(a) => onSelect?.(a.userId)}
              selectedRowKey={selectedId}
              loading={initialLoading}
              skeletonRows={10}
              empty={(
                <AdminEmpty
                  title={accounts.length === 0 ? t("admin.users.empty") : t("admin.users.noResults")}
                  body={accounts.length === 0 ? t("admin.users.emptyBody") : t("admin.users.noResultsBody")}
                />
              )}
              mobileLayout={mobileLayout}
              ariaLabel={t("admin.users.title")}
              selectable
              selectedKeys={bulkSelected}
              onSelectionChange={setBulkSelected}
              selectionDisabled={selectionDisabled}
            />
          )}
          <AdminBulkBar
            count={bulkSelected.size}
            actions={bulkActions}
            pendingKey={bulkPending}
            onClear={() => setBulkSelected(new Set())}
          />
        </div>

        {/* Detail pane */}
        <div className="admin-split-view-detail">
          {selectedId ? (
            <>
              {/* Mobile-only back button (rendered, hidden via CSS at ≥1024px) */}
              <button
                type="button"
                onClick={() => onClearSelection?.()}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: "none", border: "none", padding: "4px 0",
                  color: "var(--admin-text-meta)", fontSize: 12.5, fontWeight: 600,
                  cursor: "pointer", marginBottom: 8,
                }}
                className="admin-split-view-back"
                aria-label={t("admin.ui.back")}
              >
                <IconArrowLeft size={14} /> {t("admin.ui.back")}
              </button>
              <AdminUserDetail
                uid={selectedId}
                onViewAs={onViewAs}
                onBack={() => onClearSelection?.()}
                currentAdminId={currentAdminId}
                embedded
              />
            </>
          ) : (
            <div className="admin-split-view-empty">
              <div style={{ fontWeight: 700, color: "var(--admin-text-meta)", marginBottom: 4 }}>
                {t("admin.users.detailEmpty")}
              </div>
              <div>{t("admin.users.detailEmptyBody")}</div>
            </div>
          )}
        </div>
      </div>
    </AdminPage>
  );
}
