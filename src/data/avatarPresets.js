/* Preset avatar gallery — intentionally empty.
   Artwork is in-progress; the picker shows a "coming soon"
   placeholder while this array is empty (see AvatarPicker).

   To ship presets: drop `<id>.svg` into public/avatars/ and add
   an entry here. The picker, avatarMeta, and useAvatarUrl already
   handle `{ kind: "preset", value: "<id>" }` — no other wiring
   needed. */

export const AVATAR_PRESETS = [
  { id: "perrito",  labelKey: "avatar.preset.perrito" },
  { id: "gatito",   labelKey: "avatar.preset.gatito" },
  { id: "plantita", labelKey: "avatar.preset.plantita" },
  { id: "aguacate", labelKey: "avatar.preset.aguacate" },
  { id: "cafecito", labelKey: "avatar.preset.cafecito" },
  { id: "nube",     labelKey: "avatar.preset.nube" },
  { id: "osito",    labelKey: "avatar.preset.osito" },
  { id: "carly",    labelKey: "avatar.preset.carly" },
];

const PRESET_IDS = new Set(AVATAR_PRESETS.map(p => p.id));

export function isPresetId(id) {
  return typeof id === "string" && PRESET_IDS.has(id);
}

export function presetUrl(id) {
  return isPresetId(id) ? `/avatars/${id}.svg` : null;
}
