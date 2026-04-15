/* Admin-only: fully delete a user account + all of their data.
   This is IRREVERSIBLE.

   Steps, in order, so storage never leaks:
     1) Fetch the user's document file paths
     2) Delete those files from R2
     3) Delete the auth.users row — DB cascades wipe all user data because
        every table has user_id references that would be orphaned, and we
        explicitly delete rows by user_id to be safe (RLS policies are
        per-table scoped to auth.uid() which won't exist after the auth
        row is gone)

   Body: { userId: uuid }
   Auth: caller must be the admin (email === ADMIN_EMAIL) */

import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { r2, BUCKET } from "./_r2.js";
import { requireAdmin, getServiceClient, isValidUserId } from "./_admin.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { userId } = req.body || {};
  if (!isValidUserId(userId)) return res.status(400).json({ error: "Invalid userId" });
  if (userId === admin.id) return res.status(400).json({ error: "Cannot delete yourself" });

  const svc = getServiceClient();

  try {
    // 1. Collect document file paths for this user so we can purge R2
    //    storage before the DB rows go. If document metadata has already
    //    been wiped (e.g. cascade from a previous partial run) we skip.
    const { data: docs } = await svc
      .from("documents")
      .select("file_path")
      .eq("user_id", userId);

    // 2. Delete R2 files. Failures are non-fatal — we'd rather leak a
    //    file than block the account deletion mid-flight. Each delete is
    //    independent so one failure doesn't abort the rest.
    if (docs?.length) {
      await Promise.all(
        docs
          .map(d => d.file_path)
          .filter(p => typeof p === "string" && p.startsWith(`${userId}/`))
          .map(path =>
            r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: path }))
              .catch(() => {})
          )
      );
    }

    // 3. Explicitly clear app tables scoped by user_id. The auth.users
    //    delete at step 4 does NOT cascade to these (they reference
    //    auth.users implicitly via RLS only), so we must remove them
    //    here or leave orphans.
    //    Order matters for child → parent FKs: documents, notes,
    //    payments, sessions, patients, bug_reports.
    const tables = ["documents", "notes", "payments", "sessions", "patients", "bug_reports"];
    for (const table of tables) {
      const { error } = await svc.from(table).delete().eq("user_id", userId);
      if (error) {
        return res.status(500).json({ error: `Failed to delete ${table}: ${error.message}` });
      }
    }

    // 4. Finally, remove the auth.users row.
    const { error: authErr } = await svc.auth.admin.deleteUser(userId);
    if (authErr) {
      return res.status(500).json({ error: authErr.message || "Auth deletion failed" });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Account deletion failed" });
  }
}
