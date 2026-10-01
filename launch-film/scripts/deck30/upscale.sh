#!/usr/bin/env bash
# Deck30 — Real-ESRGAN (realesr-animevideov3, 2x; 4x for the poster) plates of the low-res battle recordings.
#
# The battle clips are 1280x576. Deck30 pushes into the explosions (poster, strobe, the drop), which at
# plain Lanczos would be 3-4x the native size; the brief caps everything at ~1.5x. As in the 2-minute
# film (tools/upscale.sh on its branch), the anime-video model rebuilds the ink line art, so the 2560x1152
# plates count as the native source and the pushes stay at <= ~1.5x of them.
#
# Only the stretches Deck30 uses (plus handles) are upscaled. Output: build/deck30/esr/<name>/out/*.png,
# encoded by scripts/deck30/prepare_media.py. Restartable: frames already done are skipped.
# Needs: the realesrgan-ncnn-vulkan v0.2.5.0 release (downloaded here into build/tools/) and a Vulkan
# driver (mesa-vulkan-drivers: lavapipe runs it on the CPU, ~25 s a frame on 4 cores).
set -euo pipefail
cd "$(dirname "$0")/../.."
DA=../demo-assets
TOOLS=build/tools/resr
RESR=$TOOLS/realesrgan-ncnn-vulkan
if [ ! -x "$RESR" ]; then
  mkdir -p "$TOOLS"
  curl -sSL -o "$TOOLS/resr.zip" https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-ubuntu.zip
  (cd "$TOOLS" && unzip -oq resr.zip && chmod +x realesrgan-ncnn-vulkan)
fi
export VK_ICD_FILENAMES=${VK_ICD_FILENAMES:-/usr/share/vulkan/icd.d/lvp_icd.json}

run() { # name source start end [scale]   (source seconds; frames at CFR 30)
  local name=$1 src=$2 ss=$3 to=$4 sc=${5:-2} W=build/deck30/esr/$1
  mkdir -p "$W/in" "$W/out" "$W/todo"
  if [ -z "$(ls -A "$W/in")" ]; then
    ffmpeg -v error -y -ss "$ss" -to "$to" -i "$src" -vf fps=30 -fps_mode cfr -start_number 0 "$W/in/f%04d.png"
  fi
  rm -f "$W/todo/"*
  for f in "$W/in/"*.png; do b=$(basename "$f"); [ -f "$W/out/$b" ] || cp "$f" "$W/todo/$b"; done
  if [ -n "$(ls -A "$W/todo")" ]; then
    "$RESR" -i "$W/todo" -o "$W/out" -n realesr-animevideov3 -s "$sc" -g 0 -j 1:2:1 -f png >/dev/null 2>&1
  fi
  echo "DONE $name $(ls "$W/out" | wc -l)/$(ls "$W/in" | wc -l) frames"
}
# keep these ranges in step with MEDIA in scripts/deck30/prepare_media.py
run poster  $DA/arsenal-attack.mp4 1.30 2.434 4 # 4x: the poster + ALIVE push right into the fireball
run atomic  $DA/arsenal-attack.mp4 0.80 3.334   # flash 1.0 → fireball 1.4 (the poster) → mushroom → 3x3 marks
# (no victory plate: VICTORY. shows the result screen's clean backdrop art, see src/deck30/scenes/Victory.tsx)
run raid    $DA/base-attack.mp4    1.25 3.700   # bomber run → the last hit (3.0) → smoke
run defense $DA/defense.mp4        0.20 2.000   # bomber over your board → AA gun → "Shot down!"
echo ALLDONE
