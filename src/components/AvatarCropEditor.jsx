import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useT } from "../i18n/index";
import { haptic } from "../utils/haptics";

/* ── AvatarCropEditor ──────────────────────────────────────────────
   Native-feeling profile-photo crop. Visual language:

     - Square framing area, ~85% of sheet width
     - Image fills the frame with cover-fit, then user can drag + pinch
       + slider-zoom to position the head/face inside the circle
     - Dark scrim covers everything outside a circular cutout, with a
       1px white ring on the circle so the user can see exactly what
       will be saved as their profile photo
     - Bottom: zoom slider (cardigan-styled), Cancelar / Listo buttons

   Input: a File (JPEG/PNG/HEIC/etc — anything <img> can decode).
   Output: a square JPEG Blob at `output` px (default 256), composed
     of exactly the frame contents at confirm time.

   Coordinate model:
     baseScale = max(frame/imgW, frame/imgH)   // cover-fit
     totalScale = baseScale * userZoom         // userZoom ∈ [1, 4]
     pan        = top-left of displayed image relative to frame top-left
     The pan is always clamped so the image fully covers the frame —
     no scrim ever shows through under the image.

   EXIF orientation: we use createImageBitmap with
   imageOrientation:"from-image" so the bitmap is pre-rotated according
   to the file's EXIF tag. Without this, portrait photos straight from
   an iPhone camera roll save sideways on older Safari (the on-screen
   <img> auto-rotates, but canvas drawImage of an <img> doesn't honour
   orientation across all browsers). createImageBitmap normalises both
   paths through the same rotated bitmap. */

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;

function clampPan(panX, panY, totalScale, imgW, imgH, frame) {
  const dispW = imgW * totalScale;
  const dispH = imgH * totalScale;
  // Pan range: image must fully cover the frame at all times.
  const minX = frame - dispW;
  const minY = frame - dispH;
  return {
    x: Math.max(minX, Math.min(0, panX)),
    y: Math.max(minY, Math.min(0, panY)),
  };
}

function dist(a, b) {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.hypot(dx, dy);
}

/* Decode the file into both an HTMLImageElement (for on-screen display)
   AND an ImageBitmap (for the canvas draw at confirm time). The bitmap
   is EXIF-rotated via imageOrientation:"from-image" so the saved
   output matches what the user sees on screen — even on iOS Safari
   where canvas drawImage of an <img> historically ignored EXIF.
   Returns { url, htmlImage, bitmap, width, height }. The bitmap has
   the rotated dimensions; the htmlImage is rendered with the same
   image-orientation:from-image CSS so the displayed dimensions match. */
async function decodeFile(file) {
  const url = URL.createObjectURL(file);
  // ImageBitmap path. Honours EXIF and returns a renderable surface
  // for drawImage. createImageBitmap is supported in iOS Safari 15+,
  // Chrome 81+, Firefox 79+ — every browser Cardigan targets.
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = null;
  }
  // HTMLImageElement path for on-screen display. Wait for load so the
  // caller can read .width/.height immediately and so init pan math
  // uses the post-decode size (matters when the orientation flips
  // dimensions vs. the file's declared metadata).
  const htmlImage = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode_failed"));
    img.src = url;
  });
  // Prefer bitmap dimensions when available — they reflect EXIF rotation.
  const width = bitmap?.width || htmlImage.naturalWidth || htmlImage.width;
  const height = bitmap?.height || htmlImage.naturalHeight || htmlImage.height;
  return { url, htmlImage, bitmap, width, height };
}

