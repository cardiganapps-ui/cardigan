/* ── Reschedule-request helpers ────────────────────────────────────
   Shared between the four endpoints that touch session_reschedule_
   requests (patient-reschedule-session, session-request-respond,
   patient-withdraw-reschedule, session-request-respond-token).

   Two scopes of helpers:
     - Pure (token gen, date parsing, expiry math) — unit-testable.
     - DB-touching (lookup, transition) — go through service-role.

   The endpoints are the bottleneck for ownership checks; the helpers
   here don't enforce auth themselves. Don't call any of the DB
   helpers without first verifying the caller is allowed to act on
   the row. */

import crypto from "node:crypto";

// "D-MMM" Spanish short-date matches what sessions/payments store.
// Mirrors utils/dates.js::SHORT_MONTHS server-side. Kept inline so
// this helper has no client-bundle dependencies.
const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const SHORT_MONTHS_BY_NAME = Object.fromEntries(SHORT_MONTHS.map((m, i) => [m, i]));

export function isoToShort(iso) {
  if (!iso || typeof iso !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso.slice(0, 10))) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Sanity: rejects Feb 30, Apr 31, etc — the JS Date overflows the
  // requested day into the next month, so a round-trip that doesn't
  // preserve y/m/d means the original was an impossible date.
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== (m - 1) || dt.getDate() !== d) return null;
  return `${d}-${SHORT_MONTHS[m - 1]}`;
}

