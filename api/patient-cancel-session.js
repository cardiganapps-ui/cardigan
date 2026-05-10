/* ── POST /api/patient-cancel-session ─────────────────────────────
   Patient cancels one of their own scheduled sessions. Server-
   side validates ownership + future-ness + status, flips the
   session to 'cancelled', and pushes a notification to the
   therapist.

   Body: { session_id: string, note?: string }
   Auth: standard JWT (the patient's user).
   Response:
     200 { session_id, cancelled_at }
     400 — bad input (missing/oversized note, etc)
     401 — not signed in
     403 — session doesn't belong to a patients row this user owns,
           OR session is in the past, OR session isn't scheduled
     404 — session not found
     409 — session already in a terminal state (cancelled/completed/charged)

   Writes go through service-role on purpose: the patient-side
   RLS on `sessions` is read-only and we want it to stay that way.
   The endpoint is the bottleneck where ownership + temporal
   validity + business rules can be enforced without scattering
   them across RLS policies.

   Therapist notification: best-effort. We don't fail the cancel
   if the push send fails — the cancel is the source of truth,
   the notification is gravy. The therapist sees the cancelled
   session in their agenda either way next time they refresh. */

import { createClient } from "@supabase/supabase-js";
import { getAuthUser, getServiceClient } from "./_admin.js";
import { sendPush, TERMINAL_PUSH_STATUSES } from "./_push.js";
import { sendCancelNotificationEmails } from "./_sessionEmail.js";
import { withSentry } from "./_sentry.js";

const MAX_NOTE_LEN = 500;

