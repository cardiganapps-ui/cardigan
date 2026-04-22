import { createElement } from "react";
import {
  Sprig, Flower, Leaf, Sun, Moon, Wave, Mountain, Arch,
  Heart, CardiganGarment, YarnBall, Spark,
} from "./presets.jsx";

/* ── Cardigan preset avatar registry ────────────────────────────────
   Maps preset ids to their component + human-readable label. Kept
   separate from `presets.jsx` so the components-only file satisfies
   the react-refresh lint rule and the render helper can live next
   to the data without needing JSX syntax. */

export const PRESET_AVATARS = {
  "sprig-01":     { label: "Ramita",    Component: Sprig },
  "flower-01":    { label: "Flor",      Component: Flower },
  "leaf-01":      { label: "Hoja",      Component: Leaf },
  "sun-01":       { label: "Sol",       Component: Sun },
  "moon-01":      { label: "Luna",      Component: Moon },
  "wave-01":      { label: "Ondas",     Component: Wave },
  "mountain-01":  { label: "Monte",     Component: Mountain },
  "arch-01":      { label: "Arcos",     Component: Arch },
  "heart-01":     { label: "Corazón",   Component: Heart },
  "cardigan-01":  { label: "Cardigan",  Component: CardiganGarment },
  "yarn-01":      { label: "Estambre",  Component: YarnBall },
  "spark-01":     { label: "Destello",  Component: Spark },
};

export const PRESET_AVATAR_IDS = Object.keys(PRESET_AVATARS);

export function renderPresetAvatar(id, size = 72) {
  const preset = PRESET_AVATARS[id];
  if (!preset) return null;
  return createElement(preset.Component, { size });
}
