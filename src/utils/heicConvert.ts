/* ── HEIC → JPEG conversion ───────────────────────────────────────────

   iPhone-default photos are HEIC. Anthropic vision (used by /api/ocr-
   receipt and any future image-aware feature) only supports JPEG /
   PNG / GIF / WEBP. The DocumentViewer also can't render HEIC outside
   of Safari.

   We convert client-side at upload time so the file is JPEG by the
   time it lands in R2 — every downstream surface (OCR, viewer,
   patient archive) gets a format it understands without per-consumer
   coercion.

   Trade-offs:
   - Conversion takes 1-3s for a typical iPhone photo (3-5MB HEIC).
     Surfaced as the regular "Subiendo recibo..." spinner, not a new
     state, since the user already expects an upload delay.
   - heic2any is ~3MB (WASM). Lazy-imported via dynamic import() so
     therapists who never upload a HEIC pay zero bundle cost.
*/

// Detect HEIC by extension first (iOS sometimes hands File objects with
// type="" because the OS hasn't registered the MIME), then by MIME.
// Either signal is sufficient.
export function isHeic(file: File | null | undefined): boolean {
  if (!file) return false;
  const t = (file.type || "").toLowerCase();
  if (t === "image/heic" || t === "image/heif") return true;
  const name = (file.name || "").toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

// Convert a HEIC File to a JPEG File. No-op if not HEIC. Returns the
// original file on conversion failure so the upload still proceeds —
// it just won't OCR. The caller doesn't need to handle errors;
// fallback behavior is identical to no conversion.
export async function maybeConvertHeic(file: File, { quality = 0.9 }: { quality?: number } = {}): Promise<File> {
  if (!isHeic(file)) return file;
  try {
    const mod = await import("heic2any");
    const heic2any = mod.default || mod;
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality });
    // heic2any returns a Blob (or array of Blobs for multi-frame files).
    // Coerce to a single File with a derived .jpg name so the rest of
    // the upload pipeline (file_path extension, R2 content-type
    // inference) sees a clean JPEG.
    const blob = Array.isArray(out) ? out[0] : out;
    const baseName = (file.name || "receipt").replace(/\.(heic|heif)$/i, "");
    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified || Date.now(),
    });
  } catch (err: unknown) {
    // Conversion can fail on corrupt files, multi-image HEICs that
    // heic2any can't iterate, or browsers without WebAssembly. Fall
    // back to the original file so the user still gets *something*
    // attached. The OCR endpoint's HEIC 415 path catches it next.
    console.warn("[heicConvert] failed, uploading original:", (err as Error)?.message);
    return file;
  }
}
