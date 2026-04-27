/* Per-profession accent palettes.

   Cardigan defaults to the psychologist palette (--teal* family in
   base.css). For non-default professions we toggle a `data-profession`
   attribute on <html>; the matching rules in profession-themes.css
   then swap the teal swatch via the cascade.

   The earlier JS-based override (document.documentElement.style.
   setProperty) set INLINE styles on <html>, which beat dark.css's
   stylesheet rules. Result: dark mode for non-default professions
   was permanently broken (most visible as a bright `.week-event:hover`
   tile that took the light-mode --teal-pale value). Moving the
   override to a CSS attribute selector lets dark mode + profession
   theming compose correctly via cascade specificity. */

export function applyProfessionTheme(profession) {
  if (typeof document === "undefined") return;
  // Drop any prior inline overrides set by older versions of this
  // module — they leak across deploys for users who already had a
  // session open. setProperty("--teal-*", "") removes the inline
  // value entirely so the stylesheet cascade takes over.
  const root = document.documentElement;
  for (const v of ["--teal", "--teal-dark", "--teal-light", "--teal-pale", "--teal-mist", "--accent", "--accent-dark", "--accent-pale"]) {
    root.style.removeProperty(v);
  }
  // Psychologist is the default — no attribute needed (inherits from
  // base.css + dark.css directly). For any other profession we set
  // the attribute, which activates the matching rules in
  // profession-themes.css.
  if (profession && profession !== "psychologist") {
    root.dataset.profession = profession;
  } else {
    delete root.dataset.profession;
  }
}
