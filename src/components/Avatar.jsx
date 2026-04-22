import { useState } from "react";
import { renderPresetAvatar } from "./avatars/registry";

/**
 * Shared circular avatar with initials / preset / uploaded image.
 *
 * Replaces the ~five different `row-avatar` implementations that used
 * inline `width/height/fontSize` overrides (36, 40, 44). Three sizes:
 *   - "sm" — 36px
 *   - "md" — 40px (default)
 *   - "lg" — 52px (Settings profile card)
 *
 * Content priority: imageUrl > presetId > initials.
 * All three inputs are optional — the initials fallback preserves the
 * pre-avatar behavior for every existing caller.
 *
 * Props:
 *   initials  — text inside the circle when nothing else renders
 *   color     — background color (CSS color or var); ignored when an
 *               image or preset is rendered (they fill the circle)
 *   size      — "sm" | "md" | "lg"
 *   tutor     — swaps the default color to purple
 *   imageUrl  — optional URL of an uploaded profile image; rendered
 *               with object-fit cover. If the image fails to load,
 *               silently falls through to presetId / initials.
 *   presetId  — optional id into PRESET_AVATARS (e.g. "sprig-01")
 *   style     — style overrides for the outer circle
 */
export function Avatar({ initials, color, size = "md", tutor = false, imageUrl, presetId, style }) {
  const dims = size === "lg" ? 52 : size === "sm" ? 36 : 40;
  const fontSize = size === "lg" ? 18 : size === "sm" ? 11 : 13;

  // If we're rendering a custom avatar (image or preset), the circle
  // itself shouldn't also paint a teal background — the illustration
  // brings its own. For initials, keep the legacy color behavior.
  const hasCustom = !!(imageUrl || presetId);
  const bg = hasCustom ? "transparent" : (color || (tutor ? "var(--purple)" : "var(--teal)"));

  // Track image load errors so we can fall back silently. Any 404 /
  // CORS / expired-presigned-URL case ends up showing preset or
  // initials instead of a broken-image icon.
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = imageUrl && !imgFailed;

  return (
    <div
      className="row-avatar"
      style={{
        background: bg,
        width: dims,
        height: dims,
        fontSize,
        flexShrink: 0,
        overflow: "hidden",
        position: "relative",
        ...style,
      }}
    >
      {showImage ? (
        <img
          src={imageUrl}
          alt=""
          onError={() => setImgFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          draggable={false}
        />
      ) : presetId ? (
        <AvatarPresetInline presetId={presetId} size={dims} />
      ) : (
        initials
      )}
    </div>
  );
}

/* Render a preset SVG sized to fill the parent circle. Kept as a
   small wrapper so the size math lives in one place. */
function AvatarPresetInline({ presetId, size }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "block" }}>
      {renderPresetAvatar(presetId, size)}
    </div>
  );
}

/* Inline content variant — renders the same priority chain (image →
   preset → initials) without the outer `.row-avatar` circle, so
   existing differently-styled containers (`.drawer-avatar`,
   `.avatar-sm`) can adopt the new render shape without duplicating
   logic. Size here is passed directly to the preset SVG so it fills
   the parent. */
export function AvatarContent({ initials, imageUrl, presetId, size = 40 }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = imageUrl && !imgFailed;
  if (showImage) {
    return (
      <img
        src={imageUrl}
        alt=""
        onError={() => setImgFailed(true)}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", borderRadius: "inherit" }}
        draggable={false}
      />
    );
  }
  if (presetId) return renderPresetAvatar(presetId, size);
  return <>{initials}</>;
}
