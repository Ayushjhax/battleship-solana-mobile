#!/bin/bash
# The store's art and the country flags, derived from assets/store/,
# assets/store_assets/ and assets/20-country-flags/. Needs ImageMagick 7. Run
# by scripts/color-assets.sh (npm run assets), or on its own.
#
#  - shop/<colour>/<item>.webp: every colour variant trimmed to its drawing
#    (alpha over 3 %), a 3 % margin, 320 px on the longer side.
#  - shop/tab-<colour>.png and tab-<colour>-dim.png: the colour tabs, and the
#    washed-out copy an unselected tab shows.
#  - shop/icon-<section>.png: the section glyphs cut out of the header art
#    (their pastel keyed out; the app draws the header pill itself).
#  - shop/masthead.png: the logo with the Store plank hanging under it, cut
#    from the sheet in one piece — store_title.png carries a scrap of the
#    ribbon that only lines up with the logo it was drawn under.
#  - flags/<iso>.png: every flag as one badge — cropped to 3:2, rounded, a
#    gloss across the top, a paper border, a navy rim and a soft navy base.
set -euo pipefail
cd "$(dirname "$0")/.."
ST=assets/store
SA=assets/store_assets
FG=assets/20-country-flags
SH=assets/shop
FL=assets/flags
mkdir -p "$SH" "$FL"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# trim_art <src> <out png>: cropped to where the alpha is over 3 %, so a faint
# haze left by the generator doesn't stop the trim.
trim_art() {
  local f=$1 out=$2 box
  box=$(magick "$f" -alpha extract -threshold 3% -format '%@' info:)
  magick "$f" -crop "$box" +repage "PNG32:$out"
}

