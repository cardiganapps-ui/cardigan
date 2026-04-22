/* Preset avatar gallery — a curated set of line-art illustrations
   (dog, cat, plant, coffee, mountain, cloud, book, moon, heart,
   avocado, sheep, house) served as static SVGs from /avatars/*.svg.

   Each preset is referenced by its id (e.g. "dog"). The id is what
   we persist in user_metadata.avatar as
     { kind: "preset", value: "<id>" }
   so the canonical art can be updated without migrating user data.

   Adding a preset: drop `<id>.svg` into public/avatars/ and append
   an entry below. Removing/renaming an id is a breaking change —
   existing users with that value will silently fall back to
   initials (see resolveAvatar). */

export const AVATAR_PRESETS = [
  { id: "dog",      labelKey: "avatar.preset.dog" },
  { id: "cat",      labelKey: "avatar.preset.cat" },
  { id: "plant",    labelKey: "avatar.preset.plant" },
  { id: "coffee",   labelKey: "avatar.preset.coffee" },
  { id: "mountain", labelKey: "avatar.preset.mountain" },
  { id: "cloud",    labelKey: "avatar.preset.cloud" },
  { id: "book",     labelKey: "avatar.preset.book" },
  { id: "moon",     labelKey: "avatar.preset.moon" },
  { id: "heart",    labelKey: "avatar.preset.heart" },
  { id: "avocado",  labelKey: "avatar.preset.avocado" },
  { id: "sheep",    labelKey: "avatar.preset.sheep" },
  { id: "house",    labelKey: "avatar.preset.house" },
];

const PRESET_IDS = new Set(AVATAR_PRESETS.map(p => p.id));

export function isPresetId(id) {
  return typeof id === "string" && PRESET_IDS.has(id);
}

export function presetUrl(id) {
  return isPresetId(id) ? `/avatars/${id}.svg` : null;
}
