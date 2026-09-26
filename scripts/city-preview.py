#!/usr/bin/env python3
"""
Renders the Port City composition from src/features/city/cityLayout.ts onto
the map, outside the app, so plot choices can be checked by eye:

    node --experimental-strip-types --no-warnings -e \
      "import('./src/features/city/cityLayout.ts').then(m => console.log(JSON.stringify(
        {b: m.BUILDINGS, r: m.HARBOUR_RIBBON})))" > /tmp/city-layout.json
    python3 scripts/city-preview.py /tmp/city-layout.json out.png [--hits]

Needs Pillow and the built assets/city/ (npm run assets:city).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
CITY = ROOT / "assets" / "city"

LABELS = {"admiralty", "fish_market", "foundry", "scrapyard", "naval_academy", "shipyard"}


def paste(canvas: Image.Image, src: Path, box: dict) -> None:
    art = Image.open(src).convert("RGBA").resize(
        (round(box["w"]), round(box["h"])), Image.LANCZOS
    )
    canvas.alpha_composite(art, (round(box["x"]), round(box["y"])))


def main() -> None:
    data = json.loads(Path(sys.argv[1]).read_text())
    out = Path(sys.argv[2])
    hits = "--hits" in sys.argv
    canvas = Image.open(CITY / "map.jpg").convert("RGBA")
    paste(canvas, CITY / "ui" / "your_harbour_ribbon.webp", data["r"])
    for b in data["b"]:
        paste(canvas, CITY / "buildings" / f"{b['id']}.webp", b["box"])
    for b in data["b"]:
        if b["id"] in LABELS and b.get("labelBox"):
            paste(canvas, CITY / "ui" / f"{b['id']}_label.webp", b["labelBox"])
    if hits:
        draw = ImageDraw.Draw(canvas)
        for b in data["b"]:
            h = b["hit"]
            draw.rectangle([h["x"], h["y"], h["x"] + h["w"], h["y"] + h["h"]], outline=(220, 0, 0, 255), width=2)
            draw.text((h["x"] + 4, h["y"] + 4), b["id"], fill=(220, 0, 0, 255))
    canvas.convert("RGB").save(out)


if __name__ == "__main__":
    main()
