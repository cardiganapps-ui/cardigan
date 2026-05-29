import { generateDemoData } from "../data/demoData";
import { enrichPatientsWithBalance } from "../utils/accounting";
import { DEFAULT_PROFESSION } from "../data/constants";

/* ── getDemoPatientPortalSnapshot ───────────────────────────────────
   Read-only mirror of usePatientPortalData()'s return shape for the
   e2e patient-portal smoke test. Derives a single-patient view from
   the same generateDemoData() the therapist demo uses, so the shape
   stays in lockstep with real data without duplicating fixtures.

   The therapist demo seeds ~10 patients; we pick the first active
   one and present everything from that patient's perspective:
   their own sessions, their own balance, their therapist's profile.

   Production NEVER calls this — only the testMode + ?demoRole=patient
   escape hatch in App.jsx routes here. Mutations don't exist on the
   patient surface, so there's nothing to no-op.

   Exposed as a PLAIN function (not a hook): generateDemoData() takes
   ~10ms-100ms depending on device, and we don't want every real
   patient login paying that cost on the first PatientApp mount.
   Calling conditionally from PatientApp keeps the cost in the demo
   branch only. The snapshot itself is lazy-computed + module-level
   memoized so repeated calls within a session are free. */

// Declared above the lazy compute so the early-return branch can
// reference it without hitting the temporal dead zone (the same TDZ
// class that crashed NoteEditor earlier this session).
const EMPTY = Object.freeze({
  loading: false,
  error: null,
  patients: [],
  sessions: [],
  therapists: [],
  primaryTherapist: null,
  primaryPatient: null,
  totalAmountDue: 0,
  totalCredit: 0,
  rescheduleRequests: [],
  refresh: () => {},
});

let cachedSnapshot = null;

function computeSnapshot() {
  const seed = generateDemoData(DEFAULT_PROFESSION);
  const activePatient = seed.patients.find(p => p.status === "active") || seed.patients[0];
  if (!activePatient) return EMPTY;

  const ownSessions = seed.sessions.filter(s => s.patient_id === activePatient.id);
  const enriched = enrichPatientsWithBalance([activePatient], ownSessions, undefined, "America/Mexico_City");
  const primaryPatient = enriched[0];

  // Synthetic therapist profile — production reads this from a
  // patient_therapists join. The patient portal only renders the
  // therapist's display name + profession, so a flat object covers it.
  const primaryTherapist = {
    therapist_id: "demo-therapist",
    therapist_full_name: "Dra. Sofía Ramírez",
    therapist_profession: DEFAULT_PROFESSION,
    therapist_avatar: null,
  };

  return {
    loading: false,
    error: null,
    patients: enriched,
    sessions: ownSessions,
    therapists: [primaryTherapist],
    primaryTherapist,
    primaryPatient,
    totalAmountDue: Math.max(0, primaryPatient?.amountDue || 0),
    totalCredit: Math.max(0, primaryPatient?.credit || 0),
    rescheduleRequests: [],
    refresh: () => {},
  };
}

export function getDemoPatientPortalSnapshot() {
  if (cachedSnapshot === null) cachedSnapshot = computeSnapshot();
  return cachedSnapshot;
}
