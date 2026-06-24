import React, { type Dispatch, type SetStateAction } from "react";
import { IconSearch, IconPlus } from "../../components/Icons";
import { EmptyState } from "../../components/EmptyState";
import { PatientRow } from "./PatientRow";
import { PATIENT_STATUS } from "../../data/constants";

// Loosely-typed patient rows flow through the Cardigan data layer.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migration bridge for loosely-typed rows
type Row = any;

/* ── PatientListView ──
   The Pacientes list pane: search box, lane filter chips, the Potenciales
   Activos/Archivados sub-filter, the count + "Nuevo potencial" CTA, and the
   roster card (empty states + the PatientRow rows). Extracted verbatim from
   Patients.tsx's `listJSX` (WS-6) so the screen shell shrinks and the list
   is an independently-testable presentational unit. All state + handlers
   stay owned by Patients and flow in as props; the per-row interaction
   wiring (swipe / context-menu / interview-lane click) is unchanged. */
export type PatientListViewProps = {
  search: string;
  setSearch: (v: string) => void;
  filter: string;
  setFilter: Dispatch<SetStateAction<string>>;
  filters: Array<{ k: string; l: string; badge?: number }>;
  isPotentialView: boolean;
  potentialSubFilter: string;
  setPotentialSubFilter: (v: string) => void;
  filtered: Row[];
  splitMode: boolean;
  expediente: Row | null;
  readOnly: boolean;
  requestFabAction?: (key: string) => void;
  openDetail: (p: Row) => void;
  setPotentialProfile: (p: Row) => void;
  openPatientContextMenu: (x: number, y: number, p: Row, e?: Row) => void;
  openRecordPaymentModal: (p: Row) => void;
  t: (key: string, ...args: Row[]) => string;
};

