#!/usr/bin/env bash
# Real-ESRGAN (realesr-animevideov3, 4x) upscale of the low-res battle clips.
# Source 1280x576 VFR -> CFR 30 PNG frames -> 5120x2304 -> encoded later by tools/prep-media.sh.
# Needs: realesrgan-ncnn-vulkan (github.com/xinntao/Real-ESRGAN release v0.2.5.0) + mesa-vulkan-drivers (CPU lavapipe).
set -euo pipefail
RESR=${RESR:-/tmp/claude-0/resr/realesrgan-ncnn-vulkan}
WORK=${WORK:?set WORK to a scratch dir}
SRC=/home/user/battleship-solana-mobile/demo-assets
run() { # name file start end
  local name=$1 file=$2 ss=$3 to=$4
  mkdir -p "$WORK/$name/in" "$WORK/$name/out"
  if [ -z "$(ls -A "$WORK/$name/in")" ]; then
    ffmpeg -v error -y -ss "$ss" -to "$to" -i "$SRC/$file" -vf "fps=30" -start_number 0 "$WORK/$name/in/f%04d.png"
  fi
  # skip frames already done (restartable)
  mkdir -p "$WORK/$name/todo"; rm -f "$WORK/$name/todo/"*
  for f in "$WORK/$name/in/"*.png; do b=$(basename "$f"); [ -f "$WORK/$name/out/$b" ] || cp "$f" "$WORK/$name/todo/$b"; done
  if [ -n "$(ls -A "$WORK/$name/todo")" ]; then
    "$RESR" -i "$WORK/$name/todo" -o "$WORK/$name/out" -n realesr-animevideov3 -s 4 -g 0 -j 1:3:1 -f png
  fi
  echo "DONE $name $(ls "$WORK/$name/out" | wc -l) frames"
}
run arsenal arsenal-attack.mp4 0 3.34
run defense defense.mp4 0 2.74
run base base-attack.mp4 1.5 6.58
echo ALLDONE
