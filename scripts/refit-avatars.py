#!/usr/bin/env python3
"""Re-fit each preset avatar SVG so it renders cleanly inside a circular
mask without any character art being clipped.

For each SVG in public/avatars/:
  1. Find the first <path> (the full-viewBox square background) and
     replace it with a <circle cx=512 cy=512 r=512 fill={same_color}>.
     The inscribed circle now becomes the actual background — when the
     CSS clips the img to a circle, the entire visible area is filled.
  2. Wrap every drawing element AFTER the new circle (the character art)
     in a <g transform="translate(512 512) scale(0.86) translate(-512 -512)">.
     This scales the character art to 86% around the centre, pulling
     motifs that previously brushed the inscribed-circle boundary
     (flower stamen, ear tips, avocado pip) safely inside.

Idempotent: scans for an already-applied marker and skips files that
have been processed before.

Run: python3 scripts/refit-avatars.py
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "public" / "avatars"
MARK = "data-cardigan-refit=\"1\""

bg_path_re = re.compile(
    r'<path\s+d="M[^"]+"\s+fill="(#[a-fA-F0-9]{3,8})"\s+fill-rule="nonzero"\s+opacity="1"\s+stroke="none"\s*/>',
    re.S,
)
layer_open_re = re.compile(r'(<g[^>]*id="Layer-1"[^>]*>)')
layer_close_re = re.compile(r'</g>(\s*</svg>)')

DEFAULT_SCALE = 0.86
DEFAULT_TY    = 512   # vertical centre after the inner translate

# Per-file overrides — animals wear sweaters whose bottom corners
# extend close to the artwork's bounding-box corners. Those corners
# fall outside the inscribed circle at scale 0.86, so the sweater gets
# clipped where it should be most visible. We shrink the animal art
# slightly and shift it down a touch so the whole sweater sits inside
# the visible circle.
PER_FILE = {
    "perrito.svg": {"scale": 0.80, "ty": 542},
    "carly.svg":   {"scale": 0.80, "ty": 542},
    "gatito.svg":  {"scale": 0.80, "ty": 542},
    "osito.svg":   {"scale": 0.80, "ty": 542},
}

n_done = 0
for svg_path in sorted(ROOT.glob("*.svg")):
    raw = svg_path.read_text()
    if MARK in raw:
        print(f"  · {svg_path.name} already refit, skipping")
        continue

    cfg = PER_FILE.get(svg_path.name, {})
    scale = cfg.get("scale", DEFAULT_SCALE)
    ty    = cfg.get("ty",    DEFAULT_TY)

    # 1. swap bg rect for a circle of the same colour
    m = bg_path_re.search(raw)
    if not m:
        print(f"  ! {svg_path.name}: couldn't locate background path, skipping")
        continue
    bg_color = m.group(1)
    new_bg = f'<circle {MARK} cx="512" cy="512" r="512" fill="{bg_color}" stroke="none"/>'
    out = raw[: m.start()] + new_bg + raw[m.end():]

    # 2. wrap the rest of Layer-1 content in a centre-anchored scale
    layer_open = layer_open_re.search(out)
    if not layer_open:
        print(f"  ! {svg_path.name}: couldn't locate Layer-1 group, skipping")
        continue
    insert_at = layer_open.end()
    # Find where the new circle ends so we wrap only the character art.
    circle_end = out.index("/>", insert_at) + 2
    layer_close = layer_close_re.search(out, circle_end)
    if not layer_close:
        print(f"  ! {svg_path.name}: couldn't locate Layer-1 closing tag, skipping")
        continue

    transform_open = (
        f'<g transform="translate(512 {ty}) scale({scale}) translate(-512 -512)">'
    )
    out = (
        out[: circle_end]
        + transform_open
        + out[circle_end : layer_close.start()]
        + "</g>"
        + out[layer_close.start():]
    )

    svg_path.write_text(out)
    n_done += 1
    print(f"  ✓ {svg_path.name}")

print(f"\n{n_done} SVG{'s' if n_done != 1 else ''} refit.")