export function PatientListView({
  search, setSearch, filter, setFilter, filters, isPotentialView,
  potentialSubFilter, setPotentialSubFilter, filtered, splitMode, expediente,
  readOnly, requestFabAction, openDetail, setPotentialProfile,
  openPatientContextMenu, openRecordPaymentModal, t,
}: PatientListViewProps) {
  return (
    <>
      <div style={{ padding:"16px 16px 10px" }}>
        <div className="search-bar">
          <span style={{ color:"var(--charcoal-xl)" }}><IconSearch size={16} /></span>
          {/* Search placeholder follows the active lane — "Buscar
              paciente…" on the regular views, "Buscar potencial…"
              when Potenciales is active. Cheap polish that signals
              the mode shift without an extra title bar. */}
          <input
            type="search"
            aria-label={t("patients.searchPlaceholder")}
            placeholder={isPotentialView
              ? `Buscar ${t("patients.statusPotential").toLowerCase()}…`
              : t("patients.searchPlaceholder")}
            value={search}
            onChange={e => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="filter-chips">
        {filters.map(f => (
          <button key={f.k}
            className={`chip ${filter===f.k?"active":""}`}
            onClick={() => setFilter(prev => prev === f.k ? "all" : f.k)}>
            {f.l}
            {/* Show a non-zero count next to "Potenciales" so the
                practitioner sees pending interviews at a glance
                without having to enter the lane. Tight padding so
                the chip doesn't blow the row past iPhone width. */}
            {f.k === "potential" && (f.badge ?? 0) > 0 && (
              <span style={{ marginLeft:4, padding:"0 4px", borderRadius:"var(--radius-pill)", background:"var(--rose)", color:"var(--white)", fontSize:9, fontWeight:800 }}>{f.badge}</span>
            )}
          </button>
        ))}
      </div>
      {/* Potenciales sub-filter — Activos / Archivados. Only renders
          while the Potenciales chip is active so the row doesn't
          confuse the regular-patient lanes. Right-aligned + rose-
          accented active state so the visual signals "this is a
          sub-filter inside the Potenciales lane" rather than
          competing with the primary teal filters above. */}
      {isPotentialView && (
        <div className="filter-chips filter-chips--rose" style={{ paddingTop:0 }}>
          <button className={`chip ${potentialSubFilter==="active"?"active":""}`}
            onClick={() => setPotentialSubFilter("active")}>
            {t("patients.onlyActive")}
          </button>
          <button className={`chip ${potentialSubFilter==="archived"?"active":""}`}
            onClick={() => setPotentialSubFilter("archived")}>
            {t("patients.archived")}
          </button>
        </div>
      )}
      <div className="sort-row" style={isPotentialView && potentialSubFilter === "active" && !readOnly ? { display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 } : undefined}>
        <span style={{ fontSize:12, color:"var(--charcoal-xl)", fontWeight:600 }}>{t("patients.count", { count: filtered.length })}</span>
        {/* "Nuevo potencial" CTA — bordered rose pill that reads as
            the lane's primary action without crowding the global
            FAB. Hidden under the Archivados sub-filter (no point
            adding new ones from there) and in readOnly demo mode. */}
        {isPotentialView && potentialSubFilter === "active" && !readOnly && (
          <button type="button"
            onClick={() => requestFabAction?.("potential")}
            aria-label={t("patients.newPotential")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 11px 5px 9px",
              borderRadius: "var(--radius-pill)",
              border: "1px solid var(--rose)",
              background: "var(--rose-bg)",
              color: "var(--rose)",
              fontSize: 11,
              fontWeight: 700,
              fontFamily: "var(--font)",
              cursor: "pointer",
              letterSpacing: 0.2,
              WebkitTapHighlightColor: "transparent",
              transition: "transform 0.18s var(--ease-cardi, ease), background 0.18s ease",
            }}
            onMouseDown={e => { e.currentTarget.style.transform = "scale(0.97)"; }}
            onMouseUp={e => { e.currentTarget.style.transform = ""; }}
            onMouseLeave={e => { e.currentTarget.style.transform = ""; }}>
            <IconPlus size={12} strokeWidth={2.4} /> {t("patients.newPotential")}
          </button>
        )}
      </div>
      <div style={{ padding:"0 16px 12px" }}>
        <div className="card">
          {filtered.length === 0
            ? (search || !isPotentialView ? (
                /* Search miss in any lane, or "no results" in the
                   regular lanes — terse one-liner inside the card so
                   it doesn't dominate the layout. */
                <div style={{ padding:"28px 16px", textAlign:"center", color:"var(--charcoal-xl)", fontSize:13 }}>
                  {t("patients.noResults")}
                </div>
              ) : (
                /* Cold-start in the Potenciales lane gets the full
                    EmptyState treatment — illustration, title, body,
                    inline CTA. Same polish as the other empty surfaces
                    (Notes, Documents, Mediciones) so the lane reads
                    as a first-class part of the app rather than a
                    bolted-on filter. */
                <div style={{ padding:"6px 8px 12px" }}>
                  <EmptyState
                    kind={potentialSubFilter === "archived" ? "patients" : "potentials"}
                    compact
                    title={potentialSubFilter === "archived"
                      ? t("patients.noArchived")
                      : t("patients.noPotentials")}
                    body={potentialSubFilter === "archived"
                      ? null
                      : t("patients.addPotentialFirst")}
                    cta={potentialSubFilter === "active" && !readOnly && (
                      <button
                        type="button"
                        onClick={() => requestFabAction?.("potential")}
                        className="btn"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          width: "auto",
                          padding: "10px 22px",
                          height: "auto",
                          minHeight: 0,
                          background: "var(--rose)",
                          color: "var(--white)",
                          boxShadow: "none",
                        }}>
                        <IconPlus size={16} /> {t("patients.newPotential")}
                      </button>
                    )}
                  />
                </div>
              ))
            : filtered.map((p: Row, i: number) => {
              const isPotential = p.status === PATIENT_STATUS.POTENTIAL;
              const isDiscarded = p.status === PATIENT_STATUS.DISCARDED;
              const isInterviewLane = isPotential || isDiscarded;
              // Swipe-reveal enabled only for active patients in the
              // main lane. Interview lane (potential/discarded) and
              // the "owes" filter view stay tap-only — the latter
              // because that view's primary affordance is the chevron
              // showing balance owed, and swipe overlay would clash
              // visually with the red amount.
              const swipeEnabled = !readOnly && !isInterviewLane && p.status === PATIENT_STATUS.ACTIVE;
              const rowClick = isInterviewLane ? () => setPotentialProfile(p) : () => openDetail(p);
              return (
                <PatientRow
                  key={p.id}
                  p={p}
                  i={i}
                  swipeEnabled={swipeEnabled}
                  isInterviewLane={isInterviewLane}
                  isPotential={isPotential}
                  isDiscarded={isDiscarded}
                  filter={filter}
                  splitMode={splitMode}
                  expediente={expediente}
                  rowClick={rowClick}
                  openCtxMenu={isInterviewLane ? null : openPatientContextMenu}
                  onPay={openRecordPaymentModal}
                  t={t}
                />
              );
            })
          }
        </div>
      </div>
    </>
  );
}
