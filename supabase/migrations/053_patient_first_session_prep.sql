-- Patient-side "first session prep" — documents + intake form
--
-- Two coordinated additions, one migration:
--
-- 1. documents.uploaded_by_user_id (nullable uuid)
--    Tracks WHO uploaded each document. Existing therapist uploads
--    leave it null (or stamped with the therapist's id at upload-
--    time going forward). Patient uploads stamp it with the
--    patient's auth.users.id.
--    Used by:
--      - Patient RLS policies below (patient SELECT/INSERT/DELETE
--        gated on uploaded_by_user_id = auth.uid()) so the patient
--        sees their OWN uploads but never the therapist's private
--        documents.
--      - Therapist UI to render a "Subido por paciente" hint.
--
-- 2. patients.patient_intake_completed_at (nullable timestamptz)
--    Tracks when the patient self-served their intake. NULL means
--    "intake card still showing on the patient home." Set the
--    moment POST /api/patient-intake succeeds.

alter table documents
  add column if not exists uploaded_by_user_id uuid
    references auth.users(id) on delete set null;

create index if not exists idx_documents_uploaded_by
  on documents(uploaded_by_user_id) where uploaded_by_user_id is not null;

-- Patient RLS — SELECT only their own uploads, on patient rows
-- they own AND that are still active. Therapist's private docs
-- never leak. Patient is gated by patient_user_id linkage AND
-- uploaded_by_user_id ownership; both must match. Status check
-- mirrors the patient-side gate from migration 052 so a discarded
-- patient also loses access to their uploaded docs.
create policy "Patients read own uploaded documents"
  on documents for select
  using (
    uploaded_by_user_id = auth.uid()
    and patient_id in (
      select id from patients
      where patient_user_id = auth.uid()
        and status in ('active', 'potential')
    )
  );

create policy "Patients insert own documents"
  on documents for insert
  with check (
    uploaded_by_user_id = auth.uid()
    and patient_id in (
      select id from patients
      where patient_user_id = auth.uid()
        and status in ('active', 'potential')
    )
  );

create policy "Patients delete own uploaded documents"
  on documents for delete
  using (
    uploaded_by_user_id = auth.uid()
    and patient_id in (
      select id from patients
      where patient_user_id = auth.uid()
        and status in ('active', 'potential')
    )
  );

-- Patient intake completion timestamp — drives the "Completa tu
-- información" card on PatientHome.
alter table patients
  add column if not exists patient_intake_completed_at timestamptz;
