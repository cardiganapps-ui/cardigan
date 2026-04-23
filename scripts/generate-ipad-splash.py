#!/usr/bin/env python3
"""Generate iPad splash screens for the Cardigan PWA.

Creates a flat brand-colored background with a centered logo. Outputs to
public/splash/ at native pixel dimensions for each iPad form factor.
Run from repo root: python3 scripts/generate-ipad-splash.py
"""
import os
from PIL import Image, ImageDraw, ImageFilter

BG_LIGHT = (250, 248, 245)
TEAL_TOP = (107, 181, 197)
TEAL_BOTTOM = (67, 125, 140)
WHITE = (255, 255, 255, 247)

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "splash")

DEVICES = [
    ("ipad-mini",   744, 1133),
    ("ipad-10",     810, 1080),
    ("ipad-air",    820, 1180),
    ("ipad-pro-11", 834, 1194),
    ("ipad-pro-13", 1024, 1366),
]


def gradient_circle(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(1, size - 1)
        r = int(TEAL_TOP[0] + (TEAL_BOTTOM[0] - TEAL_TOP[0]) * t)
        g = int(TEAL_TOP[1] + (TEAL_BOTTOM[1] - TEAL_TOP[1]) * t)
        b = int(TEAL_TOP[2] + (TEAL_BOTTOM[2] - TEAL_TOP[2]) * t)
        draw.line([(0, y), (size, y)], fill=(r, g, b, 255))

    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse((0, 0, size, size), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def render(width_pt, height_pt, scale=2):
    w, h = width_pt * scale, height_pt * scale
    img = Image.new("RGB", (w, h), BG_LIGHT)
    short = min(w, h)
    badge_size = int(short * 0.32)

    badge = gradient_circle(badge_size)
    shadow_pad = int(badge_size * 0.18)
    shadow = Image.new("RGBA", (badge_size + shadow_pad * 2, badge_size + shadow_pad * 2), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.ellipse((shadow_pad, shadow_pad, shadow_pad + badge_size, shadow_pad + badge_size), fill=(40, 70, 80, 70))
    shadow = shadow.filter(ImageFilter.GaussianBlur(shadow_pad * 0.5))

    bx = (w - badge_size) // 2
    by = (h - badge_size) // 2
    img.paste(shadow, (bx - shadow_pad, by - shadow_pad + int(badge_size * 0.04)), shadow)
    img.paste(badge, (bx, by), badge)

    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    label = "Cardigan"
    od.text((w / 2, by + badge_size + int(badge_size * 0.28)), label,
            fill=(46, 46, 46, 230), anchor="mm")
    img.paste(overlay, (0, 0), overlay)
    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, w, h in DEVICES:
        portrait = render(w, h)
        portrait.save(os.path.join(OUT_DIR, f"{name}-portrait.png"), optimize=True)
        landscape = render(h, w)
        landscape.save(os.path.join(OUT_DIR, f"{name}-landscape.png"), optimize=True)
        print(f"  {name}: {w}x{h} portrait + {h}x{w} landscape")


if __name__ == "__main__":
    main()
