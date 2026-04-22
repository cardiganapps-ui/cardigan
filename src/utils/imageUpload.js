/* ── Client-side image resize for profile uploads ───────────────────
   Takes a raw image File, produces a square-cropped, downscaled JPEG
   Blob suitable for uploading to R2 as the user's avatar. Keeps the
   server stateless (we never do image processing on the API side)
   and keeps the delivered image small (typical 256² JPEG at q=0.85
   is ~15–25 KB).

   Why square: avatars render in a circle at every consumer (Settings
   card at 52 px, drawer header, 28 px top-right chrome, 72 px picker
   tile). Pre-cropping square means we don't have to worry about
   aspect-ratio fallout at render time — the circle matches the JPEG.

   Why client-side: avoids a second serverless function for resize,
   keeps payload small even on slow networks, and the Canvas API is
   well-supported on every browser Cardigan targets (iOS 15+, modern
   Chrome/Safari/Firefox). */

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const DEFAULT_TARGET = 256;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode_failed")); };
    img.src = url;
  });
}

export async function resizeToSquareJpeg(file, target = DEFAULT_TARGET) {
  if (!file || typeof file !== "object") throw new Error("no_file");
  if (!(file.type || "").startsWith("image/")) throw new Error("not_image");
  if (file.size > MAX_INPUT_BYTES) throw new Error("too_large");

  const img = await loadImage(file);
  const side = Math.min(img.width, img.height);
  if (!side) throw new Error("decode_failed");

  // Don't upscale — if the source is already smaller than the target,
  // render at the source's native size. Keeps small avatars crisp and
  // avoids blurry interpolation artifacts.
  const t = Math.min(target, side);
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = t;
  canvas.height = t;
  const ctx = canvas.getContext("2d");
  // High-quality downscale; default is browser-dependent but
  // generally "medium". "high" produces cleaner results for portraits.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, side, side, 0, 0, t, t);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("encode_failed"))),
      "image/jpeg",
      0.85
    );
  });
  return blob;
}

/* Build the R2 object path for a profile avatar. The timestamp
   suffix is the cache-bust — callers who view the image immediately
   after upload get the new bytes without any CDN / browser-cache
   stickiness. The `userId/` prefix is required by the validatePath
   guard in api/_r2.js. */
export function avatarPath(userId, timestamp = Date.now()) {
  if (!userId) throw new Error("no_user_id");
  return `${userId}/profile/avatar-${timestamp}.jpg`;
}
