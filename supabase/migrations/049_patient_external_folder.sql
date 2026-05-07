-- Per-patient external folder link
--
-- Stores a single URL that points to the user's external storage
-- (Google Drive, OneDrive, Dropbox, iCloud, SharePoint, or any URL)
-- where they keep that patient's files. Cardigan never accesses the
-- contents — the link is just a hyperlink the practitioner taps to
-- jump from the patient's expediente straight into their cloud
-- folder. No OAuth, no token storage, no LFPDPPP "finalidad"
-- expansion.
--
-- Default NULL — most patients won't have a linked folder. The UI's
-- empty state is what surfaces the feature.

alter table patients
  add column if not exists external_folder_url text;

-- Defense-in-depth length cap. URL spec safe ceiling is 2048; longer
-- inputs are almost always paste artifacts (entire HTML snippets,
-- log outputs). Reject at the DB so a corrupted client write can't
-- crash the row read elsewhere. The client-side parseFolderLink
-- helper enforces the same limit so users get a friendly error
-- message instead of a 23514 server error.
alter table patients
  add constraint patients_external_folder_url_len
  check (external_folder_url is null or length(external_folder_url) <= 2048);
