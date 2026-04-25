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
      const { data: sessions, error: sessError } = await supabase
        .from("sessions")
        .select("id, patient, time, initials")
        .eq("user_id", user_id)
        .in("date", [todayShort, todayShortLegacy])
        .eq("status", "scheduled");

      if (sessError || !sessions || sessions.length === 0) continue;

      // 4. Filter sessions within the reminder window
      const nowMinutes = userNow.getHours() * 60 + userNow.getMinutes();
      const sessionsToNotify = sessions.filter((s) => {
        const [h, m] = s.time.split(":").map(Number);
        const sessionMinutes = h * 60 + m;
        const diff = sessionMinutes - nowMinutes;
        // Send reminder if session is between 0 and reminder_minutes from now
        // (i.e., session hasn't started yet but is within the window)
        return diff > 0 && diff <= reminder_minutes;
      });

      if (sessionsToNotify.length === 0) continue;

      // 5. Check which sessions already have sent reminders
      const sessionIds = sessionsToNotify.map((s) => s.id);
      const { data: alreadySent } = await supabase
        .from("sent_reminders")
        .select("session_id")
        .eq("user_id", user_id)
        .in("session_id", sessionIds);

      const sentSet = new Set((alreadySent || []).map((r) => r.session_id));
      const newSessions = sessionsToNotify.filter((s) => !sentSet.has(s.id));

      if (newSessions.length === 0) continue;

      totalSessionsMatched += newSessions.length;

      // 6. Fetch push subscriptions for this user
      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth")
        .eq("user_id", user_id);

      if (!subs || subs.length === 0) continue;

      // 7. Send push notifications
      for (const session of newSessions) {
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

        // 8. Mark session as notified
        await supabase.from("sent_reminders").upsert(
          { session_id: session.id, user_id },
          { onConflict: "session_id,user_id" }
        );

        totalSent++;
      }
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
