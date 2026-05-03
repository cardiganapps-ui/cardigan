-- InBody body-composition fields on `measurements` + extra goal columns
-- on `patients`. Both feed the nutritionist polish round: a
-- nutritionist can now import a LookinBody CSV/Excel export and the
-- 8+ richer fields per scan (skeletal muscle, visceral fat level,
-- phase angle, BMR, …) are tracked alongside the manual weight/waist
-- entries that already work today.
--
-- The `measurements` table is extended in place rather than introducing
-- a sibling table: the existing sparkline + Δ logic in
-- screens/expediente/MedicionesTab.jsx is keyed on (patient_id,
-- taken_at), and a sibling table would force a join that adds nothing
-- conceptually — an InBody scan IS a measurement, just with more
-- dimensions. `source` discriminates manual entries from imports;
-- the partial unique index keeps re-imports of the same scan
-- idempotent without constraining manual rows (which have no
-- scanned_at).

alter table measurements
  add column if not exists source text not null default 'manual'
    check (source in ('manual','inbody_csv','inbody_api')),
  add column if not exists scanned_at                 timestamptz,
  add column if not exists device_model               text,
  add column if not exists skeletal_muscle_kg         numeric(5,2),
  add column if not exists body_fat_kg                numeric(5,2),
  add column if not exists visceral_fat_level         integer,
  add column if not exists total_body_water_kg        numeric(5,2),
  add column if not exists protein_kg                 numeric(5,2),
  add column if not exists minerals_kg                numeric(5,2),
  add column if not exists basal_metabolic_rate_kcal  integer,
  add column if not exists phase_angle                numeric(4,2),
  add column if not exists inbody_score               integer,
  add column if not exists raw_extra                  jsonb;

-- Idempotent re-import: the same InBody scan (same scanned_at, same
-- patient, same source) can land at most once. Partial so manual
-- entries (scanned_at IS NULL) aren't constrained — a nutritionist
-- can still record two manual measurements on the same date if they
-- want a morning + afternoon reading.
create unique index if not exists uniq_measurements_scan
  on measurements (patient_id, scanned_at, source)
  where scanned_at is not null;

-- Body-comp goals beyond just goal_weight_kg. A nutritionist might
-- target "drop body fat 4%" or "gain 2kg of muscle"; surfacing these
-- in the headline alongside the weight goal turns Mediciones into a
-- proper progress dashboard instead of a weight-only tracker.
alter table patients
  add column if not exists goal_body_fat_pct       numeric(4,2),
  add column if not exists goal_skeletal_muscle_kg numeric(5,2);
