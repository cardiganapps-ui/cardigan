import {
  getServiceClient,
  sendPush,
  verifyCronSecret,
  formatShortDate,
  formatShortDateLegacy,
  isInQuietHours,
  TERMINAL_PUSH_STATUSES,
} from "./_push.js";
import { withSentry } from "./_sentry.js";
import { getFlag } from "./_flags.js";
import { sendTemplate, toE164MX } from "./_whatsapp.js";
import {
  evaluateTutorReminders,
  buildTutorPushPayload,
  tzTodayIso,
} from "./_tutorReminders.js";
import { sendLifecycleEmail } from "./_lifecycle.js";
import { fetchPartiesForRequest } from "./_rescheduleRequest.js";
import { sendRescheduleExpiredEmails } from "./_sessionEmail.js";
import {
  cohortWindow,
  isInCohortWindow,
  firstPaidByUser,
  hasActiveSubscription,
} from "./_cohorts.js";

// Lifecycle email cohorts. Each is "exactly N days after the anchor
// event, with a one-day grace window so a cron tick that misses the
// window still catches the user the next day." The cron writes a
// dedupe row per (user, kind), so a user whose tick lands on day 4
// still only gets the day-3 email once.
//
// `anchor` selects the timestamp the cohort measures from:
//   "signup" — auth.users.created_at (default — original behaviour)
//   "paid"   — MIN(stripe_invoices.paid_at) for that user. Skipped
//              for users without a paid invoice yet, so trial users
//              never receive paid-anchored cohorts.
const LIFECYCLE_COHORTS = [
  { kind: "trial_day_3",          anchor: "signup", daysSince: 3,   windowDays: 2 },
  { kind: "trial_day_25",         anchor: "signup", daysSince: 25,  windowDays: 2 },
  { kind: "trial_winback_day_37", anchor: "signup", daysSince: 37,  windowDays: 2 },
  { kind: "rating_request_day14", anchor: "signup", daysSince: 14,  windowDays: 2 },
  { kind: "referral_nudge_v1",    anchor: "paid",   daysSince: 14,  windowDays: 2 },
  { kind: "referral_nudge_v2",    anchor: "paid",   daysSince: 59,  windowDays: 2 },
  { kind: "referral_nudge_v3",    anchor: "paid",   daysSince: 104, windowDays: 2 },
];

