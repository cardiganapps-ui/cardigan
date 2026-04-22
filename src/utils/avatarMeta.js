import { isPresetId, presetUrl } from "../data/avatarPresets";

/* Normalize a user_metadata.avatar object into render props the
   <Avatar> component can consume. Pure function, no side effects —
   the network-backed signed-URL lookup for uploaded avatars lives
   in useAvatarUrl().

   Shapes stored in user_metadata:
     { kind: "uploaded", value: "<userId>/profile/avatar-{ts}.jpg" }
     { kind: "preset",   value: "<preset-id>"                      }

   Returns:
     { kind: null }                      — no avatar / malformed /
                                           unknown preset id (falls
                                           back to initials).
     { kind: "uploaded", path: "…" }     — R2 object path; signed
                                           URL resolved by useAvatarUrl.
     { kind: "preset", url: "/avatars/…" } — static public asset. */

export function resolveAvatar(avatar) {
  if (!avatar || typeof avatar !== "object") return { kind: null };
  if (avatar.kind === "uploaded" && typeof avatar.value === "string") {
    return { kind: "uploaded", path: avatar.value };
  }
  if (avatar.kind === "preset" && isPresetId(avatar.value)) {
    return { kind: "preset", url: presetUrl(avatar.value) };
  }
  return { kind: null };
}
