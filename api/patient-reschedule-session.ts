/* ── POST /api/patient-reschedule-session ─────────────────────────
   Patient-initiated reschedule REQUEST. The session row is NOT
   modified here — that only happens once the therapist accepts
   (in-app or via email link). This is a deliberate change from
   the earlier self-serve behavior: therapists wanted approval
   over moves, since their availability isn't visible to the
   patient and a "free" slot in the patient's eyes might collide
   with the therapist's own commitments.

   Body: { session_id: string, new_date: ISO yyyy-mm-dd,
           new_time: HH:MM, note?: string }
   Auth: standard JWT (the patient's user).
   Response:
     200 { request_id, expires_at, status: "pending" }
     400 — bad input (invalid date/time, missing fields)
     401 — not signed in
     403 — RLS forge / past session / past target
     409 — session not scheduled, same slot, OR therapist already
           booked at that slot (conflict)
     500 — DB error

   Side effects on success:
     - INSERT session_reschedule_requests (status=pending) with two
       single-use tokens for the email-link path.
     - Withdraw any prior pending request for the same session
       (only one pending allowed by partial unique index).
     - Push the therapist a notification.
     - Email the therapist with [Aceptar] / [Rechazar] links and
       email the patient a "we sent it, waiting for confirmation"
       confirmation. Best-effort; failure doesn't roll back the
       request itself.

   Auto-expire: the cron sweeps pending rows whose expires_at is
   in the past (computed as 1h before the EARLIEST of original or
   proposed start time). Both parties get an email when that
   fires. */

import { createClient } from "@supabase/supabase-js";
import { getAuthUser, getServiceClient } from "./_admin.js";
import { rateLimit } from "./_ratelimit.js";
import { sendPush, TERMINAL_PUSH_STATUSES } from "./_push.js";
import { sendRescheduleRequestEmails } from "./_sessionEmail.js";
import { withSentry } from "./_sentry.js";
import {
  isoToShort, isoSlotToMs, shortToTimestampMs, computeExpiresAt, mintTokens,
  withdrawPendingForSession,
} from "./_rescheduleRequest.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const DAY_BY_INDEX = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];

function isoToDayName(iso: Row) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  const idx = (d.getDay() + 6) % 7;
  return DAY_BY_INDEX[idx];
}

