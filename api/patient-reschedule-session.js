/* ── POST /api/patient-reschedule-session ─────────────────────────
   Patient self-serve reschedule. Mirrors patient-cancel-session.js
   (same ownership pattern, same atomic compare-and-set, same
   best-effort therapist push) but instead of flipping status, it
   updates date + time IN PLACE on the same row so the underlying
   engagement (notes, cancellation history, queued reminders, the
   row id itself) survives.

   Body: { session_id: string, new_date: ISO yyyy-mm-dd, new_time: HH:MM }
   Auth: standard JWT (the patient's user).
   Response:
     200 { session_id, date, time, last_rescheduled_at }
     400 — bad input (invalid date / time format / missing fields)
     401 — not signed in
     403 — RLS forge / past session
     409 — session not scheduled, race-lost, OR slot conflict
     500 — DB error

   Writes go through service-role: the patient-side RLS on `sessions`
   is intentionally read-only. The endpoint is the bottleneck where
   ownership + temporal validity + conflict-detection are enforced
   in one place, the same as cancel.

   Therapist notification: best-effort push. Failure doesn't roll
   back the reschedule — the new slot stands either way and the
   therapist sees it on next refresh. */

import { createClient } from "@supabase/supabase-js";
import { getAuthUser, getServiceClient } from "./_admin.js";
import { sendPush, TERMINAL_PUSH_STATUSES } from "./_push.js";
import { withSentry } from "./_sentry.js";

// Shared with patient-cancel-session: parse "D-MMM" + "HH:MM" to
// an absolute ms timestamp so we can answer "is this in the past?"
// reliably. Same year-inference fuzz the therapist app uses.
const SHORT_MONTHS_BY_NAME = {
  Ene: 0, Feb: 1, Mar: 2, Abr: 3, May: 4, Jun: 5,
  Jul: 6, Ago: 7, Sep: 8, Oct: 9, Nov: 10, Dic: 11,
};
const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const DAY_NAMES_ES = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
// `day` column on the sessions table uses Spanish weekday names
// (matches DAY_ORDER in src/data/seedData.js). The therapist-side
// rescheduleSession recomputes it from the new date so auto-extend
// + recurrence-derivation continue to work after the move.
const DAY_BY_INDEX = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];

function shortDateToTime(shortDate, time) {
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
  const [h = 0, mi = 0] = (time || "00:00").split(":").map(Number);
  return new Date(year, month, day, h || 0, mi || 0).getTime();
}

// Convert an ISO `yyyy-mm-dd` (the format <input type="date"> emits)
// into the "D-MMM" Spanish short form the sessions table stores.
function isoToShortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  // Sanity: the constructed Date should round-trip to the same y/m/d
  // (catches Feb 30 etc).
  const d = new Date(year, month, day, 12, 0, 0);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return `${day}-${SHORT_MONTHS[month]}`;
}

function isoToDayName(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  // JS Sunday=0; we want Lunes=0 for the DAY_BY_INDEX table.
  const idx = (d.getDay() + 6) % 7;
  return DAY_BY_INDEX[idx];
}

function isValidTime(t) {
  return typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { session_id, new_date, new_time } = req.body || {};
  if (typeof session_id !== "string" || !session_id) {
    return res.status(400).json({ error: "Invalid session_id" });
  }
  if (!isValidTime(new_time)) {
    return res.status(400).json({ error: "Invalid new_time", code: "bad_time" });
  }
  const newShortDate = isoToShortDate(new_date);
  if (!newShortDate) {
    return res.status(400).json({ error: "Invalid new_date", code: "bad_date" });
  }
  const newDayName = isoToDayName(new_date);
  if (!newDayName) {
    return res.status(400).json({ error: "Invalid new_date", code: "bad_date" });
  }

  // The new slot must be in the future. We use the same year-fuzz
  // logic shortDateToTime applies to read paths, so the comparison
  // is consistent with cancel.
  const newSlotTime = shortDateToTime(newShortDate, new_time);
  if (newSlotTime == null || newSlotTime <= Date.now()) {
    return res.status(403).json({ error: "New slot is in the past", code: "past_target" });
  }

  // Verify ownership via the user's JWT'd client. RLS on sessions
  // gates SELECT to rows linked through patient_user_id (migration
  // 052), so a forged session_id from a different therapist returns
  // no row and we 403 without leaking existence.
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
    .select("id, patient_id, patient, date, time, status, user_id, duration")
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

  // The CURRENT slot must also still be in the future — patients
  // can't reschedule a session that already started.
  const currentSlotTime = shortDateToTime(session.date, session.time);
  if (currentSlotTime == null || currentSlotTime <= Date.now()) {
    return res.status(403).json({ error: "Session has already started", code: "past_source" });
  }

  // No-op: same slot. Tell the caller cleanly so the UI can route
  // to a "ya está en ese horario" toast instead of looking like the
  // reschedule succeeded (which would be a lie to the therapist
  // since the push notification would fire too).
  if (session.date === newShortDate && session.time === new_time) {
    return res.status(409).json({ error: "Same slot", code: "same_slot" });
  }

  const svc = getServiceClient();

  // Conflict detection — does the THERAPIST already have another
  // session at the new slot? The patient could otherwise reschedule
  // into a colleague's appointment. Check via service-role since the
  // patient doesn't have RLS visibility into other patients' rows.
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

  // Apply the move. Atomic compare-and-set on status='scheduled' so
  // a race with the therapist (cancel / move) returns 409 cleanly.
  // last_rescheduled_at + last_rescheduled_from preserve the audit
  // trail that the row used to be at the old slot.
  const oldSlot = { date: session.date, time: session.time };
  const nowIso = new Date().toISOString();
  const { data: updated, error: updErr } = await svc
    .from("sessions")
    .update({
      date: newShortDate,
      time: new_time,
      day: newDayName,
      last_rescheduled_at: nowIso,
      last_rescheduled_from: oldSlot,
    })
    .eq("id", session.id)
    .eq("status", "scheduled")
    .select("id, date, time, day, patient")
    .maybeSingle();
  if (updErr) return res.status(500).json({ error: updErr.message });
  if (!updated) {
    return res.status(409).json({ error: "Session state changed", code: "race_lost" });
  }

  // ── Therapist push notification (best-effort) ──
  // Same pattern as cancel: any failure here doesn't roll back the
  // move. The therapist sees the new slot on next refresh either
  // way; the push is just a heads-up.
  try {
    const { data: subs } = await svc
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", session.user_id);
    const payload = {
      title: "Cita reagendada",
      body: `${session.patient}: ${oldSlot.date} ${oldSlot.time} → ${updated.date} ${updated.time}.`,
      url: "/#agenda",
      tag: `reschedule-${session.id}`,
    };
    for (const sub of (subs || [])) {
      try {
        await sendPush(sub, payload);
      } catch (err) {
        if (TERMINAL_PUSH_STATUSES.has(err.statusCode)) {
          await svc.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      }
    }
  } catch (err) {
    console.warn("patient-reschedule-session: therapist notify failed:", err?.message);
  }

  return res.status(200).json({
    session_id: session.id,
    date: updated.date,
    time: updated.time,
    last_rescheduled_at: nowIso,
  });
}

export default withSentry(handler, { name: "patient-reschedule-session" });
