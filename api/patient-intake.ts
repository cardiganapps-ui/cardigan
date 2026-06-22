/* ── POST /api/patient-intake ─────────────────────────────────────
   Patient submits their intake form. Updates a SAFE SUBSET of the
   patients row server-side (the columns the therapist's intake
   would normally touch) and stamps patient_intake_completed_at.

   Why service-role (vs. an UPDATE RLS policy)? Two reasons:
     1. RLS is row-level, not column-level. The patient should be
        able to set `allergies` but never their own `rate` or
        `billed`. A service-role endpoint that explicitly whitelists
        the writable columns is the safest bottleneck.
     2. The endpoint can apply business rules (e.g., reject empty
        intakes, normalize numbers) without scattering them across
        policies.

   Body (all optional except patient_id; profession-specific fields
   ignored when not applicable):
     {
       patient_id: string,
       birthdate?: ISO date string,
       allergies?: string,
       medical_conditions?: string,
       height_cm?: number,
       goal_weight_kg?: number,
       goal_body_fat_pct?: number,
       goal_skeletal_muscle_kg?: number,
       consent: true   // explicit privacy-notice acceptance, required
     }

   Response:
     200 { ok: true, completed_at }
     400 — bad input
     401 — not signed in
     403 — patient_id forge
     409 — already completed (idempotency: re-submitting still
            updates the columns but keeps the original timestamp) */

import { createClient } from "@supabase/supabase-js";
import { getAuthUser, getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";
import { rateLimit } from "./_ratelimit.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const MAX_TEXT_LEN = 2000;

function clampText(v: Row) {
  if (v == null) return null;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_TEXT_LEN);
}

function clampNumber(v: Row, { min = 0, max = 1000 }: Row = {}) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

function clampDate(v: Row) {
  if (!v) return null;
  if (typeof v !== "string") return null;
  // Expect ISO yyyy-mm-dd. The patients table column is `date`.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  // Sanity range: 1900 – today. A patient's birthdate isn't in the
  // future and isn't in the 19th century either.
  const t = Date.parse(v + "T12:00:00Z");
  if (!Number.isFinite(t)) return null;
  if (t < Date.parse("1900-01-01")) return null;
  if (t > Date.now() + 86_400_000) return null;
  return v;
}

async function handler(req: Row, res: Row) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  // Per-patient limiter — intake submission updates the patients row.
  // 20 in 60s comfortably covers a patient revising fields and
  // re-submitting while capping automated abuse.
  const rl = await rateLimit({
    endpoint: "patient-intake",
    bucket: user.id,
    max: 20,
    windowSec: 60,
  });
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfter));
    return res.status(429).json({ error: "Demasiados intentos. Espera un minuto." });
  }

  const body = req.body || {};
  if (typeof body.patient_id !== "string" || !body.patient_id) {
    return res.status(400).json({ error: "Invalid patient_id" });
  }
  if (body.consent !== true) {
    // Explicit consent flag — without it we don't write. The UI
    // should disable the submit until the checkbox is ticked, but
    // we also gate server-side so a manual API call can't bypass.
    return res.status(400).json({ error: "Consent required" });
  }

  // Build the safe column subset. Only fields the patient is
  // allowed to set ever land here. Anything not in this whitelist
  // is dropped silently.
  const updates = {
    birthdate: clampDate(body.birthdate),
    allergies: clampText(body.allergies),
    medical_conditions: clampText(body.medical_conditions),
    height_cm: clampNumber(body.height_cm, { min: 50, max: 250 }),
    goal_weight_kg: clampNumber(body.goal_weight_kg, { min: 20, max: 400 }),
    goal_body_fat_pct: clampNumber(body.goal_body_fat_pct, { min: 1, max: 70 }),
    goal_skeletal_muscle_kg: clampNumber(body.goal_skeletal_muscle_kg, { min: 5, max: 150 }),
    patient_intake_completed_at: new Date().toISOString(),
  };

  // Drop nulls so we don't overwrite existing therapist-entered data
  // with empty values. The patient might leave a field blank
  // intentionally; we treat that as "no change" rather than
  // "clear what's there." Exception: completed_at is always
  // stamped.
  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([k, v]: Row) => v != null || k === "patient_intake_completed_at")
  );

  // Verify patient ownership via the user-JWT'd client. RLS
  // gates the SELECT to rows where patient_user_id = auth.uid()
  // AND status IN active/potential. Forged patient_id 403's
  // cleanly without leaking existence.
  const userClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: req.headers.authorization } },
    }
  );
  const { data: patient, error: pErr } = await userClient
    .from("patients")
    .select("id, patient_intake_completed_at")
    .eq("id", body.patient_id)
    .maybeSingle();
  if (pErr) return res.status(500).json({ error: pErr.message });
  if (!patient) return res.status(403).json({ error: "Forbidden" });

  // Idempotency: if intake was already completed, don't re-stamp
  // the timestamp (keeps the original "first completed" record).
  // Other fields still update — patient might be revising a value.
  if (patient.patient_intake_completed_at) {
    delete cleanUpdates.patient_intake_completed_at;
  }

  const svc = getServiceClient();
  const { error: updErr } = await svc
    .from("patients")
    .update(cleanUpdates)
    .eq("id", body.patient_id);
  if (updErr) return res.status(500).json({ error: updErr.message });

  return res.status(200).json({
    ok: true,
    completed_at: patient.patient_intake_completed_at || cleanUpdates.patient_intake_completed_at,
  });
}

export default withSentry(handler, { name: "patient-intake" });
