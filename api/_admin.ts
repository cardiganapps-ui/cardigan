/* ── Shared helpers for admin-only API routes ──
   Every admin endpoint must:
   1) Verify the caller's JWT is valid (getAuthUser)
   2) Confirm that user's email matches ADMIN_EMAIL
   3) Use the service-role client for privileged operations

   The service-role key bypasses RLS and has access to auth.users admin
   APIs, so it MUST only be instantiated server-side. Never ship it to the
   browser. */

import { createClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const ADMIN_EMAIL = "gaxioladiego@gmail.com";

export async function getAuthUser(req: Row): Promise<Row> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const supabase = createClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_ANON_KEY ?? ""
  );
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

export async function requireAdmin(req: Row, res: Row): Promise<Row> {
  const user = await getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (user.email !== ADMIN_EMAIL) {
    // Intentionally generic message so this endpoint doesn't confirm to a
    // probing caller whether they passed the auth check.
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return user;
}

export function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Be specific about which var is missing so the admin knows what to
  // fix in Vercel. Also trim: a trailing newline in the pasted value
  // will pass the truthy check but break createClient downstream.
  const missing: string[] = [];
  if (!url || !url.trim()) missing.push("SUPABASE_URL");
  if (!key || !key.trim()) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) {
    throw new Error(`Missing env var(s): ${missing.join(", ")}`);
  }
  return createClient(url!.trim(), key!.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* ── logAuditEvent ─────────────────────────────────────────────────────
   Append an immutable row to admin_audit_log. Called by every
   /api/admin-* endpoint AFTER the primary action has succeeded, so a
   logging failure can never block the user-visible operation
   (compliance trade-off: prefer "succeeded but audit missed" over
   "blocked because audit table was briefly unreachable").

   Reads IP + UA from request headers (best-effort). The table has no
   INSERT policy — only the service-role client can write, which is
   exactly what we have here. */
export async function logAuditEvent(svc: Row, { actorId, targetUserId, action, payload, req }: Row = {}): Promise<void> {
  if (!svc || !actorId || !action) return;
  try {
    const ip = req
      ? (req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || null)
      : null;
    const ua = req?.headers?.["user-agent"] || null;
    await svc.from("admin_audit_log").insert({
      actor_id: actorId,
      target_user_id: targetUserId || null,
      action,
      payload: payload || null,
      ip,
      ua,
    });
  } catch (err: Row) {
    // Swallowed by design — never fail the parent endpoint on audit
    // table unavailability. Vercel function logs will show it.
    console.warn("audit log write failed:", err?.message);
  }
}

export function isValidUserId(id: Row): boolean {
  // UUID v4-ish validation to guard against malformed input that could
  // slip into SQL filters or admin API calls.
  return typeof id === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/* ── deleteUserCascade ────────────────────────────────────────────────
   Full cascade of a user account: R2 documents, every app-table row
   scoped to user_id, and finally the auth.users row. Shared between
   admin-delete-user.js (admin action) and delete-my-account.js (ARCO
   "Cancelación" — user-triggered). Factoring it here means both flows
   are guaranteed to wipe the same data in the same order; they cannot
   drift.

   Caller is responsible for:
     - Verifying the caller's JWT (admin: requireAdmin, self: getAuthUser + match)
     - Providing an already-instantiated service client
     - Deciding what to do on error (we return the first failing table
       name so the caller can surface a precise message).

   Optional `tombstone` writes an account_deletions row before wiping
   auth — pass the user's email and a short reason string. */
export async function deleteUserCascade({ svc, r2Client, bucket, userId, tombstone }: Row = {}): Promise<Row> {
  if (!svc || !userId) throw new Error("svc and userId are required");

  // 1. R2 documents (best-effort; don't abort on failures).
  if (r2Client && bucket) {
    const { data: docs } = await svc
      .from("documents")
      .select("file_path")
      .eq("user_id", userId);
    if (docs?.length) {
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      await Promise.all(
        docs
          .map((d: Row) => d.file_path)
          .filter((p: Row) => typeof p === "string" && p.startsWith(`${userId}/`))
          .map((path: string) =>
            r2Client
              .send(new DeleteObjectCommand({ Bucket: bucket, Key: path }))
              .catch(() => {})
          )
      );
    }
  }

  // 2. Tombstone row (best-effort — missing table should not block deletion).
  if (tombstone) {
    await svc.from("account_deletions").insert({
      user_id: userId,
      email: tombstone.email || null,
      reason: tombstone.reason || null,
    }).then(() => {}, () => {});
  }

  // 3. App tables, child → parent. `user_consents`, `export_audit`, and
  //    `account_deletions` are excluded: the first two cascade via FK
  //    (on delete cascade on auth.users); account_deletions intentionally
  //    survives the auth row's deletion as an audit record.
  const tables = [
    "documents",
    "notes",
    "payments",
    "sessions",
    "group_members",
    "groups",
    "patients",
    "bug_reports",
  ];
  for (const table of tables) {
    const { error } = await svc.from(table).delete().eq("user_id", userId);
    if (error) {
      return { ok: false, failedTable: table, error: error.message };
    }
  }

  // 4. auth.users row.
  const { error: authErr } = await svc.auth.admin.deleteUser(userId);
  if (authErr) {
    return { ok: false, failedTable: "auth.users", error: authErr.message };
  }

  return { ok: true };
}
