import {
  getServiceClient,
  sendPush,
  verifyCronSecret,
  formatShortDate,
  formatShortDateLegacy,
  TERMINAL_PUSH_STATUSES,
} from "./_push.js";
import { withSentry } from "./_sentry.js";
import { getFlag } from "./_flags.js";
import { sendTemplate, toE164MX } from "./_whatsapp.js";
import { sendLifecycleEmail } from "./_lifecycle.js";

// Lifecycle email cohorts. Each is "exactly N days after sign-up,
// with a one-day grace window so a cron tick that misses the window
// still catches the user the next day." The cron writes a dedupe
// row per (user, kind), so a user whose tick lands on day 4 still
// only gets the day-3 email once.
const LIFECYCLE_COHORTS = [
  { kind: "trial_day_3",          daysSinceSignup: 3,  windowDays: 2 },
  { kind: "trial_day_25",         daysSinceSignup: 25, windowDays: 2 },
  { kind: "trial_winback_day_37", daysSinceSignup: 37, windowDays: 2 },
];

const WHATSAPP_TEMPLATE = "cardigan_session_reminder";
const WHATSAPP_LANGUAGE = "es_MX";

async function handler(req, res) {
  // Accept GET (Vercel Cron's default) and POST (legacy pg_cron caller).
  // Both paths are gated by the same shared-secret check below, so the
  // method matters only as a basic shape filter.
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Authenticate: only accept calls with the shared cron secret
  if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Edge Config kill switch — flip cron_paused=true to silence reminder
  // sends without a redeploy (e.g., during a push outage).
  if (await getFlag("cron_paused")) {
    return res.status(200).json({ sent: 0, paused: true });
  }

  const startedAt = Date.now();

  try {
    const supabase = getServiceClient();

    // 1. Fetch all users with notifications enabled
    const { data: prefs, error: prefsError } = await supabase
      .from("notification_preferences")
      .select("user_id, reminder_minutes, timezone")
      .eq("enabled", true);

    if (prefsError) {
      console.error("Failed to fetch preferences:", prefsError.message);
      return res.status(500).json({ error: "Failed to fetch preferences" });
    }

    if (!prefs || prefs.length === 0) {
      logRun({ usersScanned: 0, sessionsMatched: 0, remindersSent: 0, subscriptionsCleaned: 0, startedAt });
      return res.status(200).json({ sent: 0, message: "No users with notifications enabled" });
    }

    let totalSent = 0;
    let staleRemoved = 0;
    let totalSessionsMatched = 0;

    for (const pref of prefs) {
      const { user_id, reminder_minutes = 30, timezone = "America/Mexico_City" } = pref;

      // 2. Compute "now" and "target time" in the user's timezone
      const now = new Date();
      const userNow = toTimezone(now, timezone);
      const todayShort = formatShortDate(userNow);
      const todayShortLegacy = formatShortDateLegacy(userNow);

      // 3. Fetch today's scheduled sessions for this user. Match both the
      // new "D-MMM" and legacy "D MMM" forms so the cron keeps firing
      // for accounts whose historical rows haven't been migrated yet.
      // patient_id and modality are pulled in here so the WhatsApp
      // branch below can resolve the recipient + template variables
      // without re-querying.
      const { data: sessions, error: sessError } = await supabase
        .from("sessions")
        .select("id, patient_id, patient, time, initials, modality")
        .eq("user_id", user_id)
        .in("date", [todayShort, todayShortLegacy])
        .eq("status", "scheduled");

      if (sessError || !sessions || sessions.length === 0) continue;

      // 4. Filter sessions within the reminder window
      const nowMinutes = userNow.getHours() * 60 + userNow.getMinutes();
      const sessionsToNotify = sessions.filter((s) => {
        // Defensive null/format guard — a single bad row would otherwise
        // throw inside the filter callback and skip every remaining
        // user in the cron batch. The DB schema has time NOT NULL, but
        // the cost of the guard is zero and a corrupted row shouldn't
        // take down everyone's reminders.
        if (!s.time || typeof s.time !== "string") return false;
        const parts = s.time.split(":");
        if (parts.length < 2) return false;
        const h = Number(parts[0]);
        const m = Number(parts[1]);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
        const sessionMinutes = h * 60 + m;
        const diff = sessionMinutes - nowMinutes;
        // Send reminder if session is between 0 and reminder_minutes from now
        // (i.e., session hasn't started yet but is within the window)
        return diff > 0 && diff <= reminder_minutes;
      });

      if (sessionsToNotify.length === 0) continue;

      // 5. Check which sessions already have sent reminders. The channel
      // column was added in migration 019; existing rows defaulted to
      // 'push' so this filter is backward-compatible.
      const sessionIds = sessionsToNotify.map((s) => s.id);
      const { data: alreadySentPush } = await supabase
        .from("sent_reminders")
        .select("session_id")
        .eq("user_id", user_id)
        .eq("channel", "push")
        .in("session_id", sessionIds);

      const sentSet = new Set((alreadySentPush || []).map((r) => r.session_id));
      const newSessions = sessionsToNotify.filter((s) => !sentSet.has(s.id));

      // newSessions drives the push branch only. The WhatsApp branch
      // below has its own dedup (channel='whatsapp') and runs even if
      // every push has already been sent.
      totalSessionsMatched += newSessions.length;

      // 6. Fetch push subscriptions for this user. Empty list is fine —
      // the push branch will be a no-op and the WhatsApp branch below
      // can still run for users who only opted into WhatsApp.
      const { data: subsRaw } = newSessions.length > 0
        ? await supabase
            .from("push_subscriptions")
            .select("endpoint, p256dh, auth")
            .eq("user_id", user_id)
        : { data: [] };
      const subs = subsRaw || [];

      // 7. Send push notifications (skipped silently if no subs).
      for (const session of (subs.length > 0 ? newSessions : [])) {
        // Minutes-until is computed against the same userNow snapshot
        // the window filter used, so the copy the user reads lines up
        // with the decision to send.
        const [sh, sm] = String(session.time || "").split(":").map(Number);
        const sessionMinutes = (sh || 0) * 60 + (sm || 0);
        const minutesUntil = Math.max(1, sessionMinutes - nowMinutes);
        const payload = {
          title: "Recordatorio de sesión",
          body: `${session.patient} a las ${session.time} — en ${minutesUntil} min`,
          url: "/#agenda",
          // Collapse repeat reminders for the same session into a single
          // system banner rather than stacking.
          tag: `session-${session.id}`,
          actions: [{ action: "open", title: "Ver agenda" }],
        };

        for (const sub of subs) {
          try {
            await sendPush(sub, payload);
          } catch (err) {
            if (TERMINAL_PUSH_STATUSES.has(err.statusCode)) {
              await supabase
                .from("push_subscriptions")
                .delete()
                .eq("endpoint", sub.endpoint);
              staleRemoved++;
            } else {
              console.error(JSON.stringify({
                evt: "push.send.error",
                endpoint_host: safeHost(sub.endpoint),
                statusCode: err.statusCode,
                message: err.message,
              }));
            }
          }
        }

        // 8. Mark session as notified on the push channel. The unique
        // key is (session_id, user_id, channel) so push and WhatsApp
        // dedupe independently.
        await supabase.from("sent_reminders").upsert(
          { session_id: session.id, user_id, channel: "push" },
          { onConflict: "session_id,user_id,channel" }
        );

        totalSent++;
      }

      // ── WhatsApp branch ────────────────────────────────────────
      // Runs for every user, regardless of push outcome. Patients opt
      // in per-row via patients.whatsapp_enabled. Each (session, 'whatsapp')
      // is deduped via sent_reminders. A failed Meta send does NOT write
      // a sent_reminders row — the next cron tick retries.
      const whatsappPaused = await getFlag("whatsapp_paused");
      if (whatsappPaused || sessionsToNotify.length === 0) continue;

      const { data: alreadySentWa } = await supabase
        .from("sent_reminders")
        .select("session_id")
        .eq("user_id", user_id)
        .eq("channel", "whatsapp")
        .in("session_id", sessionIds);
      const sentWaSet = new Set((alreadySentWa || []).map((r) => r.session_id));
      const sessionsForWa = sessionsToNotify.filter((s) => !sentWaSet.has(s.id) && s.patient_id);
      if (sessionsForWa.length === 0) continue;

      // Hydrate patient rows so we can read whatsapp_enabled, phone,
      // name, and parent in a single query.
      const patientIds = Array.from(new Set(sessionsForWa.map((s) => s.patient_id)));
      const { data: patientRows } = await supabase
        .from("patients")
        .select("id, name, parent, phone, whatsapp_enabled")
        .in("id", patientIds);
      const patientsById = new Map((patientRows || []).map((p) => [p.id, p]));

      const targets = sessionsForWa
        .map((s) => ({ session: s, patient: patientsById.get(s.patient_id) }))
        .filter(({ patient }) => patient && patient.whatsapp_enabled && patient.phone);

      if (targets.length === 0) continue;

      // Therapist display name — single lookup per user, used as the
      // signature variable in the template.
      let therapistName = "";
      try {
        const { data: u } = await supabase.auth.admin.getUserById(user_id);
        therapistName = u?.user?.user_metadata?.full_name
          || u?.user?.email?.split("@")[0]
          || "";
      } catch (err) {
        console.warn("whatsapp: therapist name lookup failed:", err?.message);
      }

      await Promise.allSettled(targets.map(async ({ session, patient }) => {
        // Post-migration 023 session_type is the source of truth.
        // Keep the legacy startsWith("T·") fallback so an unmigrated
        // row (shouldn't exist in prod, but safer) still routes
        // correctly through the tutor branch.
        const isTutor = session.session_type === "tutor"
          || (typeof session.initials === "string" && session.initials.startsWith("T·"));
        // For minor patients the phone already belongs to the tutor
        // (per CLAUDE.md / user direction). For tutor-meet sessions we
        // greet by the tutor's name; for normal sessions of an adult
        // patient we greet by the patient's name; for normal sessions
        // of a minor the phone reaches the tutor and we still greet
        // by the tutor's name (parent field).
        const recipientName = (isTutor || patient.parent)
          ? (patient.parent || patient.name || "")
          : (patient.name || "");
        const e164 = toE164MX(patient.phone);
        const modality = (session.modality || "presencial").toLowerCase();
        const time = String(session.time || "").slice(0, 5);

        // Audit row first so even a network failure in sendTemplate
        // leaves a trace pointing at the patient/session.
        const { data: auditRow, error: auditErr } = await supabase
          .from("whatsapp_audit")
          .insert({
            user_id,
            patient_id: patient.id,
            session_id: session.id,
            recipient_phone: e164 || patient.phone,
            template_name: WHATSAPP_TEMPLATE,
            status: "pending",
          })
          .select("id")
          .single();
        if (auditErr) {
          console.warn("whatsapp: audit insert failed:", auditErr.message);
          return;
        }

        if (!e164) {
          await supabase.from("whatsapp_audit")
            .update({
              status: "failed",
              error_code: "invalid_phone",
              error_reason: `Could not normalize phone: ${patient.phone}`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", auditRow.id);
          return;
        }

        const result = await sendTemplate({
          to: e164,
          templateName: WHATSAPP_TEMPLATE,
          languageCode: WHATSAPP_LANGUAGE,
          variables: [recipientName, modality, time, therapistName],
        });

        if (result.ok) {
          await supabase.from("whatsapp_audit")
            .update({
              status: "sent",
              meta_message_id: result.messageId || null,
              raw_response: result.raw || null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", auditRow.id);
          // Only mark the session as WhatsApp-sent on success — a
          // failure (template not approved, throttled, bad phone)
          // should let the next cron tick retry.
          await supabase.from("sent_reminders").upsert(
            { session_id: session.id, user_id, channel: "whatsapp" },
            { onConflict: "session_id,user_id,channel" }
          );
        } else {
          await supabase.from("whatsapp_audit")
            .update({
              status: "failed",
              error_code: result.errorCode || null,
              error_reason: result.errorReason || null,
              raw_response: result.raw || null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", auditRow.id);
        }
      }));
    }

    // Piggy-back daily maintenance onto the every-5-min cron. The
    // claim-the-day update returns a row only when we won the race;
    // every other tick within the same 23h window returns nothing and
    // skips the work. Best-effort — a failure here must NOT 500 the
    // reminder run.
    try {
      await maybeRunDailyPurges(supabase);
    } catch (err) {
      console.warn("send-session-reminders: daily purge skipped:", err.message);
    }
    try {
      await maybeRunLifecycleEmails(supabase);
    } catch (err) {
      console.warn("send-session-reminders: lifecycle emails skipped:", err.message);
    }

    logRun({
      usersScanned: prefs.length,
      sessionsMatched: totalSessionsMatched,
      remindersSent: totalSent,
      subscriptionsCleaned: staleRemoved,
      startedAt,
    });
    res.status(200).json({ sent: totalSent, staleRemoved });
  } catch (err) {
    console.error("send-session-reminders error:", err);
    res.status(500).json({ error: "Internal error" });
  }
}

/* Run once-per-day maintenance jobs, gated by a row in `cron_state`.
   The claim is atomic — the conditional UPDATE … RETURNING returns a
   row only for the cron tick that wins the race for today. Everyone
   else exits immediately. */
async function maybeRunDailyPurges(supabase) {
  // 1. Stripe webhook events — keep ~30 days of history for forensic
  // replay; older rows are dead weight. The dedupe primary key is the
  // event id itself, not the timestamp, so trimming is purely a
  // storage-hygiene concern.
  const { data: claimed } = await supabase
    .from("cron_state")
    .update({ last_run_at: new Date().toISOString() })
    .eq("job", "purge_stripe_webhook_events")
    .or("last_run_at.is.null,last_run_at.lt." + new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString())
    .select("job")
    .maybeSingle();
  if (!claimed) return;

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error: purgeError, count } = await supabase
    .from("stripe_webhook_events")
    .delete({ count: "exact" })
    .lt("received_at", cutoff);
  if (purgeError) {
    console.warn("purge_stripe_webhook_events failed:", purgeError.message);
    return;
  }
  console.log(JSON.stringify({
    evt: "cron.purge_stripe_webhook_events",
    ts: new Date().toISOString(),
    purged: count ?? 0,
    cutoff,
  }));
}

/* Send lifecycle emails to users who hit a cohort window today.
   Same once-per-day claim pattern as the purge above — only one cron
   tick per UTC day actually runs the work. We page through users
   created in each cohort's window and dispatch via sendLifecycleEmail,
   which handles the per-user dedupe via lifecycle_emails(user_id, kind).

   Skips comp + admin users (the comp guard is implicit — they never
   need the trial nudges) and users who already have an active sub
   (they passed the trial gate; we don't winback them). */
async function maybeRunLifecycleEmails(supabase) {
  // Seed the cron_state row on first run so the conditional UPDATE
  // below finds something to claim. Idempotent — does nothing on a
  // re-run since the primary key already exists.
  await supabase.from("cron_state")
    .insert({ job: "lifecycle_emails", last_run_at: null })
    .select("job")
    .maybeSingle()
    .then(() => null, () => null);

  // Same once-per-day claim pattern as the purge above. Conditional
  // update returns a row ONLY for the cron tick that wins the race
  // for today; everyone else exits silently.
  const gateCutoff = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
  const { data: gate } = await supabase
    .from("cron_state")
    .update({ last_run_at: new Date().toISOString() })
    .eq("job", "lifecycle_emails")
    .or("last_run_at.is.null,last_run_at.lt." + gateCutoff)
    .select("job")
    .maybeSingle();
  if (!gate) return;

  // For each cohort, find users whose created_at falls in the window
  // [now - (daysSinceSignup + windowDays)d, now - daysSinceSignup·d]
  // who don't yet have a lifecycle_emails row for this kind.
  let totalSent = 0;
  for (const cohort of LIFECYCLE_COHORTS) {
    const upper = new Date(Date.now() - cohort.daysSinceSignup * 86_400_000).toISOString();
    const lower = new Date(Date.now() - (cohort.daysSinceSignup + cohort.windowDays) * 86_400_000).toISOString();

    // Pull eligible users in batches. supabase.auth.admin.listUsers
    // returns the auth.users page; we filter by created_at after the
    // fact since list params don't accept a range. 100/page, max two
    // pages — past 200 we've drifted from the cohort and the cron is
    // worth optimizing.
    let page = 1;
    const eligible = [];
    while (page <= 2) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
      if (error) { console.warn("listUsers:", error.message); break; }
      for (const u of (data?.users || [])) {
        if (!u.created_at) continue;
        if (u.created_at >= upper) continue;
        if (u.created_at < lower) continue;
        eligible.push(u);
      }
      if (!data?.users?.length || data.users.length < 100) break;
      page += 1;
    }
    if (eligible.length === 0) continue;

    // Drop users with active subs OR comp. They've already converted
    // (or been gifted access) and don't need the trial-stage email.
    // The winback cohort wants the OPPOSITE: users WITHOUT an active
    // sub get the email; everyone else is skipped.
    const userIds = eligible.map((u) => u.id);
    const { data: subs } = await supabase
      .from("user_subscriptions")
      .select("user_id, status, comp_granted, default_payment_method")
      .in("user_id", userIds);
    const subByUser = new Map((subs || []).map((s) => [s.user_id, s]));

    for (const u of eligible) {
      const s = subByUser.get(u.id);
      const hasActive = s && (
        s.comp_granted
        || s.status === "active"
        || s.status === "past_due"
        || (s.status === "trialing" && !!s.default_payment_method)
      );
      // Trial nudges (day-3, day-25): skip already-active users.
      // Winback (day-37): also skip already-active — winback is for
      // people who LET the trial lapse without converting. (A user
      // who subscribed late still gets the day-25 if their timer
      // matches but is in the active set; we skip them here.)
      if (hasActive) continue;

      const firstName = (u.user_metadata?.full_name || u.email?.split("@")[0] || "Hola").split(" ")[0];
      const result = await sendLifecycleEmail(supabase, {
        userId: u.id,
        email: u.email,
        firstName,
        kind: cohort.kind,
      });
      if (result.ok && result.sent) totalSent += 1;
    }
  }

  console.log(JSON.stringify({
    evt: "cron.lifecycle_emails",
    ts: new Date().toISOString(),
    sent: totalSent,
  }));
}

/**
 * Get a Date-like object representing "now" in the given timezone.
 * Returns a Date whose getHours/getMinutes/getDate/getMonth reflect
 * the local time in that timezone.
 */
function toTimezone(date, tz) {
  const str = date.toLocaleString("en-US", { timeZone: tz });
  return new Date(str);
}

function logRun({ usersScanned, sessionsMatched, remindersSent, subscriptionsCleaned, startedAt }) {
  console.log(JSON.stringify({
    evt: "cron.send-session-reminders",
    ts: new Date().toISOString(),
    usersScanned,
    sessionsMatched,
    remindersSent,
    subscriptionsCleaned,
    durationMs: Date.now() - startedAt,
  }));
}

function safeHost(u) {
  try { return new URL(u).host; } catch { return "?"; }
}

export default withSentry(handler, { name: "send-session-reminders" });
