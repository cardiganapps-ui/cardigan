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

async function dataUrlToFile(dataUrl, filename) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || "image/jpeg" });
}

/** Take a photo with the device camera. Returns a File or null on cancel. */
export async function takePhoto({ quality = 80 } = {}) {
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
  } catch {
    // User cancelled, denied permission, or hardware error — caller
    // surfaces a generic toast if needed.
    return null;
  }
}

/** Pick an image from the photo library. Returns a File or null on cancel. */
export async function pickFromLibrary({ quality = 80 } = {}) {
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
  } catch {
    return null;
  }
}