echo "store items"
for c in crimson emerald purple; do
  mkdir -p "$SH/$c"
  for f in "$ST/$c"/*/*.png; do
    n=$(basename "$f" .png)
    trim_art "$f" "$TMP/item.png"
    read -r W H < <(magick identify -format '%w %h\n' "$TMP/item.png")
    m=$(( (W > H ? W : H) * 3 / 100 + 2 ))
    magick "$TMP/item.png" -bordercolor none -border "$m" -resize '320x320>' \
      -quality 88 -define webp:alpha-quality=100 -define webp:method=6 -strip "$SH/$c/$n.webp"
  done
  echo "  $c  $(ls "$SH/$c" | wc -l | tr -d ' ') items, $(du -sh "$SH/$c" | cut -f1)"
done

echo "store tabs"
for c in crimson emerald purple; do
  trim_art "$SA/tab_$c.png" "$TMP/tab.png"
  magick "$TMP/tab.png" -strip "$SH/tab-$c.png"
  # Unselected: most of the colour drained and lifted toward the paper.
  magick "$TMP/tab.png" -modulate 106,38,100 +level 14%,100% -strip "$SH/tab-$c-dim.png"
  echo "  tab-$c  $(magick identify -format '%wx%h' "$SH/tab-$c.png")"
done

# icon <header> <section> <crop inside the pill> <pill fill> <fuzz %>
icon() {
  magick "$SA/header_$1.png" -crop "$3" +repage -alpha set -fuzz "$5%" -transparent "$4" "PNG32:$TMP/icon.png"
  trim_art "$TMP/icon.png" "$TMP/icon-t.png"
  magick "$TMP/icon-t.png" -bordercolor none -border 3 -strip "$SH/icon-$2.png"
  echo "  icon-$2  $(magick identify -format '%wx%h' "$SH/icon-$2.png")"
}
echo "store section icons"
icon attack attack 60x57+168+22 'rgb(254,205,204)' 9
icon boards boards 90x62+58+19 'rgb(208,236,252)' 6
icon defence defence 62x50+273+20 'rgb(222,249,226)' 6
icon fleet_small fleet 78x64+79+10 'rgb(231,212,252)' 9

echo "store masthead and gear"
magick "$SA/00_full_store_sprite_sheet.png" -crop 540x280+565+0 +repage "PNG32:$TMP/mast.png"
trim_art "$TMP/mast.png" "$TMP/mast-t.png"
magick "$TMP/mast-t.png" -resize '600x600>' -strip "$SH/masthead.png"
trim_art "$SA/settings_icon.png" "$TMP/gear.png"
magick "$TMP/gear.png" -strip "$SH/settings.png"
echo "  masthead  $(magick identify -format '%wx%h' "$SH/masthead.png")"

# The badge: a 162 x 108 flag inside an 8 px paper border and a 5 px navy
# rim, sitting on a navy base 5 px lower.
FW=162 FH=108 R=16 PAPER=8 RIM=5 DROP=5
NAVY="#1D2A5C"
BW=$((FW + 2 * (PAPER + RIM))) BH=$((FH + 2 * (PAPER + RIM)))
rrect() { # rrect <w> <h> <r> <colour> <out>
  magick -size "$1x$2" xc:none -fill "$4" -draw "roundrectangle 0,0 $(($1 - 1)),$(($2 - 1)) $3,$3" "PNG32:$5"
}
rrect "$FW" "$FH" "$R" white "$TMP/fmask.png"
rrect $((FW + 2 * PAPER)) $((FH + 2 * PAPER)) $((R + PAPER)) '#FFFDF6' "$TMP/paper.png"
rrect "$BW" "$BH" $((R + PAPER + RIM)) "$NAVY" "$TMP/rim.png"
# Gloss: white fading out over the top 45 %; shade: a touch of navy at the foot.
magick -size "${FW}x$((FH * 45 / 100))" gradient:'rgba(255,255,255,0.42)-rgba(255,255,255,0)' \
  -background none -extent "${FW}x${FH}" "PNG32:$TMP/gloss.png"
magick -size "${FW}x${FH}" gradient:'rgba(29,42,92,0)-rgba(29,42,92,0.22)' "PNG32:$TMP/shade.png"
magick -size "${BW}x$((BH + DROP))" xc:none \
  \( "$TMP/rim.png" -channel A -evaluate multiply 0.22 +channel \) -geometry "+0+$DROP" -compose over -composite \
  "$TMP/rim.png" -geometry +0+0 -composite \
  "$TMP/paper.png" -geometry "+$RIM+$RIM" -composite +geometry "PNG32:$TMP/frame.png"

# badge <src png or colour> <gravity> <out>
badge() {
  if [ -f "$1" ]; then
    magick "$1" -resize "${FW}x${FH}^" -gravity "$2" -extent "${FW}x${FH}" +gravity "PNG32:$TMP/flag.png"
  else
    magick -size "${FW}x${FH}" "xc:$1" "PNG32:$TMP/flag.png"
  fi
  magick "$TMP/flag.png" "$TMP/shade.png" -compose over -composite "$TMP/gloss.png" -composite \
    "$TMP/fmask.png" -compose copy_opacity -composite "PNG32:$TMP/flag-r.png"
  magick "$TMP/frame.png" "$TMP/flag-r.png" -geometry "+$((PAPER + RIM))+$((PAPER + RIM))" \
    -compose over -composite +geometry -strip "$3"
}

echo "flags"
while read -r file iso gravity; do
  badge "$FG/$file.png" "$gravity" "$FL/$iso.png"
done <<'EOF'
brazil BR center
canada CA center
china CN west
colombia CO center
germany DE center
india IN center
indonesia ID center
iran IR center
italy IT center
japan JP center
mexico MX center
philippines PH west
saudi-arabia SA center
south-korea KR center
spain ES west
thailand TH center
turkey TR west
united-kingdom GB center
united-states US northwest
vietnam VN center
EOF
# The practice admiral and the seeded bots sail as RU (0006_bots.sql), which
# the pack doesn't carry: its tricolour is drawn here. Not in the picker.
magick -size 640x427 xc:'#FFFFFF' -fill '#0039A6' -draw 'rectangle 0,142 639,284' \
  -fill '#D52B1E' -draw 'rectangle 0,285 639,426' "PNG32:$TMP/ru.png"
badge "$TMP/ru.png" center "$FL/RU.png"
# The badge a code with no flag gets (the app writes the code on it).
badge "$NAVY" center "$FL/blank.png"
echo "  $(ls "$FL" | wc -l | tr -d ' ') badges at $(magick identify -format '%wx%h' "$FL/IN.png"), $(du -sh "$FL" | cut -f1)"
