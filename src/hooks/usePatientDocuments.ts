import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";

/* ── usePatientDocuments ──────────────────────────────────────────
   Patient-side document operations: list + upload + delete + open.
   Mirrors the therapist's useDocuments shape but every write goes
   through a patient-specific endpoint that knows how to validate
   ownership through the patient_user_id linkage.

   Upload flow:
     1. POST /api/patient-upload-url  → { url, path }
     2. PUT the file directly to R2   → 200
     3. POST /api/patient-document-confirm → row inserted

   The two-step flow lets large files stream to R2 without going
   through Vercel's 4.5 MB body limit. */

// Mirror the cap enforced server-side at the confirm step so we
// fail fast instead of streaming a 200 MB file to R2 just to have
// the row insert reject it.
const MAX_FILE_SIZE = 25 * 1024 * 1024;

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    "Authorization": `Bearer ${session?.access_token || ""}`,
    "Content-Type": "application/json",
  };
}

// Best-effort R2 cleanup for the orphan-after-PUT path. If R2
// accepts the upload but the confirm-step insert fails (RLS,
// network, server error), the bytes sit in our bucket with no DB
// row pointing at them. We can't delete via service-role from the
// browser, but we can ask the patient-document-delete endpoint to
// sweep by path. The endpoint is auth-gated to the uploader, which
// is exactly the path we just uploaded to — no escalation.
async function bestEffortR2Cleanup(filePath: string) {
  try {
    const headers = await authHeaders();
    await fetch("/api/patient-document-delete", {
      method: "POST",
      headers,
      // file_path-only delete: server walks the same R2 helper but
      // skips the DB row lookup (no row exists by definition). The
      // endpoint validates the path prefix so a malicious caller
      // can't sweep someone else's docs.
      body: JSON.stringify({ file_path: filePath, orphan: true }),
    });
  } catch {
    // Best-effort: a Sentry warning would be the natural next step,
    // but the orphan ages out via R2 lifecycle rules regardless.
  }
}

interface PatientDocRow { id: string; name?: string; file_path?: string; file_type?: string; file_size?: number; created_at?: string }

export function usePatientDocuments(patientId: string | null | undefined) {
  const [documents, setDocuments] = useState<PatientDocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Refetch the patient's uploads. RLS scopes the SELECT to
  // uploaded_by_user_id = auth.uid() so we don't need any extra
  // filtering — we just trust the database.
  const refresh = useCallback(async () => {
    if (!patientId) {
      setDocuments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("documents")
      .select("id, name, file_path, file_type, file_size, created_at")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false });
    setDocuments(data || []);
    setLoading(false);
  }, [patientId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Returns { ok, error } so callers can surface a toast on
  // failure without having to inspect throws.
  const upload = useCallback(async (file: File | null | undefined) => {
    if (!file || !patientId) return { ok: false, error: "no_file" };
    // Fail-fast on oversized files so the patient sees the error
    // immediately instead of after a long upload that gets rejected
    // server-side. Server still re-validates in the confirm step.
    if (file.size > MAX_FILE_SIZE) {
      return { ok: false, error: "too_large" };
    }
    setUploading(true);
    let uploadedPath: string | null = null;
    try {
      // Step 1: presigned PUT URL
      const headers = await authHeaders();
      const urlRes = await fetch("/api/patient-upload-url", {
        method: "POST",
        headers,
        body: JSON.stringify({
          patient_id: patientId,
          file_name: file.name,
          content_type: file.type,
        }),
      });
      if (!urlRes.ok) {
        const body = await urlRes.json().catch(() => ({}));
        return { ok: false, error: body?.error || "upload_url_failed", status: urlRes.status };
      }
      const { url, path } = await urlRes.json();

      // Step 2: stream directly to R2
      const putRes = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) return { ok: false, error: "put_failed" };
      uploadedPath = path;

      // Step 3: confirm + insert row
      const confirmRes = await fetch("/api/patient-document-confirm", {
        method: "POST",
        headers,
        body: JSON.stringify({
          patient_id: patientId,
          file_path: path,
          name: file.name,
          file_type: file.type,
          file_size: file.size,
        }),
      });
      if (!confirmRes.ok) {
        const body = await confirmRes.json().catch(() => ({}));
        // Confirm failed AFTER a successful R2 PUT — sweep the
        // orphan so we don't accumulate dead bytes in the bucket.
        if (uploadedPath) bestEffortR2Cleanup(uploadedPath);
        return { ok: false, error: body?.error || "confirm_failed" };
      }
      const { document } = await confirmRes.json();
      // Optimistically prepend so the new file shows up immediately;
      // a refresh on next render reconciles. Using prepend (not
      // append) so newest-first ordering is consistent.
      setDocuments(prev => [document, ...prev]);
      return { ok: true, document };
    } catch (err: unknown) {
      // Caught after R2 PUT succeeded → orphan cleanup. If we never
      // got past step 1, uploadedPath is null and this is a no-op.
      if (uploadedPath) bestEffortR2Cleanup(uploadedPath);
      return { ok: false, error: (err as Error)?.message || "network" };
    } finally {
      setUploading(false);
    }
  }, [patientId]);

  const remove = useCallback(async (documentId: string) => {
    if (!documentId) return { ok: false };
    const headers = await authHeaders();
    const res = await fetch("/api/patient-document-delete", {
      method: "POST",
      headers,
      body: JSON.stringify({ document_id: documentId }),
    });
    if (!res.ok) return { ok: false };
    setDocuments(prev => prev.filter(d => d.id !== documentId));
    return { ok: true };
  }, []);

  // Generates a short-lived URL for opening the file. Call this
  // right before opening the link — the URL expires in 5 minutes.
  const getUrl = useCallback(async (documentId: string) => {
    const headers = await authHeaders();
    const res = await fetch("/api/patient-document-url", {
      method: "POST",
      headers,
      body: JSON.stringify({ document_id: documentId }),
    });
    if (!res.ok) return null;
    const { url } = await res.json();
    return url;
  }, []);

  return { documents, loading, uploading, upload, remove, getUrl, refresh };
}
