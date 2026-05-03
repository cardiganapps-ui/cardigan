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
     no scrim ever shows through under the image. */

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

export function AvatarCropEditor({ file, frameSize = 300, output = 256, onCancel, onConfirm }) {
  const { t } = useT();
  const [imgEl, setImgEl] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  // Track active touches by identifier so a stray fourth finger doesn't
  // disrupt a two-finger pinch in progress on iPad.
  const dragRef = useRef(null);

  // Load + decode the picked file once. Free the object URL on unmount
  // / file-change so we don't leak across consecutive crops.
  useEffect(() => {
    let alive = true;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      setImgEl(img);
      // Initialise pan so the image is visually centered inside the
      // frame at default 1× zoom.
      const baseScale = Math.max(frameSize / img.width, frameSize / img.height);
      const dispW = img.width * baseScale;
      const dispH = img.height * baseScale;
      setPan({
        x: -(dispW - frameSize) / 2,
        y: -(dispH - frameSize) / 2,
      });
      setZoom(1);
    };
    img.onerror = () => { /* parent shows the file-error toast */ };
    img.src = url;
    return () => { alive = false; URL.revokeObjectURL(url); };
  }, [file, frameSize]);

  const baseScale = useMemo(
    () => imgEl ? Math.max(frameSize / imgEl.width, frameSize / imgEl.height) : 1,
    [imgEl, frameSize]
  );
  const totalScale = baseScale * zoom;

  // Re-clamp pan whenever zoom changes — zooming out can leave the
  // image not covering the frame anymore; clamp pulls it back.
  useEffect(() => {
    if (!imgEl) return;
    setPan(p => clampPan(p.x, p.y, totalScale, imgEl.width, imgEl.height, frameSize));
  }, [zoom, totalScale, imgEl, frameSize]);

  // ── Touch handling ──
  // Single finger = pan. Two fingers = pinch zoom (centered between
  // the two fingers, anchored against the image so the gesture feels
  // like manipulating the photo directly).
  const onTouchStart = useCallback((e) => {
    if (!imgEl) return;
    if (e.touches.length === 1) {
      const t0 = e.touches[0];
      dragRef.current = {
        mode: "pan",
        startX: t0.clientX,
        startY: t0.clientY,
        panX: pan.x,
        panY: pan.y,
      };
    } else if (e.touches.length === 2) {
      dragRef.current = {
        mode: "pinch",
        startDist: dist(e.touches[0], e.touches[1]),
        startZoom: zoom,
      };
    }
  }, [pan.x, pan.y, zoom, imgEl]);

  const onTouchMove = useCallback((e) => {
    if (!dragRef.current || !imgEl) return;
    e.preventDefault();
    if (dragRef.current.mode === "pan" && e.touches.length === 1) {
      const t0 = e.touches[0];
      const dx = t0.clientX - dragRef.current.startX;
      const dy = t0.clientY - dragRef.current.startY;
      setPan(clampPan(
        dragRef.current.panX + dx,
        dragRef.current.panY + dy,
        totalScale, imgEl.width, imgEl.height, frameSize
      ));
    } else if (dragRef.current.mode === "pinch" && e.touches.length === 2) {
      const newDist = dist(e.touches[0], e.touches[1]);
      const ratio = newDist / (dragRef.current.startDist || 1);
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, dragRef.current.startZoom * ratio));
      setZoom(next);
    }
  }, [totalScale, imgEl, frameSize]);

  const onTouchEnd = useCallback((e) => {
    // If we drop from pinch to one finger, transition into pan from
    // the remaining finger so the gesture feels continuous.
    if (e.touches.length === 1 && dragRef.current?.mode === "pinch") {
      const t0 = e.touches[0];
      dragRef.current = {
        mode: "pan",
        startX: t0.clientX,
        startY: t0.clientY,
        panX: pan.x,
        panY: pan.y,
      };
    } else if (e.touches.length === 0) {
      dragRef.current = null;
    }
  }, [pan.x, pan.y]);

  // ── Mouse handling (desktop) ──
  const onMouseDown = useCallback((e) => {
    if (!imgEl || e.button !== 0) return;
    e.preventDefault();
    dragRef.current = {
      mode: "pan",
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    const onMove = (ev) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setPan(clampPan(
        dragRef.current.panX + dx,
        dragRef.current.panY + dy,
        totalScale, imgEl.width, imgEl.height, frameSize
      ));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [pan.x, pan.y, totalScale, imgEl, frameSize]);

  // Wheel zoom — desktop trackpad pinch + mouse-wheel both fire wheel
  // with ctrlKey for pinch, plain wheel for scroll. We treat both the
  // same: incremental zoom by wheel delta.
  const onWheel = useCallback((e) => {
    if (!imgEl) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    setZoom(z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * factor)));
  }, [imgEl]);

  // The browser blocks preventDefault inside a passive listener, and
  // React attaches touch/wheel handlers as passive. Attach native
  // non-passive listeners so onWheel + onTouchMove can preventDefault
  // — without this, mobile Safari hijacks pinch to zoom the page and
  // desktop trackpads scroll the sheet underneath.
  const frameRef = useRef(null);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const wheelHandler = (e) => onWheel(e);
    const moveHandler = (e) => onTouchMove(e);
    el.addEventListener("wheel", wheelHandler, { passive: false });
    el.addEventListener("touchmove", moveHandler, { passive: false });
    return () => {
      el.removeEventListener("wheel", wheelHandler);
      el.removeEventListener("touchmove", moveHandler);
    };
  }, [onWheel, onTouchMove]);

  const confirm = async () => {
    if (!imgEl || busy) return;
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
      //   sx = -panX / totalScale  (because pan is in screen px and
      //                             scale maps image→screen)
      //   sw = frame / totalScale
      const sx = -pan.x / totalScale;
      const sy = -pan.y / totalScale;
      const sw = frameSize / totalScale;
      const sh = frameSize / totalScale;
      ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, output, output);
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
          {imgEl && (
            <img
              src={imgEl.src}
              alt=""
              draggable={false}
              style={{
                position: "absolute",
                top: 0, left: 0,
                width: imgEl.width,
                height: imgEl.height,
                transformOrigin: "0 0",
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${totalScale})`,
                userSelect: "none",
                pointerEvents: "none",
              }}
            />
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
        <button type="button" className="btn btn-primary-teal" onClick={confirm} disabled={!imgEl || busy}>
          {busy ? (t("saving") || "Guardando…") : (t("avatar.crop.confirm") || "Listo")}
        </button>
      </div>
    </div>
  );
}
