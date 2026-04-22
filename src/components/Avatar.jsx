import { useState } from "react";

/**
 * Shared circular avatar — initials fallback or uploaded image.
 *
 * Sizes:
 *   - "sm" — 36px
 *   - "md" — 40px (default)
 *   - "lg" — 52px (Settings profile card)
 *
 * Content priority: imageUrl > initials. If imageUrl fails to load
 * (404 / CORS / expired presigned URL) we silently fall back to
 * initials.
 *
 * Props:
 *   initials  — text inside the circle when no image
 *   color     — background color (CSS color or var); ignored when
 *               an image is rendering (it fills the circle)
 *   size      — "sm" | "md" | "lg"
 *   tutor     — swaps the default color to purple
 *   imageUrl  — optional URL of an uploaded profile image
 *   style     — style overrides for the outer circle
 */
export function Avatar({ initials, color, size = "md", tutor = false, imageUrl, style }) {
  const dims = size === "lg" ? 52 : size === "sm" ? 36 : 40;
  const fontSize = size === "lg" ? 18 : size === "sm" ? 11 : 13;

  const bg = imageUrl ? "transparent" : (color || (tutor ? "var(--purple)" : "var(--teal)"));

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
      ) : (
        initials
      )}
    </div>
  );
}

/* Inline content variant — renders the same priority chain (image
   → initials) without the outer `.row-avatar` circle, so existing
   differently-styled containers (`.drawer-avatar`, `.avatar-sm`)
   can adopt the new render shape without duplicating logic. */
export function AvatarContent({ initials, imageUrl }) {
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
  return <>{initials}</>;
}
