/* ── Patient-list filter + sort (extracted from Patients.tsx, WS-6) ────
   The Pacientes screen filters its roster by a search box + a lane chip
   (Con deuda / Al día / Activos / Finalizados / Potenciales), with the
   Potenciales lane switching on an Activos/Archivados sub-filter. This is
   the pure logic behind that — no React, no data layer — so it's unit-
   tested directly (the screen itself is hard to test under the data hooks). */

import { PATIENT_STATUS, isPotentialOrDiscarded } from "../data/constants";

/** The minimal patient shape the list filter reads. */
export interface FilterablePatient {
  name: string;
  status?: string | null;
  amountDue?: number;
}

export interface PatientFilterCriteria {
  /** Free-text search matched as a case-insensitive substring of `name`. */
  search: string;
  /** Active lane chip: 'all' | 'owes' | 'paid' | 'active' | 'ended' | 'potential'. */
  filter: string;
  /** Sub-filter when filter === 'potential': 'active' | 'archived'. */
  potentialSubFilter: string;
  /** Roster order: 'name' (default — active first, then alphabetical)
      or 'debt' (largest amountDue first; the "who owes me" view). */
  sort?: string;
}

/**
 * Lane predicate. Every non-potential lane explicitly excludes potentials /
 * discarded — they never appear in the regular lanes. The 'potential' lane
 * switches to its sub-filter (Activos vs. Archivados/discarded).
 */
export function patientMatchesLane(
  p: FilterablePatient,
  filter: string,
  potentialSubFilter: string,
): boolean {
  if (filter === "potential") {
    if (potentialSubFilter === "archived") return p.status === PATIENT_STATUS.DISCARDED;
    return p.status === PATIENT_STATUS.POTENTIAL;
  }
  if (isPotentialOrDiscarded(p)) return false;
  if (filter === "active") return p.status === "active";
  if (filter === "ended")  return p.status === "ended";
  if (filter === "owes")   return (p.amountDue ?? 0) > 0;
  if (filter === "paid")   return (p.amountDue ?? 0) <= 0;
  return true;
}

/** Default sort: active patients first, then alphabetical by name. */
export function comparePatients(a: FilterablePatient, b: FilterablePatient): number {
  if (a.status !== b.status) {
    if (a.status === "active") return -1;
    if (b.status === "active") return 1;
  }
  return a.name.localeCompare(b.name);
}

/** Debt sort: largest amountDue first regardless of status (an ended
    patient who still owes matters more than an active one at zero),
    name as the tiebreak so the order is stable. */
export function comparePatientsByDebt(a: FilterablePatient, b: FilterablePatient): number {
  const diff = (b.amountDue ?? 0) - (a.amountDue ?? 0);
  if (diff !== 0) return diff;
  return a.name.localeCompare(b.name);
}

/** Apply search + lane filter + the selected sort to a patient roster. */
export function filterPatients<T extends FilterablePatient>(
  patients: T[],
  { search, filter, potentialSubFilter, sort }: PatientFilterCriteria,
): T[] {
  const q = search.toLowerCase();
  return patients
    .filter(p => p.name.toLowerCase().includes(q) && patientMatchesLane(p, filter, potentialSubFilter))
    .sort(sort === "debt" ? comparePatientsByDebt : comparePatients);
}