// Same date-string normalizer the cron uses. "D-MMM" sortable ISO
// for fast comparison. Returns null on parse failure.
const SHORT_MONTHS_BY_NAME = {
  Ene: 0, Feb: 1, Mar: 2, Abr: 3, May: 4, Jun: 5,
  Jul: 6, Ago: 7, Sep: 8, Oct: 9, Nov: 10, Dic: 11,
};
function shortDateToTime(shortDate, time) {
  if (!shortDate || typeof shortDate !== "string") return null;
  const m = shortDate.match(/^(\d{1,2})[\s-](\w{3})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = SHORT_MONTHS_BY_NAME[m[2]];
  if (month == null) return null;
  // Year inference: any month >= 6 months before now is next year.
  // Mirrors the same fuzz the therapist app uses elsewhere.
  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(year, month, day, 0, 0, 0);
  if (candidate.getTime() < now.getTime() - 180 * 86_400_000) year += 1;
  const [h = 0, mi = 0] = (time || "00:00").split(":").map(Number);
  return new Date(year, month, day, h || 0, mi || 0).getTime();
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { session_id, note } = req.body || {};
  if (typeof session_id !== "string" || !session_id) {
    return res.status(400).json({ error: "Invalid session_id" });
  }
  let cleanNote = "";
  if (note != null) {
    if (typeof note !== "string") {
      return res.status(400).json({ error: "Note must be a string" });
    }
    cleanNote = note.trim().slice(0, MAX_NOTE_LEN);
  }

  // Verify ownership via the user's own JWT'd client. RLS scopes
  // SELECT on sessions to rows linked through patient_user_id, so
  // a forged session_id from a different therapist returns no row
  // and we 403 cleanly without leaking existence.
  const userClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: req.headers.authorization } },
    }
  );
  const { data: session, error: sErr } = await userClient
    .from("sessions")
    .select("id, patient_id, patient, date, time, status, user_id")
    .eq("id", session_id)
    .maybeSingle();
  if (sErr) return res.status(500).json({ error: sErr.message });
  if (!session) {
    // RLS blocked it OR doesn't exist. Both feel the same to the
    // caller; "Forbidden" is the honest answer because they're
    // not authorized to act on the row regardless of which case.
    return res.status(403).json({ error: "Forbidden" });
  }

  // Already in a terminal state.
  if (session.status !== "scheduled") {
    return res.status(409).json({
      error: "Session is not in scheduled state",
      code: "not_scheduled",
      current_status: session.status,
    });
  }

  // The slot must still be in the future. Cancelling a session
  // that already happened isn't a real cancel — it's an audit
  // rewrite. The therapist app uses the auto-complete predicate
  // (date + time + 1h ≤ now means it counts as past); we apply
  // a stricter rule here (no grace) — patient can only cancel
  // sessions whose start hasn't happened yet.
  const sessionTime = shortDateToTime(session.date, session.time);
  if (sessionTime == null || sessionTime <= Date.now()) {
    return res.status(403).json({ error: "Session has already started", code: "past" });
  }

  // Apply the cancel. Service-role bypasses the read-only patient
  // RLS we want to keep on sessions. cancel_reason records the
  // patient-initiated tag and any optional note.
  //
  // Default behavior: mark as `charged` (the late-cancel-with-charge
  // status). The therapist can downgrade to `cancelled` from their
  // agenda if they decide not to charge. This matches the standard
  // therapy-practice norm — the slot was reserved for the patient,
  // the therapist's time was committed, the cancel still consumes
  // the rate. The patient sees the disclosure in the cancel dialog
  // before they confirm; the therapist can flip it case-by-case.
  const cancelReason = cleanNote
    ? `Cancelada con cargo por paciente — ${cleanNote}`
    : "Cancelada con cargo por paciente";

  const svc = getServiceClient();
  const { data: updated, error: updErr } = await svc
    .from("sessions")
    .update({
      status: "charged",
      cancel_reason: cancelReason,
    })
    .eq("id", session.id)
    .eq("status", "scheduled") // race-safe: only flip if still scheduled
    .select("id, date, time, patient")
    .maybeSingle();
  if (updErr) return res.status(500).json({ error: updErr.message });
  if (!updated) {
    // Lost the race against another writer (therapist clicking
    // cancel at the same time, etc).
    return res.status(409).json({ error: "Session state changed", code: "race_lost" });
  }

  // ── Therapist push notification (best-effort) ──
  // Find the therapist's push subscriptions and fire a quick
  // payload. Failure here doesn't roll back the cancel — the
  // therapist will see the cancelled session in their agenda
  // regardless.
  try {
    const { data: subs } = await svc
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", session.user_id);
    const payload = {
      title: "Cita cancelada (con cargo)",
      body: `${session.patient} canceló la sesión del ${session.date} a las ${session.time}. Por defecto se marca con cargo — puedes cambiarla a "sin cargo" desde la sesión.`,
      url: "/#agenda",
      tag: `cancel-${session.id}`,
    };
    for (const sub of (subs || [])) {
      try {
        await sendPush(sub, payload);
      } catch (err) {
        if (TERMINAL_PUSH_STATUSES.has(err.statusCode)) {
          await svc.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
        // Non-terminal errors swallow silently — this is best-effort.
      }
    }
  } catch (err) {
    console.warn("patient-cancel-session: therapist notify failed:", err?.message);
  }

  // ── Email both parties (best-effort) ──
  // Pulls the patient row for greeting (parent if minor, falls back
  // to name) + email, and the therapist email/name from auth.users.
  // Both lookups go through service-role since the patient JWT can't
  // see the therapist's auth row, and the patients table is already
  // filtered by patient_user_id via RLS in the JWT'd path. Failure
  // here doesn't roll back the cancel — same shape as the push above.
  try {
    const [{ data: patientRow }, { data: therapistAuth }] = await Promise.all([
      svc
        .from("patients")
        .select("name, parent, email")
        .eq("id", session.patient_id)
        .maybeSingle(),
      svc.auth.admin.getUserById(session.user_id),
    ]);
    const therapistUser = therapistAuth?.user || null;
    await sendCancelNotificationEmails({
      patientEmail: patientRow?.email?.trim() || null,
      patientGreetingName: patientRow?.parent?.trim() || patientRow?.name || session.patient,
      patientDisplayName: patientRow?.name || session.patient,
      therapistEmail: therapistUser?.email || null,
      therapistName:
        therapistUser?.user_metadata?.full_name ||
        therapistUser?.raw_user_meta_data?.full_name ||
        "",
      date: session.date,
      time: session.time,
      cancelNote: cleanNote,
    });
  } catch (err) {
    console.warn("patient-cancel-session: email notify failed:", err?.message);
  }

  return res.status(200).json({
    session_id: session.id,
    cancelled_at: new Date().toISOString(),
  });
}

export default withSentry(handler, { name: "patient-cancel-session" });
