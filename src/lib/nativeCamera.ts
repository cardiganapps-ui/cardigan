// Cross-platform camera + photo-library picker.
//
// Web:    falls back to <input type="file" capture="environment"> at the
//         call site. This module no-ops via isNative() — the existing
//         file input remains the canonical web path.
//
// Native: Capacitor Camera plugin. iOS uses UIImagePickerController
//         (system camera or photo library); Android uses CameraX +
//         system gallery picker. Both produce a JPEG/PNG dataUrl that
//         we hand back as a real File so the existing uploadDocument()
//         path works unchanged.
//
// Use this for any "attach a photo" affordance — receipt OCR (gastos),
// patient avatar, intake-form image fields. The file shape we return
// matches what <input type="file"> would have produced, so the upload
// helper at the receiving end stays single-codepath.

import { isNative } from "./platform";

// The Capacitor Camera plugin signals a user dismiss by throwing an
// error whose message contains "cancel" (iOS: "User cancelled photos
// app"; Android: similar). Everything else (permission denied, no
// camera, encode failure) is a real error worth surfacing.
function isCancel(err: unknown) {
  const msg = ((err as Error)?.message || (typeof err === "string" ? err : "") || "").toLowerCase();
  return msg.includes("cancel");
}

async function dataUrlToFile(dataUrl: string, filename: string) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || "image/jpeg" });
}

/** Take a photo with the device camera. Returns a File or null on cancel. */
export async function takePhoto({ quality = 80 }: { quality?: number } = {}) {
  if (!isNative()) return null;
  try {
    const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
    const photo = await Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.DataUrl,
      quality,
      // Let the user reframe if they took a bad shot — the user can
      // re-snap, but they can't crop inside our sheet.
      allowEditing: false,
      saveToGallery: false,
    });
    if (!photo?.dataUrl) return null;
    const ext = photo.format || "jpg";
    return await dataUrlToFile(photo.dataUrl, `photo-${Date.now()}.${ext}`);
  } catch (err) {
    // Distinguish a user cancel (return null silently — toasting on a
    // deliberate dismiss is annoying) from a real failure (permission
    // denied / hardware), which we re-throw so the caller can surface
    // feedback instead of a dead-feeling button. The plugin throws a
    // message containing "cancel" on dismiss.
    if (isCancel(err)) return null;
    throw err;
  }
}

/** Pick an image from the photo library. Returns a File or null on cancel. */
export async function pickFromLibrary({ quality = 80 }: { quality?: number } = {}) {
  if (!isNative()) return null;
  try {
    const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
    const photo = await Camera.getPhoto({
      source: CameraSource.Photos,
      resultType: CameraResultType.DataUrl,
      quality,
      allowEditing: false,
    });
    if (!photo?.dataUrl) return null;
    const ext = photo.format || "jpg";
    return await dataUrlToFile(photo.dataUrl, `image-${Date.now()}.${ext}`);
  } catch (err) {
    if (isCancel(err)) return null;
    throw err;
  }
}
