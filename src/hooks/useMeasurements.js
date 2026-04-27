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

  return { createMeasurement, updateMeasurement, deleteMeasurement };
}
