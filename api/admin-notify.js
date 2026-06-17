/* Admin-only: write a 'system' notification into users' in-app inboxes.
   This is the system-message path for the notification inbox (migration
   077) — announcements, account notices, etc. Rows are inserted via the
   service-role client (bypasses RLS, which has no user INSERT policy).

   Body: { title, body?, url?, userId?, broadcast? }
     • broadcast: true → insert for every user (paged)
     • userId: uuid     → insert for a single user
   Auth: caller must be the admin (email === ADMIN_EMAIL). */

import { requireAdmin, getServiceClient, isValidUserId, logAuditEvent } from "./_admin.js";
import { withSentry } from "./_sentry.js";

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const admin = await requireAdmin(req, res);
  if (!admin) return; // response already written

  const { userId, broadcast, title, body, url } = req.body || {};
  const cleanTitle = typeof title === "string" ? title.trim() : "";
  const cleanBody = typeof body === "string" ? body.trim() : "";
  if (!cleanTitle) return res.status(400).json({ error: "title required" });
  if (cleanTitle.length > 120) return res.status(400).json({ error: "title too long (max 120)" });
  if (cleanBody.length > 1000) return res.status(400).json({ error: "body too long (max 1000)" });
  const cleanUrl = typeof url === "string" && url.trim() ? url.trim().slice(0, 300) : "/";
  if (!broadcast && !isValidUserId(userId)) {
    return res.status(400).json({ error: "Provide a valid userId or broadcast: true" });
  }

  let svc;
  try {
    svc = getServiceClient();
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Service client unavailable" });
  }

  const row = (uid) => ({ user_id: uid, kind: "system", title: cleanTitle, body: cleanBody, url: cleanUrl });

  let inserted = 0;
  if (broadcast) {
    // Page through every auth user and insert in batches. Modest user
    // counts for now; perPage 1000 keeps this to a couple of round-trips.
    let page = 1;
    for (;;) {
      const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) return res.status(500).json({ error: "listUsers failed", detail: error.message });
      const users = data?.users || [];
      if (users.length === 0) break;
      const { error: insErr } = await svc.from("notifications").insert(users.map((u) => row(u.id)));
      if (insErr) return res.status(500).json({ error: "insert failed", detail: insErr.message });
      inserted += users.length;
      if (users.length < 1000) break;
      page += 1;
    }
  } else {
    const { error: insErr } = await svc.from("notifications").insert(row(userId));
    if (insErr) return res.status(500).json({ error: "insert failed", detail: insErr.message });
    inserted = 1;
  }

  await logAuditEvent(svc, {
    actorId: admin.id,
    targetUserId: broadcast ? null : userId,
    action: "send_notification",
    payload: { broadcast: !!broadcast, inserted, title: cleanTitle },
    req,
  });
  return res.status(200).json({ ok: true, inserted });
}

export default withSentry(handler, { name: "admin-notify" });
