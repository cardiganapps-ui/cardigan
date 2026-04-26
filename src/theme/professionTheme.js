/* Per-profession accent palettes.

   Cardigan was designed around a single brand teal. To keep visuals
   coherent for non-psychologist professions, we override the entire
   teal family (`--teal`, `--teal-dark`, `--teal-light`, `--teal-pale`,
   `--teal-mist`) at the document root via the useEffect in AppShell.
   That way every component that already references `var(--teal*)`
   repaints automatically — no per-component CSS changes needed.

   Each entry mirrors the structure of the original teal swatch with
   the hue shifted; saturation and lightness are tuned to match
   readability and contrast on the existing cream background.

   Phase 3+: tutor / music_teacher / trainer get their own palettes.
   Until then they fall back to psychologist's teal. */

export const PROFESSION_THEME = {
  psychologist: {
    teal:      "#5B9BAF",
    tealDark:  "#4A8799",
    tealLight: "#7AB5C7",
    tealPale:  "#EAF4F7",
    tealMist:  "#F2F9FB",
  },
  nutritionist: {
    // Sage / leaf green. Pairs with cream and matches the food/health
    // associations of the profession.
    teal:      "#6FAA82",
    tealDark:  "#588F6B",
    tealLight: "#88BB99",
    tealPale:  "#ECF4ED",
    tealMist:  "#F2F8F3",
  },
  tutor: {
    // Warm amber/gold. Echoes notebooks, pencils, classroom evening
    // light without competing with the existing --amber (used for
    // alerts and the new a-domicilio modality).
    teal:      "#C99A4A",
    tealDark:  "#A57E37",
    tealLight: "#D8B26A",
    tealPale:  "#F6EFE0",
    tealMist:  "#FAF6EC",
  },
  music_teacher: {
    // Dusty burgundy / rosé. Reads as classical / refined without
    // colliding with --purple (reserved for tutor-of-minor sessions)
    // or --red (alerts).
    teal:      "#A86B7E",
    tealDark:  "#8C5466",
    tealLight: "#BD8595",
    tealPale:  "#F4E8EC",
    tealMist:  "#F9F1F4",
  },
  trainer: {
    // Steel slate. Reads as athletic / focused, distinct from teal
    // (psych) despite both being blue-leaning — the lower saturation
    // and cooler hue keep them clearly separable.
    teal:      "#5A7388",
    tealDark:  "#456073",
    tealLight: "#7A8FA3",
    tealPale:  "#E8EEF2",
    tealMist:  "#F1F4F7",
  },
};

export function applyProfessionTheme(profession) {
  if (typeof document === "undefined") return;
  const palette = PROFESSION_THEME[profession] ?? PROFESSION_THEME.psychologist;
  const root = document.documentElement;
  root.style.setProperty("--teal",       palette.teal);
  root.style.setProperty("--teal-dark",  palette.tealDark);
  root.style.setProperty("--teal-light", palette.tealLight);
  root.style.setProperty("--teal-pale",  palette.tealPale);
  root.style.setProperty("--teal-mist",  palette.tealMist);
  // Keep --accent in sync. Phase 1 reserved it as `var(--teal)` so any
  // component that opts into the abstraction still resolves correctly.
  root.style.setProperty("--accent",      palette.teal);
  root.style.setProperty("--accent-dark", palette.tealDark);
  root.style.setProperty("--accent-pale", palette.tealPale);
}
