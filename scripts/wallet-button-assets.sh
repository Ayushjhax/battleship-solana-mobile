#!/bin/bash
# The sign-in screen's "Connect Solana wallet" button, from the art in
# assets/solana-wallet-button-assets/. Needs ImageMagick 7. Run by
# scripts/color-assets.sh (npm run assets), or on its own.
#
# Each source is a large canvas with transparent padding around the drawing,
# so every part is first cropped to its visible pixels (alpha over 25 %, plus
# a margin for the soft edge) and only then sized. The screen lays out what is
# drawn, never the padding, and nothing is ever stretched out of its aspect.
#
#  - login/wallet-button-{l,m,r}.png: the navy plate cut like the other
#    sign-in buttons — two caps that keep the round ends and the inked corner
#    ticks, and the plain middle, which <SlicedImage> stretches to any width.
#  - login/wallet-solana-icon.png, login/wallet-arrow-right.png: the mark on
#    the left and the chevron on the right.
#
# button-label.png is the reference for the label only: the app draws
# "Connect Solana wallet" as live text (Bitter Bold, artColor.ivory), so it is
# readable by screen readers and can say "Opening wallet…" while it works.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=assets/solana-wallet-button-assets
LG=assets/login
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$LG"

visible() { # visible <src> <out> <height px>
  local box w h x y W H m=8
  box=$(magick "$1" -alpha extract -threshold 25% -format '%@' info:)
  read -r w h x y < <(echo "$box" | sed -E 's/([0-9]+)x([0-9]+)\+([0-9]+)\+([0-9]+)/\1 \2 \3 \4/')
  read -r W H < <(magick identify -format '%w %h\n' "$1")
  x=$((x > m ? x - m : 0))
  y=$((y > m ? y - m : 0))
  w=$((w + 2 * m))
  h=$((h + 2 * m))
  if ((x + w > W)); then w=$((W - x)); fi
  if ((y + h > H)); then h=$((H - y)); fi
  magick "$1" -crop "${w}x${h}+${x}+${y}" +repage -resize "x$3" -strip "$2"
  echo "  $(basename "$2")  $(magick identify -format '%wx%h' "$2")  (drawn ${box} of ${W}x${H})"
}

slice() { # slice <src> <out name> <cap px> — left cap | stretch strip | right cap
  local f=$1 n=$2 c=$3 W H
  read -r W H < <(magick identify -format '%w %h\n' "$f")
  magick "$f" -crop "${c}x${H}+0+0" +repage -strip "$LG/$n-l.png"
  magick "$f" -crop "$((W - 2 * c))x${H}+${c}+0" +repage -strip "$LG/$n-m.png"
  magick "$f" -crop "${c}x${H}+$((W - c))+0" +repage -strip "$LG/$n-r.png"
  echo "  $n  ${W}x${H}  caps 0..$c | $c..$((W - c)) | $((W - c))..$W"
}

visible "$SRC/button-background.png" "$TMP/plate.png" 132
visible "$SRC/solana-icon.png" "$LG/wallet-solana-icon.png" 72
visible "$SRC/arrow-right.png" "$LG/wallet-arrow-right.png" 48
# The corner ticks reach about a third of the plate's height in from each end.
read -r _ PH < <(magick identify -format '%w %h\n' "$TMP/plate.png")
slice "$TMP/plate.png" wallet-button $((PH * 42 / 100))