function isValidTime(t: Row) {
  return typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

const APP_URL = "https://cardigan.mx";
const MAX_NOTE_LEN = 500;

async function handler(req: Row, res: Row) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  // Per-patient limiter — each request inserts a row and fans out
  // two emails + a push. 10 in 5 minutes covers legitimate retries
  // (correcting a date/time) while capping email/row flooding by a
  // token holder.
  const rl = await rateLimit({
    endpoint: "patient-reschedule-session",
    bucket: user.id,
    max: 10,
    windowSec: 300,
  });
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfter));
    return res.status(429).json({ error: "Demasiados intentos. Espera unos minutos." });
  }

  const { session_id, new_date, new_time, note } = req.body || {};
  if (typeof session_id !== "string" || !session_id) {
    return res.status(400).json({ error: "Invalid session_id" });
  }
  if (!isValidTime(new_time)) {
    return res.status(400).json({ error: "Invalid new_time", code: "bad_time" });
  }
  const newShortDate = isoToShort(new_date);
  if (!newShortDate) {
    return res.status(400).json({ error: "Invalid new_date", code: "bad_date" });
  }
  if (!isoToDayName(new_date)) {
    return res.status(400).json({ error: "Invalid new_date", code: "bad_date" });
  }
  let cleanNote = "";
  if (note != null) {
    if (typeof note !== "string") return res.status(400).json({ error: "Note must be a string" });
    cleanNote = note.trim().slice(0, MAX_NOTE_LEN);
  }

  // The proposed slot must be in the future. Validate against the
  // year-bearing ISO `new_date` (NOT the year-less round-trip) so a
  // far-future date that crosses the calendar year doesn't fold back
  // into the current year and get mis-flagged as "past" — see
  // isoSlotToMs for the full rationale. The past / horizon checks need
  // the real year; storage (newShortDate) stays year-less afterwards.
  const newSlotMs = isoSlotToMs(new_date, new_time);
  if (newSlotMs == null || newSlotMs <= Date.now()) {
    return res.status(403).json({ error: "New slot is in the past", code: "past_target" });
  }

  // Cap to 180 days out — the storage model stores "D-MMM" without
  // a year, so the year-fuzz becomes ambiguous past that horizon.
  // A patient picking 8 months ahead would round-trip read-back as
  // the same month next year. Server-side cap is the durable guard.
  const HORIZON_MS = 180 * 86_400_000;
  if (newSlotMs > Date.now() + HORIZON_MS) {
    return res.status(400).json({
      error: "New slot is too far in the future",
      code: "too_far",
      max_horizon_days: 180,
    });
  }

  // Verify session ownership via the user's JWT'd client. Sessions
  // RLS gates SELECT to rows linked through patient_user_id, so a
  // forged session_id from a different therapist returns no row
  // and we 403 cleanly without leaking existence.
  const userClient = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
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
  if (!session) return res.status(403).json({ error: "Forbidden" });

  if (session.status !== "scheduled") {
    return res.status(409).json({
      error: "Session is not in scheduled state",
      code: "not_scheduled",
      current_status: session.status,
    });
  }

  // The CURRENT slot must also be in the future — patients can't
  // request to move a session that already started.
  const currentSlotMs = shortToTimestampMs(session.date, session.time);
  if (currentSlotMs == null || currentSlotMs <= Date.now()) {
    return res.status(403).json({ error: "Session has already started", code: "past_source" });
  }

  // Too-close guard: the request's expires_at is set to 1h before
  // the EARLIEST of (original, proposed). If either is < 2h away,
  // expires_at lands in the past or near-past, the cron sweeps it
  // within minutes, and the patient rapid-fires "Solicitud enviada"
  // → "Solicitud vencida" with no real chance for the therapist to
  // respond. Reject up-front with friendly copy pointing the
  // patient at direct contact for last-minute changes.
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const horizonMs = Math.min(currentSlotMs, newSlotMs);
  if (horizonMs - Date.now() < TWO_HOURS_MS) {
    return res.status(403).json({
      error: "Session is too close to send a reschedule request",
      code: "too_close",
    });
  }

  // No-op: same slot. Don't manufacture a request that asks the
  // therapist to confirm what's already true.
  if (session.date === newShortDate && session.time === new_time) {
    return res.status(409).json({ error: "Same slot", code: "same_slot" });
  }

  const svc = getServiceClient();

  // Conflict detection — therapist already has another scheduled
  // session at that slot. Reject up-front rather than asking the
  // therapist to approve a double-booking.
  const { data: conflict, error: cErr } = await svc
    .from("sessions")
    .select("id")
    .eq("user_id", session.user_id)
    .eq("date", newShortDate)
    .eq("time", new_time)
    .eq("status", "scheduled")
    .neq("id", session.id)
    .maybeSingle();
  if (cErr) return res.status(500).json({ error: cErr.message });
  if (conflict) {
    return res.status(409).json({ error: "Slot already booked", code: "conflict" });
  }

  // Withdraw any prior pending request on this session — only one
  // pending allowed (DB partial unique index uniq_one_pending_per_session
  // would 23505 the insert otherwise). The withdrawal bumps the
  // existing row to status=withdrawn so the audit trail keeps a
  // record of the patient's prior intent.
  try {
    await withdrawPendingForSession(svc, session.id, "patient_withdraw");
  } catch (err: Row) {
    return res.status(500).json({ error: err?.message || "Withdraw prior failed" });
  }

  // Mint tokens + compute expiry. Tokens auth the email-link two-
  // step page (no JWT needed). Expiry = 1h before earliest of
  // original or proposed start time.
  const tokens = mintTokens();
  const expiresAt = computeExpiresAt(session.date, session.time, newShortDate, new_time);
  if (!expiresAt) {
    return res.status(500).json({ error: "Could not compute expiry" });
  }

  const { data: created, error: insErr } = await svc
    .from("session_reschedule_requests")
    .insert({
      session_id: session.id,
      user_id: session.user_id,
      patient_id: session.patient_id,
      submitted_by: user.id,
      original_date: session.date,
      original_time: session.time,
      proposed_date: newShortDate,
      proposed_time: new_time,
      patient_note: cleanNote || null,
      status: "pending",
      expires_at: expiresAt,
      approve_token: tokens.approve_token,
      reject_token: tokens.reject_token,
    })
    .select("id, expires_at")
    .single();
  if (insErr) return res.status(500).json({ error: insErr.message });

  // ── Therapist push notification (best-effort) ──
  // The push doesn't carry the tokens — it just deep-links to the
  // app where the therapist will see the request in their pending
  // banner and act on it through their JWT'd session. Tokens are
  // for the email path only.
  try {
    const { data: subs } = await svc
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", session.user_id);
    const payload = {
      title: "Solicitud de cambio de horario",
      body: `${session.patient} pidió mover su sesión: ${session.date} ${session.time} → ${newShortDate} ${new_time}.`,
      url: "/#agenda",
      tag: `reschedule-req-${created.id}`,
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
    console.warn("patient-reschedule-session: therapist notify failed:", err?.message);
  }

  // ── Emails to both parties (best-effort) ──
  // Therapist gets [Aceptar] [Rechazar] buttons that link to the
  // public token-based landing page. Patient gets a confirmation
  // that the request was sent.
  try {
    const [{ data: patientRow }, { data: therapistAuth }] = await Promise.all([
      svc.from("patients")
        .select("name, parent, email")
        .eq("id", session.patient_id)
        .maybeSingle(),
      svc.auth.admin.getUserById(session.user_id),
    ]);
    const therapistUser: Row = therapistAuth?.user || null;
    await sendRescheduleRequestEmails({
      patientEmail: patientRow?.email?.trim() || null,
      patientGreetingName: patientRow?.parent?.trim() || patientRow?.name || session.patient,
      patientDisplayName: patientRow?.name || session.patient,
      therapistEmail: therapistUser?.email || null,
      therapistName:
        therapistUser?.user_metadata?.full_name ||
        therapistUser?.raw_user_meta_data?.full_name ||
        "",
      oldDate: session.date,
      oldTime: session.time,
      newDate: newShortDate,
      newTime: new_time,
      patientNote: cleanNote || "",
      approveUrl: `${APP_URL}/api/r/${tokens.approve_token}`,
      rejectUrl: `${APP_URL}/api/r/${tokens.reject_token}`,
    });
  } catch (err: Row) {
    console.warn("patient-reschedule-session: email notify failed:", err?.message);
  }

  return res.status(200).json({
    request_id: created.id,
    expires_at: created.expires_at,
    status: "pending",
  });
}

export default withSentry(handler, { name: "patient-reschedule-session" });
