#!/usr/bin/env python3
"""Regenerate the per-theme posture ragdoll spritesheets.

The base art (src/renderer/src/assets/emoji-ragdoll.png) is a yellow emoji-style
figure. For each theme we recolour it to that theme's --accent while preserving the
built-in shading, by mapping each pixel's source luminance through a shadow -> accent
-> highlight ramp (see recolor()). Alpha is passed through untouched so the smooth
downscale still reads cleanly (see StatusIcons.frameStyle).

Output: src/renderer/src/styles/themes/emoji-ragdoll-<theme>.png, wired up per
[data-theme] in styles/toasts.css.

To add a theme: add its id + --accent hex to THEMES below (keep in sync with the
accent in src/renderer/src/lib/themes.ts), run this script, then add a
`:root[data-theme="<id>"] .posture-sprite` rule in styles/toasts.css.

Requires: pillow, numpy.  Run from the repo root:  python scripts/recolor-ragdoll.py
"""
import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "renderer", "src", "assets", "emoji-ragdoll.png")
OUT_DIR = os.path.join(ROOT, "src", "renderer", "src", "styles", "themes")

# theme id -> its --accent colour (keep in sync with THEMES in lib/themes.ts)
THEMES = {
    "magiloom":   "#9a95ff",
    "bloodstone": "#c03030",
    "forest":     "#4a9050",
    "parchment":  "#9a4718",
    "discord":    "#5865f2",
    "ff4":        "#fcfcfc",
}

# ramp shaping: how dark the shadows go, and how far highlights blend toward white
SHADOW_MUL = 0.42
HIGHLIGHT_MIX = 0.55


def hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64) / 255.0


def main():
    img = Image.open(SRC).convert("RGBA")
    arr = np.asarray(img).astype(np.float64) / 255.0
    rgb, alpha = arr[..., :3], arr[..., 3]

    lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    vals = lum[alpha > 0.15]
    lo, hi = np.percentile(vals, 2), np.percentile(vals, 98)  # robust bounds
    t = np.clip((lum - lo) / max(hi - lo, 1e-6), 0.0, 1.0)

    def recolor(base):
        shadow = base * SHADOW_MUL
        highlight = base * (1 - HIGHLIGHT_MIX) + HIGHLIGHT_MIX
        out = np.empty_like(rgb)
        low = t < 0.5
        out[low] = shadow * (1 - (t[low] / 0.5)[..., None]) + base * (t[low] / 0.5)[..., None]
        up = ~low
        tu = ((t[up] - 0.5) / 0.5)[..., None]
        out[up] = base * (1 - tu) + highlight * tu
        return (np.clip(np.dstack([out, alpha]), 0, 1) * 255).round().astype(np.uint8)

    os.makedirs(OUT_DIR, exist_ok=True)
    for name, hexv in THEMES.items():
        dest = os.path.join(OUT_DIR, f"emoji-ragdoll-{name}.png")
        Image.fromarray(recolor(hexrgb(hexv)), "RGBA").save(dest)
        print("wrote", os.path.relpath(dest, ROOT))


if __name__ == "__main__":
    main()
