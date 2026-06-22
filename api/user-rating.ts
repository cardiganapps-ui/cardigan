/* ── POST /api/user-rating ──
   Stamps a row in public.user_ratings for the authenticated caller.
   Used by components/RatingSheet.jsx after the user picks a star
   count and optionally writes a comment.

   Body: { promptKind: string, stars: 1-5, comment?: string }
   Auth: standard JWT (NOT admin-only).

   Idempotent: upsert on (user_id, prompt_kind) so the user can
   re-submit the same prompt; latest answer wins. */

import { getAuthUser } from "./_r2.js";
import { getServiceClient } from "./_admin.js";
import { withSentry } from "./_sentry.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const MAX_COMMENT_LEN = 2000;

async function handler(req: Row, res: Row) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { promptKind, stars, comment } = req.body || {};
  if (typeof promptKind !== "string" || promptKind.length === 0 || promptKind.length > 64) {
    return res.status(400).json({ error: "Invalid promptKind" });
  }
  // Stars: integer 1-5. JS sends numbers; Number(x) handles a stray
  // string from a misconfigured client without rejecting outright.
  const starsNum = Number(stars);
  if (!Number.isInteger(starsNum) || starsNum < 1 || starsNum > 5) {
    return res.status(400).json({ error: "Invalid stars (1-5 required)" });
  }
  // Comment is optional. Trim + truncate so a paste-bomb doesn't sit
  // forever in the DB. The UI also enforces a soft limit but defense
  // in depth is cheap.
  let cleanComment = null;
  if (comment != null) {
    if (typeof comment !== "string") {
      return res.status(400).json({ error: "Comment must be a string" });
    }
    const trimmed = comment.trim();
    if (trimmed.length > 0) {
      cleanComment = trimmed.slice(0, MAX_COMMENT_LEN);
    }
  }

  const svc = getServiceClient();
  const { error } = await svc
    .from("user_ratings")
    .upsert(
      {
        user_id: user.id,
        prompt_kind: promptKind,
        stars: starsNum,
        comment: cleanComment,
        created_at: new Date().toISOString(),
      },
      { onConflict: "user_id,prompt_kind", ignoreDuplicates: false }
    );
  if (error) {
    return res.status(500).json({ error: "Failed to record rating" });
  }
  return res.status(200).json({ ok: true });
}

export default withSentry(handler, { name: "user-rating" });