// Inverse: "D-MMM" + "HH:MM" → absolute timestamp ms. Year inferred
// to be the closest match to "now" within ±6 months. Same fuzz the
// patient-cancel endpoint uses; keep them in lockstep so the
// "is this in the past?" check answers identically across the two
// endpoints that touch the same session shape.
export function shortToTimestampMs(shortDate, time) {
  if (!shortDate || typeof shortDate !== "string") return null;
  const m = shortDate.match(/^(\d{1,2})[\s-](\w{3})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = SHORT_MONTHS_BY_NAME[m[2]];
  if (month == null) return null;
  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(year, month, day, 0, 0, 0);
  if (candidate.getTime() < now.getTime() - 180 * 86_400_000) year += 1;
  const [h = "0", mi = "0"] = (time || "00:00").split(":");
  return new Date(year, month, day, Number(h) || 0, Number(mi) || 0).getTime();
}

// Compute expires_at: 1h before the EARLIEST of (original session
// time, proposed new time). After that point, leaving a request
// pending is pointless — the patient would not have time to
// reschedule again if the therapist finally said no. The cron
// sweeps any pending row with expires_at < now() and emails both
// parties.
//
// Returns ISO string (Postgres timestamptz) or null on parse failure.
export function computeExpiresAt(originalShortDate, originalTime, proposedShortDate, proposedTime) {
  const a = shortToTimestampMs(originalShortDate, originalTime);
  const b = shortToTimestampMs(proposedShortDate, proposedTime);
  if (a == null && b == null) return null;
  // Take the earliest non-null. If only one is parseable, expire
  // relative to that one — we'd rather lose the request than orphan
  // it in the DB forever.
  const earliest = (a != null && b != null) ? Math.min(a, b) : (a ?? b);
  return new Date(earliest - 60 * 60 * 1000).toISOString();
}

// 32 random bytes → URL-safe base64 (~43 chars). Independent values
// for approve and reject so a leaked accept link can't be brute-
// forced into a reject. Same lifecycle: cleared once the request
// resolves through ANY path (token spend, JWT response, withdraw,
// expire) so a stale email link is a 404 rather than a replay.
export function mintTokens() {
  const enc = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return {
    approve_token: enc(crypto.randomBytes(32)),
    reject_token: enc(crypto.randomBytes(32)),
  };
}

// Withdraw any pending request for this session. Used when:
//   - the patient submits a fresh request (only one pending allowed)
//   - the patient cancels the session entirely
// Service-role only. No-op if no pending row exists.
export async function withdrawPendingForSession(svc, sessionId, who = "patient_withdraw") {
  const { data, error } = await svc
    .from("session_reschedule_requests")
    .update({
      status: "withdrawn",
      resolved_at: new Date().toISOString(),
      resolved_by: who,
      approve_token: null,
      reject_token: null,
    })
    .eq("session_id", sessionId)
    .eq("status", "pending")
    .select("id, patient_id, user_id, original_date, original_time, proposed_date, proposed_time, patient_note");
  if (error) throw new Error(error.message);
  return data || [];
}

// Spanish weekday lookup (Lunes=0..Domingo=6) — same convention as
// the therapist's rescheduleSession action and the original cancel
// endpoint. Used to recompute sessions.day when an accept lands.
const DAY_BY_INDEX = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
function shortDateToDayName(shortDate) {
  if (!shortDate) return null;
  const m = shortDate.match(/^(\d{1,2})[\s-](\w{3})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const monthIdx = SHORT_MONTHS_BY_NAME[m[2]];
  if (monthIdx == null) return null;
  // Same year-fuzz logic as shortToTimestampMs.
  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(year, monthIdx, day, 12, 0, 0);
  if (candidate.getTime() < now.getTime() - 180 * 86_400_000) year += 1;
  const d = new Date(year, monthIdx, day, 12, 0, 0);
  const idx = (d.getDay() + 6) % 7;
  return DAY_BY_INDEX[idx];
}

// Apply an "accept" decision. Updates the session row to the
// proposed slot, marks the request as accepted, clears tokens.
// Re-checks the conflict invariant at this point — between request
// creation and acceptance, the therapist may have manually booked
// someone else into the proposed slot. Returns:
//   { ok: true, session } on success
//   { ok: false, code: "conflict"|"race_lost"|"db_error", error? } otherwise
//
// Caller is responsible for ownership/auth — the helper trusts that
// the request was fetched by an authorized path. Both the JWT-gated
// therapist endpoint and the token-based email landing call this.
export async function applyAccept(svc, request, { resolvedBy, therapistNote }) {
  if (!request || request.status !== "pending") {
    return { ok: false, code: "not_pending", current_status: request?.status || null };
  }
  // Conflict re-check at apply time. Status='scheduled' on the
  // sessions table — anything else is in a terminal state and can't
  // be a conflict against a live booking.
  const { data: conflict, error: cErr } = await svc
    .from("sessions")
    .select("id")
    .eq("user_id", request.user_id)
    .eq("date", request.proposed_date)
    .eq("time", request.proposed_time)
    .eq("status", "scheduled")
    .neq("id", request.session_id)
    .maybeSingle();
  if (cErr) return { ok: false, code: "db_error", error: cErr.message };
  if (conflict) return { ok: false, code: "conflict" };

  const newDay = shortDateToDayName(request.proposed_date);
  const nowIso = new Date().toISOString();

  // Atomic compare-and-set on session status — if the patient
  // cancelled or the therapist moved it manually in the meantime,
  // we race-lose and tell the caller.
  const { data: updated, error: updErr } = await svc
    .from("sessions")
    .update({
      date: request.proposed_date,
      time: request.proposed_time,
      day: newDay,
      last_rescheduled_at: nowIso,
      last_rescheduled_from: { date: request.original_date, time: request.original_time },
    })
    .eq("id", request.session_id)
    .eq("status", "scheduled")
    .select("id, date, time, day, patient, patient_id, user_id")
    .maybeSingle();
  if (updErr) return { ok: false, code: "db_error", error: updErr.message };
  if (!updated) return { ok: false, code: "race_lost" };

  // Mark the request resolved + clear tokens so any leaked email
  // link 404's instead of replaying.
  const { error: rErr } = await svc
    .from("session_reschedule_requests")
    .update({
      status: "accepted",
      resolved_at: nowIso,
      resolved_by: resolvedBy,
      therapist_note: therapistNote || null,
      approve_token: null,
      reject_token: null,
    })
    .eq("id", request.id);
  if (rErr) return { ok: false, code: "db_error", error: rErr.message };

  return { ok: true, session: updated };
}

// Apply a "reject" decision. Session row is untouched; only the
// request transitions. Same "trust the caller's auth" contract.
export async function applyReject(svc, request, { resolvedBy, therapistNote }) {
  if (!request || request.status !== "pending") {
    return { ok: false, code: "not_pending", current_status: request?.status || null };
  }
  const nowIso = new Date().toISOString();
  const { error: rErr } = await svc
    .from("session_reschedule_requests")
    .update({
      status: "rejected",
      resolved_at: nowIso,
      resolved_by: resolvedBy,
      therapist_note: therapistNote || null,
      approve_token: null,
      reject_token: null,
    })
    .eq("id", request.id)
    .eq("status", "pending");
  if (rErr) return { ok: false, code: "db_error", error: rErr.message };
  return { ok: true };
}

// Bundle the parties (patient row, therapist auth row) for email
// fan-out. Both response endpoints + the cron expire path call this
// before triggering the appropriate Resend send. Service-role only.
export async function fetchPartiesForRequest(svc, request) {
  const [{ data: patientRow }, { data: therapistAuth }] = await Promise.all([
    svc.from("patients")
      .select("name, parent, email")
      .eq("id", request.patient_id)
      .maybeSingle(),
    svc.auth.admin.getUserById(request.user_id),
  ]);
  const therapistUser = therapistAuth?.user || null;
  return {
    patientEmail: patientRow?.email?.trim() || null,
    patientGreetingName: patientRow?.parent?.trim() || patientRow?.name || "",
    patientDisplayName: patientRow?.name || "",
    therapistEmail: therapistUser?.email || null,
    therapistName:
      therapistUser?.user_metadata?.full_name ||
      therapistUser?.raw_user_meta_data?.full_name ||
      "",
  };
}

// Look up a request by either approve_token or reject_token. Returns
// the full row + which token matched ("approve" | "reject" | null).
// Public — called by the email-link landing page without a JWT.
// The token IS the auth: a leaked link can act on the row but the
// row itself is single-use (tokens null out on resolve), and the
// token can't be enumerated.
export async function findRequestByToken(svc, token) {
  if (!token || typeof token !== "string" || token.length < 16) {
    return { row: null, action: null };
  }
  // Try approve first, then reject. Exactly one will match by
  // design (mintTokens emits two distinct values per row).
  const { data: viaApprove } = await svc
    .from("session_reschedule_requests")
    .select("*")
    .eq("approve_token", token)
    .maybeSingle();
  if (viaApprove) return { row: viaApprove, action: "approve" };
  const { data: viaReject } = await svc
    .from("session_reschedule_requests")
    .select("*")
    .eq("reject_token", token)
    .maybeSingle();
  if (viaReject) return { row: viaReject, action: "reject" };
  return { row: null, action: null };
}
