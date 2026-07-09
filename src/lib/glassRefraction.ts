/* ── True Liquid Glass refraction (Chromium-only progressive enhancement) ──

   Real lens refraction on the web needs an SVG displacement filter
   inside `backdrop-filter: url(#…)` — supported by Chromium (desktop
   Chrome/Edge, Android Chrome/WebView) and by NOTHING WebKit: Safari
   and the iOS WKWebView ignore SVG filter references in
   backdrop-filter entirely. So this module:

     1. Gates hard to Chromium (navigator.userAgentData only exists in
        the Chromium family — Safari/Firefox lack it — plus a
        CSS.supports sanity check; UA-gating is deliberate because
        WebKit PARSES the url() grammar fine and just renders nothing,
        so CSS.supports alone would false-positive there).
     2. Generates displacement maps at runtime on an OffscreenCanvas —
        a rounded-rect signed-distance field whose edge band encodes
        outward displacement vectors in the R (x) / G (y) channels,
        0.5 = neutral. This is the actual "light bends at the lens
        edge" math, not a painted-on highlight.
     3. Injects one hidden <svg> with a filter per chrome surface
        (#lg-lens-pill for .bottom-tabs, #lg-lens-fab for .fab) —
        displacement → light blur → saturation, i.e. the whole glass
        material in a single filter.
     4. Adds `glass-refract` to <html>; components.css routes those
        surfaces' backdrop-filter to the SVG filters and turns off the
        painted lens layers (real refraction replaces the CSS-faked
        one; Safari keeps the faked version).

   The pill's width tracks the viewport (fixed 14px side margins), so
   maps regenerate on resize. Respects prefers-reduced-transparency
   live — the class comes off and the token-swap fallback takes over. */

const SVG_NS = "http://www.w3.org/2000/svg";
const FILTER_IDS = { pill: "lg-lens-pill", fab: "lg-lens-fab" } as const;

/* Displacement strength in px at the very edge of the lens, and the
   width of the refracting edge band. Tuned to read as thick glass
   without smearing tab labels (the label zone sits inside the
   neutral center). */
const DISPLACE_SCALE = 26;
const EDGE_BAND_PX = 14;
/* Post-displacement softening + saturation — replaces the flat
   blur(30px) recipe on refracting surfaces; displacement carries the
   glass read so the blur can drop, keeping content shapes visible. */
const BLUR_STD_DEV = 7;
const SATURATE = 1.7;

function isChromium(): boolean {
  const uaData = (navigator as unknown as {
    userAgentData?: { brands?: Array<{ brand: string }> };
  }).userAgentData;
  return !!uaData?.brands?.some((b) => /chromium|google chrome|microsoft edge/i.test(b.brand));
}

function reducedTransparency(): MediaQueryList | null {
  try {
    return window.matchMedia("(prefers-reduced-transparency: reduce)");
  } catch {
    return null;
  }
}

/* Rounded-rect signed distance (negative inside). Standard SDF:
   d = |p| - halfSize + r, clamped. */
function roundedRectSDF(px: number, py: number, hw: number, hh: number, r: number): number {
  const qx = Math.abs(px) - (hw - r);
  const qy = Math.abs(py) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ax, ay) - r;
}

/* Build a displacement map for a w×h rounded rect: pixels within
   EDGE_BAND_PX of the edge displace outward (sampling the backdrop
   further out, which optically compresses it at the rim — the lens
   read), eased with a smooth ramp; the center stays neutral (0.5). */
function makeDisplacementMap(w: number, h: number, radius: number): string | null {
  if (w < 8 || h < 8 || typeof OffscreenCanvas === "undefined") return null;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.min(radius, hw, hh);
  const eps = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hw;
      const py = y + 0.5 - hh;
      const d = roundedRectSDF(px, py, hw, hh, r);
      // 0 at the edge → 1 at EDGE_BAND_PX inside; outside stays 0.
      const t = Math.min(Math.max(-d / EDGE_BAND_PX, 0), 1);
      const band = 1 - t;
      const eased = band * band * (3 - 2 * band); // smoothstep
      // Outward normal from the SDF gradient (central differences).
      const gx = roundedRectSDF(px + eps, py, hw, hh, r) - roundedRectSDF(px - eps, py, hw, hh, r);
      const gy = roundedRectSDF(px, py + eps, hw, hh, r) - roundedRectSDF(px, py - eps, hw, hh, r);
      const len = Math.hypot(gx, gy) || 1;
      const nx = (gx / len) * eased;
      const ny = (gy / len) * eased;
      const i = (y * w + x) * 4;
      data[i] = Math.round(127.5 + nx * 127.5); // R: x displacement
      data[i + 1] = Math.round(127.5 + ny * 127.5); // G: y displacement
      data[i + 2] = 127.5;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Synchronous data URL: OffscreenCanvas lacks toDataURL, so draw via
  // a regular canvas (tiny — runs once per resize, not per frame).
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const outCtx = out.getContext("2d");
  if (!outCtx) return null;
  outCtx.drawImage(canvas, 0, 0);
  return out.toDataURL("image/png");
}

