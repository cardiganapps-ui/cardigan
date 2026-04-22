import { createElement } from "react";
import {
  Dog, Cat, Plant, Coffee, Mountain, Cloud,
  Book, Moon, Heart, Avocado, Sheep, House,
} from "./presets.jsx";

/* ── Cardigan preset avatar registry ────────────────────────────────
   Maps preset ids to their component + human-readable Spanish label.
   Kept separate from presets.jsx so the components-only file
   satisfies the react-refresh lint rule and the render helper can
   live next to the data without needing JSX syntax.

   Ids are stable — changing them would strand users who already
   picked that preset (their user_metadata stores e.g.
   "preset:dog-01"). The `-01` suffix leaves room for a future ship
   of refreshed variants (`dog-02`). */

export const PRESET_AVATARS = {
  "dog-01":      { label: "Perro",    Component: Dog },
  "cat-01":      { label: "Gato",     Component: Cat },
  "plant-01":    { label: "Planta",   Component: Plant },
  "coffee-01":   { label: "Café",     Component: Coffee },
  "mountain-01": { label: "Montaña",  Component: Mountain },
  "cloud-01":    { label: "Nube",     Component: Cloud },
  "book-01":     { label: "Libro",    Component: Book },
  "moon-01":     { label: "Luna",     Component: Moon },
  "heart-01":    { label: "Corazón",  Component: Heart },
  "avocado-01":  { label: "Aguacate", Component: Avocado },
  "sheep-01":    { label: "Oveja",    Component: Sheep },
  "house-01":    { label: "Casa",     Component: House },
};

export const PRESET_AVATAR_IDS = Object.keys(PRESET_AVATARS);

export function renderPresetAvatar(id, size = 72) {
  const preset = PRESET_AVATARS[id];
  if (!preset) return null;
  return createElement(preset.Component, { size });
}
