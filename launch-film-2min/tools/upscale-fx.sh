#!/usr/bin/env bash
# Real-ESRGAN 4× of the game's FX sprite strips (assets/fx/*.webp, RGBA) → public/art/fx4/*.png
set -euo pipefail
cd "$(dirname "$0")/.."
RESR=${RESR:-/tmp/claude-0/resr/realesrgan-ncnn-vulkan}
WORK=${WORK:?}
mkdir -p "$WORK/fx/in" "$WORK/fx/out" public/art/fx4
for n in explosion-atomic explosion-fire explosion-ink radar submarine mine turret splash smoke-atomic smoke; do
  [ -f "$WORK/fx/in/$n.png" ] || ffmpeg -v error -y -i ../assets/fx/$n.webp "$WORK/fx/in/$n.png"
done
"$RESR" -i "$WORK/fx/in" -o "$WORK/fx/out" -n realesr-animevideov3 -s 4 -g 0 -j 1:3:1 -f png
cp "$WORK/fx/out/"*.png public/art/fx4/
echo FXDONE
