#!/bin/bash
# Builds assets/ink/ from assets/images/: every line-art PNG becomes a pure-black
# alpha mask (alpha = sourceAlpha * (1 - luminance)) so expo-image's tintColor
# renders it as ink on paper. Needs ImageMagick 7 (`brew install imagemagick`).
# Re-run after dropping new art: npm run assets
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=assets/images
DST=assets/ink

mask() { # mask <name> [ops before trim] [trim yes|no] [max side, 0 = keep]
  local name=$1 extra=${2:-} trim=${3:-yes} max=${4:-0}
  local trimop="" sizeop=""
  [ "$trim" = yes ] && trimop="-trim +repage"
  [ "$max" != 0 ] && sizeop="-resize ${max}x${max}>"
  mkdir -p "$DST/$(dirname "$name")"
  # shellcheck disable=SC2086
  magick "$SRC/$name.png" \
    \( -clone 0 -alpha extract \) \
    \( -clone 0 -alpha off -colorspace gray -level 6%,94% -negate \) \
    \( -clone 1 -clone 2 -compose multiply -composite \) \
    -delete 0-2 \
    \( +clone -fill black -colorize 100 \) +swap \
    -alpha off -compose copy_opacity -composite \
    $extra $trimop $sizeop \
    -define png:color-type=4 -strip "$DST/$name.png"
  echo "  $name  $(magick "$DST/$name.png" -format '%wx%h' info:)"
}

echo "ships (face left, trimmed to the hull)"
for s in battleship cruiser destroyer boat; do mask "ships/ship-$s"; done

echo "avatars"
for i in 1 2 3 4; do mask "avatars/avatar-$i" "" yes 384; done
mask avatars/captain

echo "arsenal icons"
for a in aa-gun radar mine submarine bomber torpedo-bomber double-torpedo-bomber atomic-bomber; do
  mask "arsenal/arsenal-$a" "" yes 256
done

echo "fx (flight sprites mirrored to face right)"
for p in bomber torpedo atomic; do mask "fx/plane-$p" "-flop" yes 384; done
mask fx/plane-downed "" yes 384
mask fx/smoke-puff "" yes 256

echo "board watermarks"
for w in anchor kraken tiger; do mask "board/watermark-$w"; done

echo "brand"
mask brand/logo

echo "ui"
mask ui/hand-pointer "" yes 256
for i in 1 2 3 4 5 6 7 8; do mask "ui/emote-0$i" "" yes 256; done

echo "city map (full frame, lighter level so the water wash stays faint)"
mkdir -p "$DST/city"
magick "$SRC/city/city-port.png" -alpha off -colorspace gray -level 10%,92% -negate \
  \( +clone -fill black -colorize 100 \) +swap -alpha off -compose copy_opacity -composite \
  -define png:color-type=4 -strip "$DST/city/city-port.png"
echo "  city/city-port  $(magick "$DST/city/city-port.png" -format '%wx%h' info:)"

echo "brand icons from the battleship (app.json points at these)"
INK="#3E2FB8"; PAPER="#FBFCFE"
GRID=""; for i in $(seq 0 32 1024); do GRID="$GRID line $i,0 $i,1024 line 0,$i 1024,$i"; done
MAJOR=""; for i in $(seq 0 160 1024); do MAJOR="$MAJOR line $i,0 $i,1024 line 0,$i 1024,$i"; done
paper() {
  magick -size 1024x1024 xc:"$1" -stroke "#CFE9F6" -strokewidth 3 -draw "$GRID" \
    -stroke "#A6D8EE" -strokewidth 4 -draw "$MAJOR" "$2"
}
# The hull mirrored so the bow points up-right, tinted, with the hatching thickened.
ship() {
  magick "$DST/ships/ship-battleship.png" -flop -resize "${1}x" \
    -channel A -evaluate multiply 1.6 +channel \
    \( +clone -alpha extract \) \( -clone 0 -alpha off -fill "$INK" -colorize 100 \) \
    -delete 0 +swap -alpha off -compose copy_opacity -composite \
    -background none -rotate -45 +repage "$2"
}
TMP=$(mktemp -d)
paper "$PAPER" "$TMP/paper.png"; paper none "$TMP/rules.png"
ship 1000 "$TMP/big.png"; ship 620 "$TMP/safe.png"
magick "$TMP/paper.png" -fill none -stroke "$INK" -strokewidth 80 -draw "rectangle 0,0 1024,1024" \
  "$TMP/big.png" -gravity center -compose over -composite -strip "$DST/brand/icon.png"
magick "$TMP/rules.png" "$TMP/safe.png" -gravity center -compose over -composite -strip "$DST/brand/adaptive-icon.png"
# Splash: a paper disc on the desk colour, ship inside the 66% zone Android 12 keeps.
# NOTE: app.json points at the `-hero` files, not these — the launch screen and
# both launcher icons are the colour captain art, built by `npm run brand`
# (scripts/make-brand.mjs, no ImageMagick needed). The ink splash and icons
# below are kept as the monochrome alternatives; nothing here writes -hero.png.
magick "$TMP/paper.png" "$TMP/safe.png" -gravity center -compose over -composite \
  \( -size 1024x1024 xc:black -fill white -draw "circle 512,512 512,8" \) \
  -alpha off -compose copy_opacity -composite -strip "$DST/brand/splash.png"
rm -rf "$TMP"
echo "  brand/icon, brand/adaptive-icon, brand/splash — 1024x1024, ship in the 66% safe zone"

echo "done: $(du -sh "$DST" | cut -f1) in $DST"