// Cohort kinds that are part of the "engagement program" — silenced
// by the lifecycle_extra_paused Edge Config flag without affecting the
// trial-stage cohorts.
//
// Note: an earlier draft also fired push notifications 2 days before
// each referral email, but the user opted into push via "Recordatorios
// de sesión" — using that subscription for marketing nudges sat on the
// wrong side of the LFPDPPP "finalidad" line. Reverted to email-only
// here; the push branch is preserved in git history for the day we
// add a separate per-user opt-in.
const EXTRA_PROGRAM_PREFIXES = ["referral_nudge_", "rating_request_"];
function isExtraProgram(kind) {
  return EXTRA_PROGRAM_PREFIXES.some((p) => kind.startsWith(p));
}

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
    let tutorPushesSent = 0;

    for (const pref of prefs) {
      const { user_id, reminder_minutes = 30, timezone = "America/Mexico_City" } = pref;

      // 2. Compute "now" and "target time" in the user's timezone
      const now = new Date();
      const userNow = toTimezone(now, timezone);
      const todayShort = formatShortDate(userNow);
      const todayShortLegacy = formatShortDateLegacy(userNow);

      // Resolve the user's role for this loop. A user_id is either:
      //   - therapist  → sessions match by sessions.user_id
      //   - patient    → sessions match by patient_id IN (linked
      //                  patient rows where patient_user_id = user_id
      //                  AND status IN active/potential — same gate
      //                  the patient-side RLS uses, so a discarded
      //                  patient stops getting reminders too)
      // The dual-role edge case (therapist also linked to a patient
      // row in their own tenant) is exceedingly rare and falls into
      // the "patient" branch by precedence; that's fine — they'd
      // still see the right sessions because the patient row's
      // therapist IS them.
      const { data: linkedPatients } = await supabase
        .from("patients")
        .select("id")
        .eq("patient_user_id", user_id)
        .in("status", ["active", "potential"]);
      const isPatient = (linkedPatients?.length || 0) > 0;
      const linkedPatientIds = (linkedPatients || []).map((p) => p.id);

      // 3. Fetch today's scheduled sessions. Branch by role; the
      // WhatsApp branch below applies only to therapists (the patient
      // already gets a direct push, so we skip the patient-→-patient
      // WhatsApp loop to avoid double-buzzing).
      const baseSelect = "id, patient_id, patient, time, initials, modality, user_id, session_type";
      const sessionsQuery = isPatient
        ? supabase
            .from("sessions")
            .select(baseSelect)
            .in("patient_id", linkedPatientIds)
            .in("date", [todayShort, todayShortLegacy])
            .eq("status", "scheduled")
        : supabase
            .from("sessions")
            .select(baseSelect)
            .eq("user_id", user_id)
            .in("date", [todayShort, todayShortLegacy])
            .eq("status", "scheduled");
      const { data: sessions, error: sessError } = await sessionsQuery;

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
        // Patient-side copy speaks first-person ("tu sesión...") and
        // routes to the patient home rather than the therapist's
        // agenda. Therapist-side copy stays as-is.
        const payload = isPatient
          ? {
              title: "Recordatorio de sesión",
              body: `Tu sesión es a las ${session.time} — en ${minutesUntil} min`,
              url: "/",
              tag: `session-${session.id}`,
              actions: [{ action: "open", title: "Ver detalles" }],
            }
          : {
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

      // ── Tutor-session reminders ────────────────────────────────
      // Therapist-only, opt-in via the same notification_preferences
      // flag that gates session reminders (one mental model per user
      // direction). Fires push when a minor patient's tutor session is
      // due today AND nothing's scheduled, plus a single follow-up at
      // day 7 overdue. Gated by the polite-hours window so a "due
      // today" reminder lands during working hours, not at 1am.
      if (!isPatient && !isInQuietHours(timezone, now)) {
        try {
          const tutorSent = await sendTutorReminders({ supabase, userId: user_id, timezone, now });
          tutorPushesSent += tutorSent;
        } catch (err) {
          console.warn(`tutor-reminders: ${user_id} failed:`, err?.message);
        }
      }

      // ── WhatsApp branch ────────────────────────────────────────
      // Runs for every THERAPIST user, regardless of push outcome.
      // Patients opt in per-row via patients.whatsapp_enabled. Each
      // (session, 'whatsapp') is deduped via sent_reminders. A
      // failed Meta send does NOT write a sent_reminders row —
      // the next cron tick retries.
      //
      // Skipped entirely for patient-side cron iterations: the
      // patient already got a direct push above; sending a
      // WhatsApp message to themselves on top would be a double-
      // buzz. The therapist-side branch still fires WhatsApp for
      // all THEIR opted-in patients (this is the original flow).
      if (isPatient) continue;
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

    // ── Expire pending reschedule requests ──
    // Sweeps rows where status='pending' AND expires_at < now(),
    // marks them expired, fires emails to both parties so the
    // patient's session stays at its original time without anyone
    // wondering what happened. expires_at was set at creation to
    // 1h before the earliest of (original, proposed) start time.
    try {
      await maybeExpireRescheduleRequests(supabase);
    } catch (err) {
      console.warn("send-session-reminders: reschedule expiry skipped:", err.message);
    }

    logRun({
      usersScanned: prefs.length,
      sessionsMatched: totalSessionsMatched,
      remindersSent: totalSent,
      tutorPushesSent,
      subscriptionsCleaned: staleRemoved,
      startedAt,
    });
    res.status(200).json({ sent: totalSent, tutorPushesSent, staleRemoved });
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

  // 2. Rate-limit hits — only need ~24h of history to power any
  // window we currently use (longest window is 60s; 24h is over-
  // provisioned but harmless). Same claim-the-day pattern.
  const { data: rlGate } = await supabase
    .from("cron_state")
    .update({ last_run_at: new Date().toISOString() })
    .eq("job", "purge_rate_limits")
    .or("last_run_at.is.null,last_run_at.lt." + new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString())
    .select("job")
    .maybeSingle();
  if (!rlGate) return;
  const rlCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { error: rlError, count: rlCount } = await supabase
    .from("rate_limits")
    .delete({ count: "exact" })
    .lt("hit_at", rlCutoff);
  if (rlError) {
    console.warn("purge_rate_limits failed:", rlError.message);
    return;
  }
  console.log(JSON.stringify({
    evt: "cron.purge_rate_limits",
    ts: new Date().toISOString(),
    purged: rlCount ?? 0,
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

  // Edge Config kill switch for the new engagement-program cohorts.
  // When true, only the original trial cohorts (signup-anchored,
  // pre-existing kinds) run — referral + rating program goes silent.
  const extraPaused = await getFlag("lifecycle_extra_paused");

  let totalSent = 0;
  for (const cohort of LIFECYCLE_COHORTS) {
    if (extraPaused && isExtraProgram(cohort.kind)) continue;

    const eligible = await loadEligibleForCohort(supabase, cohort);
    if (eligible.length === 0) continue;

    // Hydrate sub state in one call so the per-user filter below is
    // fast even for the bigger paid-anchored cohorts.
    const userIds = eligible.map((e) => e.user.id);
    const { data: subs } = await supabase
      .from("user_subscriptions")
      .select("user_id, status, comp_granted, default_payment_method, referral_rewards_count")
      .in("user_id", userIds);
    const subByUser = new Map((subs || []).map((s) => [s.user_id, s]));

    for (const { user: u } of eligible) {
      const s = subByUser.get(u.id);
      const hasActive = hasActiveSubscription(s);

      if (cohort.anchor === "paid") {
        // Paid-anchored cohorts (referral nudges) require an active
        // sub by definition — `loadEligibleForCohort` already filtered
        // on stripe_invoices, but a user who lapsed since their first
        // payment would still match. Belt-and-suspenders.
        if (!hasActive) continue;
        if (s?.comp_granted) continue;
        // Cap referral nudges at 3 lifetime sends — power-advocates
        // don't need yet another reminder.
        if ((s?.referral_rewards_count || 0) >= 3) continue;
      } else {
        // signup-anchored:
        // Trial nudges (day-3, day-25): skip already-active users.
        // Winback (day-37): also skip already-active — winback is for
        // people who LET the trial lapse without converting.
        // Rating (day-14): we WANT both trial and active users —
        // active users are the most-credible raters.
        if (cohort.kind !== "rating_request_day14" && hasActive) continue;
        // Rating: don't include comp users (admins) — they're not the
        // target audience for a 1-5 user-feedback prompt.
        if (cohort.kind === "rating_request_day14" && s?.comp_granted) continue;
      }

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

/* Sweep pending reschedule requests whose expires_at is in the past
   and mark them expired. Fires emails to both parties so they know
   the session stays at its original time. Idempotent: a row that's
   already non-pending won't be touched (the WHERE clause keeps the
   transition single-shot).

   Runs inside the 5-min reminders cron — the cadence is finer-
   grained than the request lifecycle needs (expiry tolerance is
   measured in minutes, not seconds), so reusing the existing tick
   beats spinning up a separate job.

   Per-row error handling: a single bad row (missing patient, deleted
   therapist auth) doesn't sink the whole sweep — we log and move on.
*/
async function maybeExpireRescheduleRequests(supabase) {
  const nowIso = new Date().toISOString();

  // Pull the candidate set first so we can email parties BEFORE the
  // status flip — the helper that fetches the patient + therapist
  // contact info uses the request's user_id (therapist) and
  // patient_id, which are still on the row regardless of status.
  // Doing it after the update would also work; pulling first lets
  // us include the original details cleanly in the email body.
  const { data: rows, error: selErr } = await supabase
    .from("session_reschedule_requests")
    .select("*")
    .eq("status", "pending")
    .lt("expires_at", nowIso)
    .limit(200);
  if (selErr) {
    console.warn("expireReschedule: select failed:", selErr.message);
    return { expired: 0 };
  }
  if (!rows || rows.length === 0) return { expired: 0 };

  let expired = 0;
  for (const row of rows) {
    // Compare-and-set on status='pending' → if the row was resolved
    // through another path between SELECT and UPDATE, we no-op.
    const { data: updated, error: updErr } = await supabase
      .from("session_reschedule_requests")
      .update({
        status: "expired",
        resolved_at: nowIso,
        resolved_by: "auto_expire",
        approve_token: null,
        reject_token: null,
      })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (updErr || !updated) continue; // race-lost or db error → skip

    try {
      const parties = await fetchPartiesForRequest(supabase, row);
      await sendRescheduleExpiredEmails({
        ...parties,
        oldDate: row.original_date,
        oldTime: row.original_time,
        newDate: row.proposed_date,
        newTime: row.proposed_time,
      });
    } catch (err) {
      console.warn(`expireReschedule: email for ${row.id} failed:`, err?.message);
    }
    expired += 1;
  }

  if (expired > 0) {
    console.log(JSON.stringify({
      evt: "cron.reschedule-expire",
      ts: new Date().toISOString(),
      expired,
    }));
  }
  return { expired };
}

/* Resolve users eligible for a cohort by anchor type. Returns
   [{ user, anchorAt }] so callers can inspect both the auth row
   and the timestamp the daysSince math was applied to. */
async function loadEligibleForCohort(supabase, cohort) {
  const { lower, upper } = cohortWindow(cohort.daysSince, cohort.windowDays);

  if (cohort.anchor === "paid") {
    // First-paid timestamp comes from stripe_invoices. We aggregate
    // client-side to keep the SQL boring (no GROUP BY through PostgREST).
    // Rows are ordered cheap by paid_at and we take the earliest per
    // user. Bound the read to recent windows so the table doesn't grow
    // into the query — a year of room past the latest cohort.
    const oldest = new Date(Date.now() - 366 * 86_400_000).toISOString();
    const { data: invoices, error } = await supabase
      .from("stripe_invoices")
      .select("user_id, paid_at")
      .gte("paid_at", oldest)
      .order("paid_at", { ascending: true });
    if (error) {
      console.warn("loadEligibleForCohort(paid):", error.message);
      return [];
    }
    const paidByUser = firstPaidByUser(invoices);
    const matchedUserIds = [];
    for (const [uid, paidAt] of paidByUser) {
      if (!isInCohortWindow(paidAt, lower, upper)) continue;
      matchedUserIds.push({ uid, paidAt });
    }
    if (matchedUserIds.length === 0) return [];

    // Resolve auth.users for the matched ids.
    const usersById = await listUsersIndexed(supabase);
    const out = [];
    for (const { uid, paidAt } of matchedUserIds) {
      const u = usersById.get(uid);
      if (!u) continue;
      out.push({ user: u, anchorAt: paidAt });
    }
    return out;
  }

  // signup anchor: list auth.users and filter by created_at window.
  const usersById = await listUsersIndexed(supabase);
  const out = [];
  for (const u of usersById.values()) {
    if (!isInCohortWindow(u.created_at, lower, upper)) continue;
    out.push({ user: u, anchorAt: u.created_at });
  }
  return out;
}

/* Cache the auth.users listing for the duration of one cron tick.
   The cron processes multiple cohorts and we don't want to hammer
   listUsers once per cohort. 200 rows is the working cap — past that
   the cron's worth optimizing into a paged scan. */
let _usersCache = null;
let _usersCacheAt = 0;
// Hard upper bound on the auth.users list — defends against a runaway
// pagination loop while still leaving plenty of headroom for years of
// growth. At 10000 users + ~2KB per row the in-memory map is ~20MB,
// well under Vercel's 1024MB function ceiling. Past 10k we'd want to
// query by created_at window directly via the Management API.
const LIST_USERS_HARD_CAP = 10000;
const LIST_USERS_PAGE_SIZE = 100;

async function listUsersIndexed(supabase) {
  // 60s window = a single cron tick. Past that we re-query so a fresh
  // signup mid-deploy still surfaces in the next tick.
  if (_usersCache && Date.now() - _usersCacheAt < 60_000) return _usersCache;
  const out = new Map();
  let page = 1;
  while (out.size < LIST_USERS_HARD_CAP) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: LIST_USERS_PAGE_SIZE,
    });
    if (error) { console.warn("listUsers:", error.message); break; }
    const rows = data?.users || [];
    for (const u of rows) out.set(u.id, u);
    // Last page reached — supabase-js returns < perPage when the next
    // page would be empty.
    if (rows.length < LIST_USERS_PAGE_SIZE) break;
    page += 1;
  }
  if (out.size >= LIST_USERS_HARD_CAP) {
    console.warn(JSON.stringify({
      evt: "listUsersIndexed.cap_reached",
      cap: LIST_USERS_HARD_CAP,
    }));
  }
  _usersCache = out;
  _usersCacheAt = Date.now();
  return out;
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

/* Per-user tutor reminder branch. Pulls the tutor-eligible patients
   (those with a parent + tutor_frequency), the patient's tutor
   sessions (session_type='tutor', back to today's anchor at most), and
   the existing sent_tutor_reminders rows so the pure evaluator can
   make the decision. Sends push for each tuple it returns and writes
   a dedupe row per send. A push failure on the sender side does NOT
   write the dedupe row — the next cron tick will retry.

   Patient-side cron iterations are skipped at the caller (tutor
   sessions are with the parent, not the patient — sending the patient
   a "you're overdue" buzz would be a category error). */
async function sendTutorReminders({ supabase, userId, timezone, now }) {
  const todayIso = tzTodayIso(timezone, now);
  let sent = 0;

  // 1. Therapist's tutor-eligible patients. Status filter mirrors
  //    getTutorReminders in src/utils/sessions.js — only active
  //    patients with both `parent` and `tutor_frequency` participate.
  const { data: patients } = await supabase
    .from("patients")
    .select("id, name, parent, tutor_frequency, status, start_date, created_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .not("parent", "is", null)
    .neq("parent", "")
    .not("tutor_frequency", "is", null);
  if (!patients || patients.length === 0) return sent;

  const patientIds = patients.map((p) => p.id);

  // 2. Tutor sessions for those patients. We need both completed/
  //    charged (to anchor the cycle) AND scheduled-future (to know
  //    whether the therapist has already acted on the reminder). The
  //    cron's read volume is bounded by the user's patient count, not
  //    history depth.
  const { data: tutorSessions } = await supabase
    .from("sessions")
    .select("id, patient_id, date, status, session_type, initials")
    .eq("user_id", userId)
    .in("patient_id", patientIds)
    .or("session_type.eq.tutor,initials.like.T·%");
  const tutorSessionRows = tutorSessions || [];

  // 3. Existing dedupe rows for these patients — read once, filter
  //    in-memory in the evaluator. Bounded by patient count * 2 kinds.
  const { data: sentRows } = await supabase
    .from("sent_tutor_reminders")
    .select("patient_id, kind, cycle_anchor_date")
    .eq("user_id", userId)
    .in("patient_id", patientIds);
  const alreadySent = new Set(
    (sentRows || []).map((r) => `${r.patient_id}::${r.kind}::${r.cycle_anchor_date}`)
  );

  const toSend = evaluateTutorReminders({
    patients,
    tutorSessions: tutorSessionRows,
    alreadySent,
    todayIso,
  });
  if (toSend.length === 0) return sent;

  // 4. Subscriptions — same shape the session reminder branch uses.
  //    Missing subscriptions = no push; we still write the dedupe row
  //    afterwards so the user doesn't get pinged immediately when they
  //    add a subscription mid-cycle (matches session-reminder UX).
  const { data: subsRaw } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);
  const subs = subsRaw || [];
  if (subs.length === 0) return sent;

  for (const tuple of toSend) {
    const payload = buildTutorPushPayload(tuple);
    let anyDelivered = false;
    for (const sub of subs) {
      try {
        await sendPush(sub, payload);
        anyDelivered = true;
      } catch (err) {
        if (TERMINAL_PUSH_STATUSES.has(err.statusCode)) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        } else {
          console.error(JSON.stringify({
            evt: "tutor-push.send.error",
            endpoint_host: safeHost(sub.endpoint),
            statusCode: err.statusCode,
            message: err.message,
          }));
        }
      }
    }
    // Mark deduped only when at least one push went out. A total
    // delivery failure (every sub returned a terminal error) leaves
    // the row eligible; the next tick will retry once the user
    // resubscribes.
    if (anyDelivered) {
      await supabase.from("sent_tutor_reminders").upsert(
        {
          user_id: userId,
          patient_id: tuple.patient.id,
          kind: tuple.kind,
          cycle_anchor_date: tuple.cycleAnchor,
        },
        { onConflict: "user_id,patient_id,kind,cycle_anchor_date" }
      );
      sent += 1;
    }
  }
  return sent;
}

function logRun({ usersScanned, sessionsMatched, remindersSent, tutorPushesSent, subscriptionsCleaned, startedAt }) {
  console.log(JSON.stringify({
    evt: "cron.send-session-reminders",
    ts: new Date().toISOString(),
    usersScanned,
    sessionsMatched,
    remindersSent,
    tutorPushesSent,
    subscriptionsCleaned,
    durationMs: Date.now() - startedAt,
  }));
}

function safeHost(u) {
  try { return new URL(u).host; } catch { return "?"; }
}

export default withSentry(handler, { name: "send-session-reminders" });
