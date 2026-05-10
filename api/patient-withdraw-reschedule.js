/* ── POST /api/patient-withdraw-reschedule ─────────────────────────
   Patient cancels their own pending reschedule request before the
   therapist has acted on it. The session row is untouched (it was
   never modified — accept is what would move it).

   Body: { request_id: string }
   Auth: standard JWT (the patient's user).
   Response:
     200 { request_id, status: "withdrawn" }
     401, 403, 404, 409 — same shape as the cancel/respond endpoints

   Ownership: the request must have been submitted by THIS user
   (submitted_by = auth.uid()). We don't gate on patient_id chain
   here because submitted_by carries the canonical "who proposed
   this" answer; tying withdrawal authority to the specific auth
   row that submitted is stricter than necessary but avoids any
   ambiguity if the same patient row is ever shared (e.g. a guardian
   linked to a minor in a future iteration). */

import { getAuthUser, getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { request_id } = req.body || {};
  if (typeof request_id !== "string" || !request_id) {
    return res.status(400).json({ error: "Invalid request_id" });
  }

  const svc = getServiceClient();
  const { data: request, error: rErr } = await svc
    .from("session_reschedule_requests")
    .select("id, submitted_by, status")
    .eq("id", request_id)
    .maybeSingle();
  if (rErr) return res.status(500).json({ error: rErr.message });
  if (!request) return res.status(404).json({ error: "Not found" });
  if (request.submitted_by !== user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (request.status !== "pending") {
    return res.status(409).json({
      error: "Request not pending",
      code: "not_pending",
      current_status: request.status,
    });
  }

  // Atomic compare-and-set on status — same race protection as the
  // cancel + respond endpoints.
  const nowIso = new Date().toISOString();
  const { data: updated, error: updErr } = await svc
    .from("session_reschedule_requests")
    .update({
      status: "withdrawn",
      resolved_at: nowIso,
      resolved_by: "patient_withdraw",
      approve_token: null,
      reject_token: null,
    })
    .eq("id", request.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (updErr) return res.status(500).json({ error: updErr.message });
  if (!updated) {
    return res.status(409).json({ error: "Request state changed", code: "race_lost" });
  }

  return res.status(200).json({ request_id, status: "withdrawn" });
}

export default withSentry(handler, { name: "patient-withdraw-reschedule" });
