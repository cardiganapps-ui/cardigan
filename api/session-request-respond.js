/* ── POST /api/session-request-respond ─────────────────────────────
   Therapist-side acceptance / rejection of a pending reschedule
   request. JWT-gated; the therapist's auth row must own the
   request (checked via user_id match against the row).

   Body: { request_id: string, action: "accept"|"reject", note?: string }
   Auth: standard JWT (the therapist's user).
   Response:
     200 { request_id, status: "accepted"|"rejected", session?: {...} }
     400 — bad input
     401 — not signed in
     403 — request doesn't belong to this user
     404 — request not found
     409 — request not pending (already resolved), conflict at apply
           time, or race-lost on session row
     500 — DB error

   Email-link path is in /api/r/[token] + /api/session-request-respond-token
   — same applyAccept/applyReject helper, different auth shape.

   Side effects on success:
     - status flips to accepted/rejected
     - tokens null out (any in-flight email link becomes a 404)
     - on accept: session row moves to the proposed slot
     - patient gets a confirmation email; cron-driven push optional
       (we don't push the patient on accept v1 — push is a therapist-
       facing channel today; surfacing patient pushes is its own
       feature). Patient sees the result on next portal refresh +
       email. */

import { getAuthUser, getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";
import {
  applyAccept, applyReject, fetchPartiesForRequest,
} from "./_rescheduleRequest.js";
import {
  sendRescheduleAcceptedEmails, sendRescheduleRejectedEmails,
} from "./_sessionEmail.js";

const MAX_NOTE_LEN = 500;

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { request_id, action, note } = req.body || {};
  if (typeof request_id !== "string" || !request_id) {
    return res.status(400).json({ error: "Invalid request_id" });
  }
  if (action !== "accept" && action !== "reject") {
    return res.status(400).json({ error: "action must be 'accept' or 'reject'" });
  }
  let cleanNote = "";
  if (note != null) {
    if (typeof note !== "string") return res.status(400).json({ error: "Note must be a string" });
    cleanNote = note.trim().slice(0, MAX_NOTE_LEN);
  }

  const svc = getServiceClient();
  const { data: request, error: rErr } = await svc
    .from("session_reschedule_requests")
    .select("*")
    .eq("id", request_id)
    .maybeSingle();
  if (rErr) return res.status(500).json({ error: rErr.message });
  if (!request) return res.status(404).json({ error: "Not found" });

  // Ownership: only the therapist whose user_id matches can act.
  if (request.user_id !== user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (request.status !== "pending") {
    return res.status(409).json({
      error: "Request not pending",
      code: "not_pending",
      current_status: request.status,
    });
  }

  const apply = action === "accept" ? applyAccept : applyReject;
  const out = await apply(svc, request, {
    resolvedBy: "therapist_app",
    therapistNote: cleanNote,
  });
  if (!out.ok) {
    if (out.code === "conflict") return res.status(409).json({ error: "Slot already booked", code: "conflict" });
    if (out.code === "race_lost") return res.status(409).json({ error: "Session state changed", code: "race_lost" });
    if (out.code === "stale") return res.status(409).json({ error: "Session was moved", code: "stale" });
    if (out.code === "not_pending") return res.status(409).json({ error: "Request not pending", code: "not_pending" });
    return res.status(500).json({ error: out.error || "Apply failed" });
  }

  // Email the patient (best-effort — never blocks the response).
  try {
    const parties = await fetchPartiesForRequest(svc, request);
    const ctx = {
      ...parties,
      oldDate: request.original_date,
      oldTime: request.original_time,
      newDate: request.proposed_date,
      newTime: request.proposed_time,
      therapistNote: cleanNote || "",
    };
    if (action === "accept") await sendRescheduleAcceptedEmails(ctx);
    else await sendRescheduleRejectedEmails(ctx);
  } catch (err) {
    console.warn("session-request-respond: email failed:", err?.message);
  }

  return res.status(200).json({
    request_id,
    status: action === "accept" ? "accepted" : "rejected",
    session: out.session || null,
  });
}

export default withSentry(handler, { name: "session-request-respond" });
