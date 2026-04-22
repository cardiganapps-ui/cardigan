/* Normalize a user_metadata.avatar object into render props the
   <Avatar> component can consume. Pure function, no side effects —
   the network-backed signed-URL lookup for uploaded avatars lives
   in useAvatarUrl().

   Shape stored in user_metadata:
     { kind: "uploaded", value: "<userId>/profile/avatar-{ts}.jpg" }

   Returns:
     { kind: null }                      — no avatar / malformed / legacy
                                           preset values (preset gallery
                                           was removed; those fall back
                                           to initials).
     { kind: "uploaded", path: "…" }     — R2 object path; URL is
                                           resolved asynchronously by
                                           useAvatarUrl. */

export function resolveAvatar(avatar) {
  if (!avatar || typeof avatar !== "object") return { kind: null };
  if (avatar.kind === "uploaded" && typeof avatar.value === "string") {
    return { kind: "uploaded", path: avatar.value };
  }
  return { kind: null };
}
