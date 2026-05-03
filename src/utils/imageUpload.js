/* ── Avatar upload helpers ───────────────────────────────────────────
   Path-builder for the R2 object key of a user's profile photo. The
   actual image processing (decode + crop + JPEG encode) lives in
   src/components/AvatarCropEditor.jsx — the cropper is the source of
   truth for the final blob, so a centralised resize helper would
   only duplicate logic and create a second framing path that could
   drift away from what the user sees in the cropper. */

/* Build the R2 object path for a profile avatar. The timestamp suffix
   is the cache-bust — callers who view the image immediately after
   upload get the new bytes without any CDN / browser-cache stickiness.
   The `userId/` prefix is required by the validatePath guard in
   api/_r2.js. */
export function avatarPath(userId, timestamp = Date.now()) {
  if (!userId) throw new Error("no_user_id");
  return `${userId}/profile/avatar-${timestamp}.jpg`;
}
