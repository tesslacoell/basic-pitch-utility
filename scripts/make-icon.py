#!/usr/bin/env python3
"""Generates build/icon.png (512x512) — the app icon for electron-builder.

Design matches the app's palette (neutral-950 background, emerald accent):
an emerald waveform over a piano-keyboard band — audio in, MIDI out.

Requires Pillow:  pip install Pillow
Run from the repo root:  python3 scripts/make-icon.py
The PNG is a build asset; it is regenerated on demand rather than committed
(the GitHub snapshot flow used for this repo is text-only).
"""
import math
import os
from PIL import Image, ImageDraw

SIZE = 512
OUT = os.path.join(os.path.dirname(__file__), "..", "build", "icon.png")

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Rounded-square body
d.rounded_rectangle([8, 8, SIZE - 8, SIZE - 8], radius=96, fill=(10, 10, 10, 255))

# Emerald waveform (sine x decaying envelope), upper half
points = []
for x in range(86, SIZE - 85):
    t = (x - 86) / (SIZE - 172)
    env = math.sin(math.pi * t) ** 0.7
    y = 176 - math.sin(t * math.pi * 6) * 62 * env
    points.append((x, y))
for width, alpha in ((15, 60), (9, 120), (5, 255)):
    d.line(points, fill=(16, 185, 129, alpha), width=width, joint="curve")

# Piano keyboard band, lower half: 7 white keys, 5 black keys
kx0, kx1, ky0, ky1 = 86, SIZE - 86, 292, 424
key_w = (kx1 - kx0) / 7
d.rounded_rectangle([kx0, ky0, kx1, ky1], radius=10, fill=(245, 245, 245, 255))
for i in range(1, 7):
    x = kx0 + i * key_w
    d.line([(x, ky0 + 6), (x, ky1 - 6)], fill=(38, 38, 38, 255), width=4)
for i in (0, 1, 3, 4, 5):  # black keys after white keys 1,2,4,5,6
    cx = kx0 + (i + 1) * key_w
    d.rounded_rectangle(
        [cx - key_w * 0.30, ky0, cx + key_w * 0.30, ky0 + (ky1 - ky0) * 0.62],
        radius=6,
        fill=(23, 23, 23, 255),
    )

os.makedirs(os.path.dirname(OUT), exist_ok=True)
img.save(OUT)
print(f"wrote {OUT} ({SIZE}x{SIZE})")
