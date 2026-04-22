/* Preset avatar gallery — intentionally empty.
   Artwork is in-progress; the picker shows a "coming soon"
   placeholder while this array is empty (see AvatarPicker).

   To ship presets: drop `<id>.svg` into public/avatars/ and add
   an entry here. The picker, avatarMeta, and useAvatarUrl already
   handle `{ kind: "preset", value: "<id>" }` — no other wiring
   needed. */

export const AVATAR_PRESETS = [];

const PRESET_IDS = new Set(AVATAR_PRESETS.map(p => p.id));

export function isPresetId(id) {
  return typeof id === "string" && PRESET_IDS.has(id);
}

export function presetUrl(id) {
  return isPresetId(id) ? `/avatars/${id}.svg` : null;
}
