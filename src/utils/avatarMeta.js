/* Normalize a user_metadata.avatar object into render props the
   <Avatar> component can consume. Pure function, no side effects —
   the network-backed signed-URL lookup for uploaded avatars lives
   in useAvatarUrl().

   Shape:
     { kind: "preset",   value: "preset:sprig-01" }
     { kind: "uploaded", value: "<userId>/profile/avatar-{ts}.jpg" }

   Returns:
     { kind: null }                      — no avatar / malformed
     { kind: "preset", presetId: "…" }   — a preset by id
     { kind: "uploaded", path: "…" }     — R2 object path; URL is
                                           resolved asynchronously
                                           by useAvatarUrl. */

export function resolveAvatar(avatar) {
  if (!avatar || typeof avatar !== "object") return { kind: null };
  if (avatar.kind === "preset" && typeof avatar.value === "string") {
    const id = avatar.value.startsWith("preset:")
      ? avatar.value.slice("preset:".length)
      : avatar.value;
    return { kind: "preset", presetId: id };
  }
  if (avatar.kind === "uploaded" && typeof avatar.value === "string") {
    return { kind: "uploaded", path: avatar.value };
  }
  return { kind: null };
}
