#!/usr/bin/env python3
"""
The Port City art, derived from assets/port_city_assets/ (see its README.txt and
manifest.json). Needs Python 3 + Pillow + numpy (`pip install pillow numpy`).
Run by scripts/color-assets.sh (npm run assets) when Pillow is available, or on
its own with `npm run assets:city`. Output: assets/city/ (commit it; EAS never
runs this).

 - map.jpg: the harbour map. It is opaque, so JPEG (as the page backdrops are):
   a tenth of the 3.4 MB PNG and several times faster to decode.
 - buildings/*.webp, ui/*.webp: the cut-outs as supplied — same pixel size, same
   12 px transparent padding, paper inside ribbons and panels kept — as WebP.
 - popup/panel.webp: the complete Coming Soon popup with its baked Return Home
   ribbon and its baked "Returning home in 5s" painted out in the panel's
   paper. The screen draws popup/return-home.webp (the supplied
   popup_parts/return_home_button.png, an exact crop of the popup) back on the
   same spot as a real button, and a live countdown where the sample line was —
   so exactly one button and one countdown are ever visible.

The two crops' offsets inside the popup (BUTTON_AT, COUNTDOWN_AT) are asserted
here pixel for pixel, and src/features/city/cityLayout.ts uses the same numbers.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "port_city_assets"
OUT = ROOT / "assets" / "city"

# Where the popup_parts crops sit inside ui/coming_soon_popup.png (image px).
BUTTON_AT = (97, 644)
COUNTDOWN_AT = (277, 754)

UI_PIECES = [
    "port_city_title",
    "admiralty_label",
    "fish_market_label",
    "foundry_label",
    "scrapyard_label",
    "naval_academy_label",
    "shipyard_label",
    "your_harbour_ribbon",
    "counter_frame_small",
    "coin",
    "gem",
    "home",
    "padlock",
    "compass",
    "location_flag",
    "explore_hint",
]


def save_webp(img: Image.Image, path: Path, quality: int = 90) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "WEBP", quality=quality, method=6, exact=False)


def assert_crop(panel: np.ndarray, part: np.ndarray, at: tuple[int, int], name: str) -> None:
    """The part must be the panel's own pixels wherever the part is visible."""
    x, y = at
    h, w = part.shape[:2]
    region = panel[y : y + h, x : x + w, :3].astype(int)
    mask = part[:, :, 3] > 0
    diff = np.abs(region - part[:, :, :3].astype(int))[mask].max(initial=0)
    if diff > 2:
        sys.exit(f"{name} is no longer an exact crop of the popup at {at} (max diff {diff})")


def paint_out(panel: np.ndarray, mask: np.ndarray, rng: np.random.Generator) -> None:
    """Fill the masked pixels with the panel's plain paper, grain included."""
    # The paper's colour, sampled from the clean band between the anchor
    # divider and the ribbon and beside the sample line.
    samples = np.concatenate(
        [
            panel[760:795, 505:560, :3].reshape(-1, 3),
            panel[760:795, 225:270, :3].reshape(-1, 3),
        ]
    ).astype(float)
    mean = samples.mean(axis=0)
    std = samples.std(axis=0).clip(max=2.5)
    fill = mean + rng.normal(0.0, 1.0, size=panel.shape[:2] + (1,)) * std
    # Feather: fully replaced inside the mask, a soft 2 px edge outside it.
    soft = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    alpha = np.maximum(np.asarray(soft).astype(float) / 255.0, mask.astype(float))[..., None]
    panel[:, :, :3] = (panel[:, :, :3] * (1 - alpha) + fill * alpha).round().clip(0, 255)


def dilate(mask: np.ndarray, px: int) -> np.ndarray:
    img = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(px * 2 + 1))
    return np.asarray(img) > 127


def place(mask_small: np.ndarray, at: tuple[int, int], shape: tuple[int, int]) -> np.ndarray:
    out = np.zeros(shape, dtype=bool)
    x, y = at
    h, w = mask_small.shape
    out[y : y + h, x : x + w] = mask_small
    return out


def main() -> None:
    manifest = {entry["file"]: entry for entry in json.loads((SRC / "manifest.json").read_text())}

    print("city: map")
    OUT.mkdir(parents=True, exist_ok=True)
    Image.open(SRC / "backgrounds_and_reference" / "port_city_map_background.png").convert("RGB").save(
        OUT / "map.jpg", "JPEG", quality=88, optimize=True, progressive=True
    )

    print("city: buildings")
    for file in sorted(f for f in manifest if f.startswith("buildings/")):
        img = Image.open(SRC / file).convert("RGBA")
        assert img.size == (manifest[file]["width"], manifest[file]["height"]), file
        save_webp(img, OUT / "buildings" / (Path(file).stem + ".webp"))

    print("city: hud pieces")
    for name in UI_PIECES:
        img = Image.open(SRC / "ui" / f"{name}.png").convert("RGBA")
        save_webp(img, OUT / "ui" / f"{name}.webp", quality=92)

    print("city: coming soon panel")
    popup = np.asarray(Image.open(SRC / "ui" / "coming_soon_popup.png").convert("RGBA")).copy()
    button = np.asarray(Image.open(SRC / "popup_parts" / "return_home_button.png").convert("RGBA"))
    countdown = np.asarray(Image.open(SRC / "popup_parts" / "countdown_text.png").convert("RGBA"))
    assert_crop(popup, button, BUTTON_AT, "return_home_button.png")
    assert_crop(popup, countdown, COUNTDOWN_AT, "countdown_text.png")

    shape = popup.shape[:2]
    # The ribbon's whole silhouette (its paper and hatching included), grown a
    # little so no anti-aliased outline survives at its edge.
    ribbon = place(dilate(button[:, :, 3] > 0, 3), BUTTON_AT, shape)
    # The sample line: only its ink, grown, so the paper round it is untouched.
    ink = (countdown[:, :, 3] > 16) & (countdown[:, :, :3].mean(axis=2) < 225)
    line = place(dilate(ink, 3), COUNTDOWN_AT, shape)
    # Never touch the panel's own frame (its bottom rule sits at y ~ 800).
    keep = np.zeros(shape, dtype=bool)
    keep[797:, :] = True
    paint_out(popup, (ribbon | line) & ~keep & (popup[:, :, 3] > 0), np.random.default_rng(7))
    save_webp(Image.fromarray(popup, "RGBA"), OUT / "popup" / "panel.webp", quality=90)
    save_webp(Image.fromarray(button, "RGBA"), OUT / "popup" / "return-home.webp", quality=92)

    total = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    print(f"city: {total / 1024:.0f} KB in {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
