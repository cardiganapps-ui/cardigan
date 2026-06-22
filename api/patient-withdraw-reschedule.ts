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
import { rateLimit } from "./_ratelimit.js";
import { withSentry } from "./_sentry.js";
import { fetchPartiesForRequest } from "./_rescheduleRequest.js";
import { sendRescheduleWithdrawnEmails } from "./_sessionEmail.js";
import { sendPush, TERMINAL_PUSH_STATUSES } from "./_push.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

async function handler(req: Row, res: Row) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  // Per-patient limiter — withdrawal mutates a request row and may
  // fan out emails/push. 20 in 5 minutes is generous for legitimate
  // use while capping abuse.
  const rl = await rateLimit({
    endpoint: "patient-withdraw-reschedule",
    bucket: user.id,
    max: 20,
    windowSec: 300,
  });
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfter));
    return res.status(429).json({ error: "Demasiados intentos. Espera unos minutos." });
  }

  const { request_id } = req.body || {};
  if (typeof request_id !== "string" || !request_id) {
    return res.status(400).json({ error: "Invalid request_id" });
  }

  const svc = getServiceClient();
  // Pull the full row so the therapist-notify path has access to the
  // proposed/original times + parties. Cheap — 200 bytes either way.
  const { data: request, error: rErr } = await svc
    .from("session_reschedule_requests")
    .select("*")
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

  // ── Best-effort therapist notify ──
  // The banner just dropped from their view; without this, they'd
  // wonder whether they missed something. Push + email are both
  // non-blocking — never roll back the withdrawal.
  try {
    const parties = await fetchPartiesForRequest(svc, request);
    await sendRescheduleWithdrawnEmails({
      therapistEmail: parties.therapistEmail,
      therapistName: parties.therapistName,
      patientDisplayName: parties.patientDisplayName,
      oldDate: request.original_date,
      oldTime: request.original_time,
      newDate: request.proposed_date,
      newTime: request.proposed_time,
    });
  } catch (err: Row) {
    console.warn("patient-withdraw-reschedule: email failed:", err?.message);
  }
  try {
    const { data: subs } = await svc
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", request.user_id);
    const payload = {
      title: "Solicitud retirada",
      body: `${(request.original_date)} ${(request.original_time)} → ${(request.proposed_date)} ${(request.proposed_time)}: la persona retiró su solicitud.`,
      url: "/#agenda",
      tag: `reschedule-withdraw-${request.id}`,
    };
    for (const sub of (subs || [])) {
      try {
        await sendPush(sub, payload);
      } catch (err: Row) {
        if (TERMINAL_PUSH_STATUSES.has(err.statusCode)) {
          await svc.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      }
    }
  } catch (err: Row) {
    console.warn("patient-withdraw-reschedule: push failed:", err?.message);
  }

  return res.status(200).json({ request_id, status: "withdrawn" });
}

export default withSentry(handler, { name: "patient-withdraw-reschedule" });
