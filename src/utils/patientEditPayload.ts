/* ── Patient edit-save payload (WS-6 / Prime Directive #6) ────────────
   Patients.tsx::saveEdit writes the SAME updatePatient payload from three
   branches (finalize / schedule-change / basic-info), differing only in
   whether `status` and `rate` are included. The shared body — including the
   WhatsApp opt-in + LFPDPPP consent-timestamp rule and the tutor-frequency /
   contact normalization — is built here once so the three call sites can't
   drift, and the consent rule has a single tested home.

   `whatsapp_consent_at` is stamped to `nowIso` (passed in, not read from the
   clock here) the first time WhatsApp is enabled with a phone, and preserved
   if already set; cleared to null whenever WhatsApp is off or no phone. */

import { phoneDigits } from "./contact";

export interface PatientEditForm {
  name: string;
  isMinor: boolean;
  parent: string;
  tutorFrequency: string;
  phone: string;
  email: string;
  birthdate: string;
  startDate: string;
  status: string;
  rate: string;
  /** Already-signed opening balance (see signedOpeningBalance). */
  openingBalance: number;
  whatsappEnabled: boolean;
  whatsappConsentAt: string | null;
}

/* A `type` (not `interface`) on purpose: TypeScript gives an object-literal
   type alias an implicit string index signature, so the payload stays
   assignable to `updatePatient`'s `Record<string, unknown>` parameter without
   a cast — while keeping every field exactly typed for the tests. */
export type PatientEditPayload = {
  name: string;
  parent: string;
  tutor_frequency: number | null;
  phone: string;
  email: string;
  birthdate: string | null;
  start_date: string | null;
  opening_balance: number;
  whatsapp_enabled: boolean;
  whatsapp_consent_at: string | null;
  status?: string;
  rate?: number;
};

export function buildPatientEditPayload(
  f: PatientEditForm,
  nowIso: string,
  opts: { includeStatus?: boolean; includeRate?: boolean } = {},
): PatientEditPayload {
  const hasWhatsapp = !!f.whatsappEnabled && !!phoneDigits(f.phone);
  const payload: PatientEditPayload = {
    name: f.name.trim(),
    parent: f.isMinor ? f.parent.trim() : "",
    tutor_frequency: f.isMinor && f.tutorFrequency ? Number(f.tutorFrequency) : null,
    phone: phoneDigits(f.phone),
    email: f.email.trim(),
    birthdate: f.birthdate || null,
    start_date: f.startDate || null,
    opening_balance: f.openingBalance,
    whatsapp_enabled: hasWhatsapp,
    whatsapp_consent_at: hasWhatsapp ? (f.whatsappConsentAt || nowIso) : null,
  };
  if (opts.includeStatus) payload.status = f.status;
  if (opts.includeRate) payload.rate = Number(f.rate) || 0;
  return payload;
}