export function AvatarCropEditor({ file, frameSize = 300, output = 256, onCancel, onConfirm }) {
  const { t } = useT();
  const [decoded, setDecoded] = useState(null); // { url, htmlImage, bitmap, width, height } | null
  const [loadError, setLoadError] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  // Active drag/pinch state. ref-based so every render reads / writes
  // the same gesture context without rerendering.
  const dragRef = useRef(null);

  // Refs that mirror the latest pan / zoom / decoded values. The
  // native touch + wheel listeners attached in a useEffect below read
  // from these refs instead of capturing closures — that lets us
  // attach the listeners ONCE (not on every render) without ever
  // operating on stale state. Without these refs, the listeners
  // re-attached on every gesture tick (zoom changed → callback ref
  // changed → effect re-ran), which on continuous pinch caused
  // hundreds of add/remove cycles per second.
  const panRef = useRef(pan);
  panRef.current = pan;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const decodedRef = useRef(decoded);
  decodedRef.current = decoded;

  // Decode the file once on mount / file-change. Both the bitmap and
  // the HTMLImageElement get their object URL revoked on cleanup so
  // we never leak across consecutive crops.
  useEffect(() => {
    if (!file) return;
    let alive = true;
    let result = null;
    setLoadError(false);
    decodeFile(file).then(r => {
      if (!alive) {
        // Stale decode; clean up immediately.
        URL.revokeObjectURL(r.url);
        if (r.bitmap?.close) try { r.bitmap.close(); } catch { /* ignore */ }
        return;
      }
      result = r;
      setDecoded(r);
      // Init pan so the image is visually centered inside the frame
      // at default 1× zoom.
      const baseScale = Math.max(frameSize / r.width, frameSize / r.height);
      const dispW = r.width * baseScale;
      const dispH = r.height * baseScale;
      setPan({
        x: -(dispW - frameSize) / 2,
        y: -(dispH - frameSize) / 2,
      });
      setZoom(1);
    }).catch(() => {
      if (alive) setLoadError(true);
    });
    return () => {
      alive = false;
      if (result) {
        URL.revokeObjectURL(result.url);
        if (result.bitmap?.close) try { result.bitmap.close(); } catch { /* ignore */ }
      }
    };
  }, [file, frameSize]);

  const baseScale = useMemo(
    () => decoded ? Math.max(frameSize / decoded.width, frameSize / decoded.height) : 1,
    [decoded, frameSize]
  );
  const totalScale = baseScale * zoom;

  // Re-clamp pan whenever zoom changes — zooming out can leave the
  // image not covering the frame anymore; clamp pulls it back. This
  // is intentionally a setState-in-effect because the clamp is the
  // sync between two independent state shards (zoom and pan).
  useEffect(() => {
    if (!decoded) return;
    setPan(p => clampPan(p.x, p.y, totalScale, decoded.width, decoded.height, frameSize));
  }, [zoom, totalScale, decoded, frameSize]);

  // ── Touch handling ──
  // Single finger = pan. Two fingers = pinch zoom (centered between
  // the two fingers, anchored against the image so the gesture feels
  // like manipulating the photo directly).
  const onTouchStart = useCallback((e) => {
    if (!decoded) return;
    if (e.touches.length === 1) {
      const t0 = e.touches[0];
      dragRef.current = {
        mode: "pan",
        startX: t0.clientX,
        startY: t0.clientY,
        panX: panRef.current.x,
        panY: panRef.current.y,
      };
    } else if (e.touches.length === 2) {
      dragRef.current = {
        mode: "pinch",
        startDist: dist(e.touches[0], e.touches[1]),
        startZoom: zoomRef.current,
      };
    }
  }, [decoded]);

  // Touch move handler — must call preventDefault to block the iOS
  // page-zoom hijack on pinch. Reads pan/zoom from refs so the same
  // attached listener stays valid across re-renders.
  const onTouchMoveNative = useCallback((e) => {
    if (!dragRef.current) return;
    const dec = decodedRef.current;
    if (!dec) return;
    e.preventDefault();
    if (dragRef.current.mode === "pan" && e.touches.length === 1) {
      const t0 = e.touches[0];
      const dx = t0.clientX - dragRef.current.startX;
      const dy = t0.clientY - dragRef.current.startY;
      const ts = Math.max(frameSize / dec.width, frameSize / dec.height) * zoomRef.current;
      setPan(clampPan(
        dragRef.current.panX + dx,
        dragRef.current.panY + dy,
        ts, dec.width, dec.height, frameSize
      ));
    } else if (dragRef.current.mode === "pinch" && e.touches.length === 2) {
      const newDist = dist(e.touches[0], e.touches[1]);
      const ratio = newDist / (dragRef.current.startDist || 1);
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, dragRef.current.startZoom * ratio));
      setZoom(next);
    }
  }, [frameSize]);

  const onTouchEnd = useCallback((e) => {
    // If we drop from pinch to one finger, transition into pan from
    // the remaining finger so the gesture feels continuous.
    if (e.touches.length === 1 && dragRef.current?.mode === "pinch") {
      const t0 = e.touches[0];
      dragRef.current = {
        mode: "pan",
        startX: t0.clientX,
        startY: t0.clientY,
        panX: panRef.current.x,
        panY: panRef.current.y,
      };
    } else if (e.touches.length === 0) {
      dragRef.current = null;
    }
  }, []);

  // ── Mouse handling (desktop) ──
  // Window listeners are tracked in a ref so we can clean them up on
  // unmount even if the user navigates away mid-drag. Without the
  // unmount cleanup, a closed component leaves dangling listeners
  // that fire setState on a detached tree.
  const mouseListenersRef = useRef(null);
  useEffect(() => {
    return () => {
      const l = mouseListenersRef.current;
      if (l) {
        window.removeEventListener("mousemove", l.onMove);
        window.removeEventListener("mouseup", l.onUp);
        mouseListenersRef.current = null;
      }
    };
  }, []);
  const onMouseDown = useCallback((e) => {
    const dec = decodedRef.current;
    if (!dec || e.button !== 0) return;
    e.preventDefault();
    dragRef.current = {
      mode: "pan",
      startX: e.clientX,
      startY: e.clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
    };
    const onMove = (ev) => {
      if (!dragRef.current) return;
      const d = decodedRef.current;
      if (!d) return;
      const ts = Math.max(frameSize / d.width, frameSize / d.height) * zoomRef.current;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setPan(clampPan(
        dragRef.current.panX + dx,
        dragRef.current.panY + dy,
        ts, d.width, d.height, frameSize
      ));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      mouseListenersRef.current = null;
    };
    mouseListenersRef.current = { onMove, onUp };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [frameSize]);

  // Wheel zoom — desktop trackpad pinch (ctrl+wheel) + mouse-wheel.
  const onWheelNative = useCallback((e) => {
    if (!decodedRef.current) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    setZoom(z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * factor)));
  }, []);

  // Attach native non-passive listeners ONCE per mount. React's
  // synthetic touch/wheel handlers are passive — preventDefault is
  // ignored — so we have to bypass synthetic. Now stable across
  // re-renders thanks to the ref-based handlers above.
  const frameRef = useRef(null);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheelNative, { passive: false });
    el.addEventListener("touchmove", onTouchMoveNative, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheelNative);
      el.removeEventListener("touchmove", onTouchMoveNative);
    };
  }, [onWheelNative, onTouchMoveNative]);

  const confirm = async () => {
    const dec = decodedRef.current;
    if (!dec || busy) return;
    setBusy(true);
    try {
      // Render exactly what the frame currently shows to a square
      // canvas. The frame is square, the inscribed circle is what
      // the user sees inside the mask, but the consumer (avatar
      // tiles in the app) re-crops to a circle via CSS — so saving
      // the full square preserves a tiny bit of bleed for users on
      // hi-DPI screens where the circle clip antialiases.
      const canvas = document.createElement("canvas");
      canvas.width = output;
      canvas.height = output;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // Source rect in original-image coords:
      //   sx = -panX / totalScale  (pan is in screen px; scale maps
      //                             image→screen)
      //   sw = frame / totalScale
      const sx = -pan.x / totalScale;
      const sy = -pan.y / totalScale;
      const sw = frameSize / totalScale;
      const sh = frameSize / totalScale;
      // Prefer the EXIF-rotated bitmap when the platform supports it
      // (createImageBitmap with imageOrientation:"from-image"). Fall
      // back to the HTMLImageElement on platforms that didn't return
      // a bitmap. Both honour EXIF in their respective decode paths
      // on the browsers Cardigan targets.
      const source = dec.bitmap || dec.htmlImage;
      ctx.drawImage(source, sx, sy, sw, sh, 0, 0, output, output);
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("encode_failed"))),
          "image/jpeg",
          0.88
        );
      });
      haptic.success();
      onConfirm(blob);
    } catch {
      // Fall back to letting the parent show its generic upload error;
      // the canvas-encode path almost never fails in modern browsers.
      onCancel?.();
    } finally {
      setBusy(false);
    }
  };

  // Image load failure UX — if createImageBitmap AND the <img> fallback
  // both fail (corrupted file, unsupported HEIC on desktop Chrome, etc.)
  // surface a friendly message + a way back to the picker.
  if (loadError) {
    return (
      <div className="av-crop-editor av-crop-editor--error">
        <div className="av-crop-error-icon" aria-hidden>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
        </div>
        <div className="av-crop-error-title">
          {t("avatar.crop.loadFailedTitle") || "No pudimos abrir esa imagen"}
        </div>
        <div className="av-crop-error-body">
          {t("avatar.crop.loadFailedBody") || "Intenta con otra foto. Si subiste un HEIC, prueba con un JPG o PNG."}
        </div>
        <div className="av-crop-actions">
          <button type="button" className="btn btn-primary-teal" onClick={onCancel}>
            {t("back") || "Volver"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="av-crop-editor">
      <div className="av-crop-stage">
        <div
          ref={frameRef}
          className="av-crop-frame"
          style={{ width: frameSize, height: frameSize }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
          onMouseDown={onMouseDown}
        >
          {decoded && (
            <img
              src={decoded.url}
              alt=""
              draggable={false}
              style={{
                position: "absolute",
                top: 0, left: 0,
                width: decoded.width,
                height: decoded.height,
                transformOrigin: "0 0",
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${totalScale})`,
                userSelect: "none",
                pointerEvents: "none",
                // Honour EXIF on the displayed image so it matches the
                // EXIF-rotated bitmap the canvas reads from.
                imageOrientation: "from-image",
              }}
            />
          )}
          {!decoded && (
            <div className="av-crop-loading" aria-busy="true">
              <span className="av-crop-spinner" />
            </div>
          )}
          {/* Circular cutout overlay — dark scrim everywhere except the
              circle in the middle. SVG mask is the cleanest cross-
              browser way to punch a transparent hole through a fill. */}
          <svg
            className="av-crop-mask"
            width={frameSize}
            height={frameSize}
            viewBox={`0 0 ${frameSize} ${frameSize}`}
            aria-hidden
          >
            <defs>
              <mask id="av-crop-cutout">
                <rect width="100%" height="100%" fill="white" />
                <circle cx={frameSize / 2} cy={frameSize / 2} r={frameSize / 2 - 8} fill="black" />
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#av-crop-cutout)" />
            <circle
              cx={frameSize / 2} cy={frameSize / 2} r={frameSize / 2 - 8}
              fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5"
            />
          </svg>
        </div>
      </div>

      <div className="av-crop-zoom">
        <span className="av-crop-zoom-icon" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <circle cx="12" cy="12" r="6" /><path d="M9 12h6" />
          </svg>
        </span>
        <input
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step="0.01"
          value={zoom}
          onChange={(e) => setZoom(parseFloat(e.target.value))}
          className="av-crop-slider"
          aria-label={t("avatar.crop.zoom") || "Acercar"}
          disabled={!decoded}
        />
        <span className="av-crop-zoom-icon" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <circle cx="12" cy="12" r="6" /><path d="M9 12h6M12 9v6" />
          </svg>
        </span>
      </div>

      <div className="av-crop-hint">
        {t("avatar.crop.hint") || "Arrastra para mover · pellizca o usa la barra para acercar"}
      </div>

      <div className="av-crop-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          {t("cancel") || "Cancelar"}
        </button>
        <button type="button" className="btn btn-primary-teal" onClick={confirm} disabled={!decoded || busy}>
          {busy ? (t("saving") || "Guardando…") : (t("avatar.crop.confirm") || "Listo")}
        </button>
      </div>
    </div>
  );
}