function buildFilter(id: string, w: number, h: number, mapUrl: string): SVGFilterElement {
  const filter = document.createElementNS(SVG_NS, "filter");
  filter.setAttribute("id", id);
  filter.setAttribute("x", "0");
  filter.setAttribute("y", "0");
  filter.setAttribute("width", String(w));
  filter.setAttribute("height", String(h));
  filter.setAttribute("filterUnits", "userSpaceOnUse");
  filter.setAttribute("color-interpolation-filters", "sRGB");

  const feImage = document.createElementNS(SVG_NS, "feImage");
  feImage.setAttribute("href", mapUrl);
  feImage.setAttribute("x", "0");
  feImage.setAttribute("y", "0");
  feImage.setAttribute("width", String(w));
  feImage.setAttribute("height", String(h));
  feImage.setAttribute("preserveAspectRatio", "none");
  feImage.setAttribute("result", "map");

  const feDisp = document.createElementNS(SVG_NS, "feDisplacementMap");
  feDisp.setAttribute("in", "SourceGraphic");
  feDisp.setAttribute("in2", "map");
  feDisp.setAttribute("scale", String(DISPLACE_SCALE));
  feDisp.setAttribute("xChannelSelector", "R");
  feDisp.setAttribute("yChannelSelector", "G");

  const feBlur = document.createElementNS(SVG_NS, "feGaussianBlur");
  feBlur.setAttribute("stdDeviation", String(BLUR_STD_DEV));

  const feSat = document.createElementNS(SVG_NS, "feColorMatrix");
  feSat.setAttribute("type", "saturate");
  feSat.setAttribute("values", String(SATURATE));

  filter.append(feImage, feDisp, feBlur, feSat);
  return filter;
}

export function initGlassRefraction(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (!isChromium()) return;
  try {
    if (!CSS.supports("backdrop-filter", "url(#lg)")) return;
  } catch {
    return;
  }

  const root = document.documentElement;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.style.overflow = "hidden";
  const defs = document.createElementNS(SVG_NS, "defs");
  svg.appendChild(defs);
  document.body.appendChild(svg);

  const current: Record<string, { w: number; h: number }> = {};

  const rebuild = (kind: keyof typeof FILTER_IDS, w: number, h: number, radius: number) => {
    w = Math.round(w);
    h = Math.round(h);
    if (w < 8 || h < 8) return;
    const prev = current[kind];
    if (prev && prev.w === w && prev.h === h) return;
    const mapUrl = makeDisplacementMap(w, h, radius);
    if (!mapUrl) return;
    document.getElementById(FILTER_IDS[kind])?.remove();
    defs.appendChild(buildFilter(FILTER_IDS[kind], w, h, mapUrl));
    current[kind] = { w, h };
  };

  const measure = () => {
    // Prefer the live element; fall back to the known chrome geometry
    // (pill: viewport − 2×14px side margins × --bottom-tabs-h; FAB:
    // 54px disc) so the filters exist even before the chrome mounts
    // (auth screen has neither) or while it's display:none.
    const pill = document.querySelector<HTMLElement>(".bottom-tabs");
    const pw = (pill && pill.offsetWidth) || window.innerWidth - 28;
    const ph = (pill && pill.offsetHeight) || 66;
    rebuild("pill", pw, ph, ph / 2);
    const fab = document.querySelector<HTMLElement>(".fab");
    const fw = (fab && fab.offsetWidth) || 54;
    rebuild("fab", fw, fw, fw / 2);
  };

  const rt = reducedTransparency();
  const sync = () => {
    const on = !(rt && rt.matches);
    root.classList.toggle("glass-refract", on);
    if (on) measure();
  };
  rt?.addEventListener?.("change", sync);
  sync();

  // The pill is width: viewport − margins; regenerate on resize. The
  // chrome surfaces mount/unmount (auth screen has neither), so poll
  // lazily on resize + after mount via a one-shot observer pass.
  let raf = 0;
  const onResize = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(measure);
  };
  window.addEventListener("resize", onResize, { passive: true });
  // Re-measure once the real chrome has mounted (its offsetWidth can
  // differ from the viewport fallback by the safe-area insets).
  setTimeout(measure, 1500);
  setTimeout(measure, 5000);
}
