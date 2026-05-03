import { supabase } from "../supabaseClient";

/* CRUD actions for the `measurements` table — anthropometric data
   (weight, waist, hip, body fat) tracked per visit by nutritionists +
   trainers. Mirrors the shape of usePatients / useSessions / etc. so
   useCardiganData can splat it into the same provider value.

   Read path lives in useCardiganData (single fetch alongside the rest
   of the row sets). Reads are gated by usesAnthropometrics(profession)
   in the caller — other professions never trigger a fetch. */
export function createMeasurementActions(userId, measurements, setMeasurements, setMutating, setMutationError) {

  /* Insert a new measurement. `taken_at` is required (the date the
     measurement was taken — defaults to today client-side); every
     numeric field is optional so a partial entry is allowed. */
  async function createMeasurement({ patientId, takenAt, weightKg, waistCm, hipCm, bodyFatPct, notes }) {
    if (!patientId || !takenAt) return false;
    setMutating(true);
    setMutationError("");
    const { data, error } = await supabase.from("measurements").insert({
      user_id: userId,
      patient_id: patientId,
      taken_at: takenAt,
      // null when the user left the field blank — we never want a
      // false zero in the time series, since "0 kg" would skew charts.
      weight_kg:    weightKg    === "" || weightKg    == null ? null : Number(weightKg),
      waist_cm:     waistCm     === "" || waistCm     == null ? null : Number(waistCm),
      hip_cm:       hipCm       === "" || hipCm       == null ? null : Number(hipCm),
      body_fat_pct: bodyFatPct  === "" || bodyFatPct  == null ? null : Number(bodyFatPct),
      notes:        (notes || "").trim(),
    }).select().single();
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setMeasurements(prev => [data, ...prev]);
    return data;
  }

  async function updateMeasurement(id, updates) {
    setMutating(true);
    setMutationError("");
    const patch = { ...updates };
    // Mirror createMeasurement's "blank → null" rule so an edit that
    // clears a field actually writes null instead of NaN.
    for (const k of ["weight_kg", "waist_cm", "hip_cm", "body_fat_pct"]) {
      if (k in patch && (patch[k] === "" || patch[k] == null)) patch[k] = null;
      else if (k in patch) patch[k] = Number(patch[k]);
    }
    const { data, error } = await supabase.from("measurements")
      .update(patch).eq("id", id).eq("user_id", userId).select().single();
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setMeasurements(prev => prev.map(m => m.id === id ? data : m));
    return true;
  }

  /* Bulk insert from an InBody / LookinBody CSV import. Each `row` is
     already mapped to the canonical `measurements` column names by
     src/utils/inbody.js — we just stamp user_id + patient_id + source
     and write. The partial unique index on
     (patient_id, scanned_at, source) makes a re-import idempotent at
     the DB level; we additionally pre-filter against local state so
     the "ya importada" preview lines up with what actually gets
     written.

     Returns { created, skipped }. `skipped` covers both pre-filtered
     duplicates and any DB-side conflicts the unique index catches —
     a generic count is enough for the toast, the user can re-open
     the import sheet to see the row-level breakdown if they care. */
  async function bulkCreateMeasurements({ patientId, rows }) {
    if (!patientId || !Array.isArray(rows) || rows.length === 0) {
      return { created: 0, skipped: 0 };
    }
    // Canonicalize timestamps before comparing — Supabase returns
    // timestamptz as `+00:00` and the parser emits `…Z`; same instant,
    // different strings. Date round-trip normalizes both.
    const canon = (s) => {
      if (!s) return null;
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    };
    const existingScans = new Set(
      (measurements || [])
        .filter((m) => m.patient_id === patientId && m.scanned_at)
        .map((m) => canon(m.scanned_at))
        .filter(Boolean),
    );
    const fresh = rows.filter((r) => {
      const iso = canon(r.scanned_at);
      return iso && !existingScans.has(iso);
    });
    const skippedLocal = rows.length - fresh.length;
    if (fresh.length === 0) return { created: 0, skipped: skippedLocal };

    const payload = fresh.map((r) => {
      const { _name, _matchesPatient, ...clean } = r; // strip preview-only fields
      return {
        user_id: userId,
        patient_id: patientId,
        source: "inbody_csv",
        // taken_at is the stable date label used by the rest of the
        // UI (sparkline x-axis, list grouping). Derive it from the
        // exact scanned_at so the two stay aligned.
        taken_at: clean.scanned_at.slice(0, 10),
        ...clean,
      };
    });

    setMutating(true);
    setMutationError("");
    const { data, error } = await supabase
      .from("measurements")
      .insert(payload)
      .select();
    setMutating(false);
    if (error) {
      setMutationError(error.message);
      return { created: 0, skipped: rows.length };
    }
    setMeasurements((prev) => [...(data || []), ...prev]);
    const created = data?.length || 0;
    return { created, skipped: skippedLocal + (fresh.length - created) };
  }

  async function deleteMeasurement(id) {
    setMutating(true);
    setMutationError("");
    const { error } = await supabase.from("measurements")
      .delete().eq("id", id).eq("user_id", userId);
    setMutating(false);
    if (error) { setMutationError(error.message); return false; }
    setMeasurements(prev => prev.filter(m => m.id !== id));
    return true;
  }

  return { createMeasurement, updateMeasurement, deleteMeasurement, bulkCreateMeasurements };
}
