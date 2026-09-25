#!/bin/bash
# The colour art drawn as-is (never tinted), derived from assets/images/.
# Needs ImageMagick 7. Run by scripts/ink-assets.sh (npm run assets), or on its
# own. Output: assets/backgrounds/, assets/menu/, assets/login/, assets/name/,
# assets/keyboard/ and the rest of the screens' folders; placement and the
# battle (assets/fx, assets/fleet, assets/battle) are scripts/battle-assets.sh,
# the store and the flags (assets/shop, assets/flags) scripts/store-assets.sh.
#
#  - backgrounds/*.jpg: the full-bleed page backdrops. The sources are ~2.5 MB
#    opaque PNGs; as JPEG they load and decode several times faster, which is
#    what keeps a screen from showing its plain-grid fallback while they land.
#  - menu/icons/: each app icon is drawn on its own pastel tile; the menu puts the
#    glyph alone on its own cards and chips. The tile fill is flood-filled out
#    from eight seeds just inside the border, an inset rounded-rect mask drops
#    the border ring, and the result is trimmed to the glyph. Speaker and wallet
#    arrive bare and are only trimmed and sized.
#  - menu/play-*.jpg: the 3 MB play-card paintings, scaled to what a card can show.
#  - login/*-{l,m,r}.png: the sign-in screen's buttons and fields cut into a left
#    cap, a text-free strip and a right cap for <SlicedImage>, which stretches
#    the strip to any width. The strip is taken from beside the baked label, so
#    the label never shows and the screen draws its own (it changes: "Checking…",
#    "Resend in 24s"). Caps keep the corners and any icon at their own shape.
#  - name/name-input-{l,m,r}.png: the name field, cut the same way.
#  - keyboard/key-*.png: the glyph keys with their glyph erased, so the name
#    screen can draw its own (capitals under shift, digits on the 123 layer).
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=assets/images
DST=assets/menu
BG=assets/backgrounds
LG=assets/login
NM=assets/name
KB=assets/keyboard
mkdir -p "$DST/icons" "$BG" "$LG" "$NM" "$KB"

echo "page backdrops"
for n in first_page logo_background name_background choose_icon match_time match_started decision settings; do
  magick "$SRC/background/$n.png" -quality 88 -strip "$BG/$n.jpg"
  echo "  $n  $(magick "$BG/$n.jpg" -format '%wx%h' info:)  $(du -k "$BG/$n.jpg" | cut -f1) KB"
done

echo "menu icon glyphs (tile stripped)"
for n in coin gem star rank play friends rulebook trophy harbor shop coin-stacks; do
  f="$SRC/app-icons/$n.png"
  read -r W H < <(magick identify -format '%w %h\n' "$f")
  seeds=()
  for fx in 12 50 88; do
    for fy in 12 50 88; do
      [ "$fx" = 50 ] && [ "$fy" = 50 ] && continue
      seeds+=(-draw "color $((W * fx / 100)),$((H * fy / 100)) floodfill")
    done
  done
  ix=$((W * 9 / 100)); iy=$((H * 9 / 100)); r=$((W * 12 / 100))
  magick "$f" -alpha set -fuzz 22% -fill none "${seeds[@]}" \
    \( +clone -alpha extract \
       \( -size "${W}x${H}" xc:black -fill white \
          -draw "roundrectangle $ix,$iy $((W - ix)),$((H - iy)) $r,$r" \) \
       -compose multiply -composite \) \
    -alpha off -compose copy_opacity -composite \
    -trim +repage -resize '160x160>' -strip "$DST/icons/$n.png"
  echo "  icons/$n  $(magick "$DST/icons/$n.png" -format '%wx%h' info:)"
done

echo "menu icon glyphs (already bare, just sized)"
for n in speaker wallet; do
  magick "$SRC/app-icons/$n.png" -trim +repage -resize '160x160>' -strip "$DST/icons/$n.png"
  echo "  icons/$n  $(magick "$DST/icons/$n.png" -format '%wx%h' info:)"
done

echo "play-card art"
for n in online offline; do
  magick "$SRC/background/play_$n.png" -resize '1100x>' -quality 86 -strip "$DST/play-$n.jpg"
  echo "  play-$n  $(magick "$DST/play-$n.jpg" -format '%wx%h' info:)"
done

slice() { # slice <src> <out dir> <out name> <left cap end> <strip start> <strip end> <right cap start>
  local f=$1 d=$2 n=$3 l=$4 m0=$5 m1=$6 r=$7 W H
  read -r W H < <(magick identify -format '%w %h\n' "$f")
  magick "$f" -crop "${l}x${H}+0+0" +repage -strip "$d/$n-l.png"
  magick "$f" -crop "$((m1 - m0))x${H}+${m0}+0" +repage -strip "$d/$n-m.png"
  magick "$f" -crop "$((W - r))x${H}+${r}+0" +repage -strip "$d/$n-r.png"
  echo "  $n  ${W}x${H}  caps 0..$l | $m0..$m1 | $r..$W"
}

echo "login slices (left cap | stretch strip | right cap, source px)"
# Columns found with -connected-components on each image's dark glyphs: every
# strip sits between the icon (or corner) and the baked label.
slice "$SRC/login-assets/google-sign-in-button.png" "$LG" google-sign-in-button 150 150 166 535
slice "$SRC/login-assets/sign-in-button.png" "$LG" sign-in-button 62 62 76 200
slice "$SRC/login-assets/change-email-button.png" "$LG" change-email-button 92 84 94 260
slice "$SRC/login-assets/resend-button.png" "$LG" resend-button 92 86 100 198
slice "$SRC/login-assets/email-input.png" "$LG" email-input 100 110 400 425
slice "$SRC/login-assets/code-input.png" "$LG" code-input 92 110 300 320

echo "keyboard keys with their glyph erased (the name screen draws glyphs live: shift, 123)"
# The glyph is every small dark component in the key's middle; it is painted
# over with a strip of the key's own paper from just left of it, widened past
# the glyph's soft halo. Each key keeps its own hand-drawn frame.
blank_key() {
  local n=$1 f="$SRC/keyboard/key-$1.png" x0 y0 x1 y1 W H
  read -r W H < <(magick identify -format '%w %h\n' "$f")
  read -r x0 y0 x1 y1 < <(magick "$f" -background white -flatten -colorspace gray -threshold 50% -negate \
    -define connected-components:verbose=true -define connected-components:area-threshold=4 \
    -connected-components 8 null: 2>&1 | awk -v W="$W" -v H="$H" '
      NR > 1 && $NF != "gray(0)" {
        split($2, a, /[x+]/); w = a[1]; h = a[2]; x = a[3]; y = a[4]
        if (w < 0.6 * W && x >= 0.2 * W && x + w <= 0.8 * W && y >= 0.2 * H && y + h <= 0.85 * H) {
          if (!n || x < x0) x0 = x; if (!n || y < y0) y0 = y
          if (!n || x + w > x1) x1 = x + w; if (!n || y + h > y1) y1 = y + h; n++
        }
      }
      END { print x0, y0, x1, y1 }')
  x0=$((x0 - 7)); y0=$((y0 - 6)); x1=$((x1 + 7)); y1=$((y1 + 6))
  magick "$f" -crop "4x$((y1 - y0))+$((x0 - 5))+$y0" +repage -resize "$((x1 - x0))x$((y1 - y0))!" miff:- |
    magick "$f" - -geometry "+$x0+$y0" -compose over -composite -strip "$KB/key-$n.png"
}
for k in a b c d e f g h i j k l m n o p q r s t u v w x y z \
  hyphen underscore plus apostrophe at period comma numbers; do
  blank_key "$k"
done
echo "  $(ls "$KB" | wc -l | tr -d ' ') blank keys"

echo "name field slices"
slice "$SRC/name-screen/name-input.png" "$NM" name-input 40 80 340 381

echo "avatar portraits in every tint (the uniform recoloured, everything else untouched)"
# Order is AVATAR_TINTS' order (src/ui/tokens.ts) and the swatch art's; each
# target is the swatch art's own paint, sampled, so a portrait matches the
# square that was tapped. The portrait's native tint is its source as drawn.
AV=assets/avatars
mkdir -p "$AV"
TINTS=(1535DC 976021 4A4949 108C86 CC4716 A51822 156CC9 982088 1C8A1B 3E556F)
BLUE="(hue>0.55 && hue<0.74 && saturation>0.16 && lightness<0.46) ? 1 : 0"
GREY="(((hue>0.5 && hue<0.72 && saturation<0.55) || saturation<0.14) && lightness>0.06 && lightness<0.68) ? 1 : 0"
TMP=$(mktemp -d)
# avatar <id> <art> <native tint> <uniform rule> <min area> <picture inset: left top right bottom>
# The insets keep the frame's hand-drawn inner line out of the mask: measured as
# the first dark pixel after the white mat on each side, plus the line's width.
# The min area drops stray matches (the admiral's navy-hatched moustache is one).
avatar() {
  local id=$1 f="$SRC/avatar-screen/avatar-$2.png" native=$3 rule=$4 area=$5 W H i
  read -r W H < <(magick identify -format '%w %h\n' "$f")
  magick "$f" -alpha off -fx "$rule" -threshold 50% \
    \( -size "${W}x${H}" xc:black -fill white -draw "rectangle $6,$7 $((W - $8)),$((H - $9))" \) \
    -compose multiply -composite "$TMP/raw.png"
  # Drop small matches, then AND with the raw mask: the component pass also
  # fills small holes, and those holes are the gold insignia and white piping.
  magick "$TMP/raw.png" -define connected-components:area-threshold="$area" \
    -define connected-components:mean-color=true -connected-components 8 -threshold 50% \
    "$TMP/raw.png" -compose multiply -composite "$TMP/mask.png"
  # The uniform's mean lightness: the lightness channel's mean over the mask.
  local lsrc
  lsrc=$(magick "$f" -alpha off -colorspace HSL -channel B -separate +channel "$TMP/mask.png" \
    -compose multiply -composite -format '%[fx:mean]' info:)
  lsrc=$(echo "$lsrc / $(magick "$TMP/mask.png" -format '%[fx:mean]' info:)" | bc -l)
  for i in "${!TINTS[@]}"; do
    local out="$AV/avatar-$id-$i.webp"
    if [ "$i" = "$native" ]; then
      magick "$f" -quality 90 -define webp:alpha-quality=100 -strip "$out"
      continue
    fi
    local h s l g
    read -r h s l < <(magick "xc:#${TINTS[$i]}" -colorspace HSL -format '%[fx:r] %[fx:g] %[fx:b]\n' info:)
    # Hue and saturation become the tint's; lightness is bent by a power curve
    # that lands the uniform's mean on the tint's own, keeping every hatch line.
    g=$(echo "l($l)/l($lsrc)" | bc -l)
    magick "$f" -alpha off -colorspace HSL -channel R -fx "$h" -channel G -fx "$s" \
      -channel B -fx "u^$g" +channel -set colorspace HSL -colorspace sRGB "$TMP/tint.png"
    magick "$f" \( "$TMP/tint.png" "$f" -compose copy_opacity -composite \) \
      \( "$TMP/mask.png" -blur 0x0.8 \) -compose over -composite \
      -quality 90 -define webp:alpha-quality=100 -strip "$out"
  done
  echo "  avatar-$id ($2)  uniform L=$(printf '%.3f' "$lsrc")  native tint $native"
}
avatar 1 sailor-woman 0 "$BLUE" 1100 36 32 34 31
avatar 2 sailor-man 0 "$BLUE" 1100 32 30 37 32
avatar 3 marine 2 "$GREY" 900 37 30 30 32
avatar 4 admiral 0 "$BLUE" 1100 33 32 35 37
rm -rf "$TMP"

echo "avatar panels (top cap | stretch strip | bottom cap), for <VSlicedImage>"
vslice() { # vslice <src> <out dir> <out name> <top cap end> <strip start> <strip end> <bottom cap start>
  local f=$1 d=$2 n=$3 t=$4 m0=$5 m1=$6 b=$7 W H
  read -r W H < <(magick identify -format '%w %h\n' "$f")
  magick "$f" -crop "${W}x${t}+0+0" +repage -strip "$d/$n-t.png"
  magick "$f" -crop "${W}x$((m1 - m0))+0+${m0}" +repage -strip "$d/$n-m.png"
  magick "$f" -crop "${W}x$((H - b))+0+${b}" +repage -strip "$d/$n-b.png"
  echo "  $n  ${W}x${H}  caps 0..$t | $m0..$m1 | $b..$H"
}
# Strips sit inside each panel's plain band (rows 29..236 and 28..437), well
# clear of the rounded corners, so only straight side borders stretch.
vslice "$SRC/avatar-screen/horizontal-panel.png" "$AV" panel 80 80 184 184
vslice "$SRC/avatar-screen/vertical-panel.png" "$AV" card 70 70 387 387

echo "match reveal, settings and profile"
MA=assets/match
ST=assets/settings
PR=assets/profile
mkdir -p "$MA" "$ST" "$PR"
TMP=$(mktemp -d)
CREAM="#FAF7ED" # settings/large-panel's paper, sampled

# fill_frame <src> <out>: the frame art is hollow; its interior is filled with
# the panels' paper at 92% (a hint of the page still reads through), laid under
# the frame so the frame's soft inner edge is untouched.
fill_frame() {
  local f=$1 out=$2 W H
  read -r W H < <(magick identify -format '%w %h\n' "$f")
  magick "$f" -alpha extract -threshold 50% -negate \
    -fill gray50 -draw "color $((W / 2)),$((H / 2)) floodfill" \
    -fill black +opaque gray50 -fill white -opaque gray50 \
    -morphology Dilate Disk:2 "$TMP/inside.png"
  magick -size "${W}x${H}" "xc:$CREAM" \( "$TMP/inside.png" -evaluate multiply 0.92 \) \
    -alpha off -compose copy_opacity -composite "$TMP/paper.png"
  magick "$TMP/paper.png" "$f" -compose over -composite -strip "$out"
}

# The arena banner with its baked name erased (the arena is picked per match,
# so the screen draws the name). The name box is covered by mirrored tiles of
# the ribbon's own blank paper, softened toward its flat colour so no repeat
# shows, and feathered in; the clipped scrap of tagline under the ribbon goes.
f="$SRC/match/ironwater-sound-banner.png"
magick "$f" -crop 40x64+108+124 +repage "$TMP/chunk.png"
magick "$TMP/chunk.png" \( "$TMP/chunk.png" -flop \) +append "$TMP/tile.png"
paper=$(magick "$TMP/chunk.png" -alpha off -scale '1x1!' -format '#%[hex:u.p{0,0}]' info:)
magick -size 470x64 "tile:$TMP/tile.png" -blur 0x0.6 \( -size 470x64 "xc:$paper" \) \
  -compose blend -define compose:args=60 -composite \
  \( -size 470x64 xc:black -fill white -draw 'rectangle 6,4 463,59' -blur 0x3 \) \
  -alpha off -compose copy_opacity -composite "$TMP/patch.png"
# +geometry: the patch's offset would otherwise carry into the next composites.
magick "$f" "$TMP/patch.png" -geometry +149+124 -compose over -composite +geometry \
  \( +clone -alpha extract \( -size 767x249 xc:white -fill black -draw 'rectangle 200,209 570,248' \) \
     -compose multiply -composite \) -alpha off -compose copy_opacity -composite -strip "$MA/arena-banner.png"
fill_frame "$SRC/match/player-card-frame.png" "$MA/player-card.png"
fill_frame "$SRC/match/country-badge-frame.png" "$MA/country-badge.png"
echo "  match: arena-banner (name erased), player-card, country-badge (filled)"

# The round avatar placeholder cut down to its rope ring and anchor badge: the
# portrait inside goes (radius 103 about 117,115, measured to the rope's inner
# edge) so the chosen captain can sit under it, the badge circle kept whole.
magick "$SRC/profile/round-captain-avatar.png" \( +clone -alpha extract \
  \( -size 234x231 xc:white -fill black -draw 'circle 117,115 117,12' -fill white -draw 'circle 199,199 199,169' \) \
  -compose multiply -composite \) -alpha off -compose copy_opacity -composite -strip "$PR/round-frame.png"
# The panel frames were cut out of the mockup with bits of it still attached:
# above the top border (row 30) only the rope and the anchor medallion belong,
# so everything else there goes (the sailing-ship sketch, clouds); and the
# profile frame's inner margin carries the top of the mockup's avatar rope,
# covered with a clean stretch of the same margin from beside it.
clean_crown() { # clean_crown <src> <out>
  local f=$1 out=$2 W H
  read -r W H < <(magick identify -format '%w %h\n' "$f")
  magick "$f" -alpha off -fx '(hue>0.04 && hue<0.17 && saturation>0.25 && lightness>0.3 && lightness<0.9) ? 1 : 0' \
    -threshold 50% -morphology Dilate Disk:3 -fill white \
    -draw "circle $((W / 2)),40 $((W / 2)),0" -draw "rectangle 0,30 $W,$H" "$TMP/keep.png"
  magick "$f" \( +clone -alpha extract "$TMP/keep.png" -compose multiply -composite \) \
    -alpha off -compose copy_opacity -composite "$out"
}
clean_crown "$SRC/profile/profile-panel-frame.png" "$TMP/profile-frame.png"
magick "$TMP/profile-frame.png" \( +clone -crop 90x18+42+62 +repage \) -geometry +131+62 \
  -compose copy -composite "$TMP/profile-frame.png"
clean_crown "$SRC/profile/account-panel-frame.png" "$TMP/account-frame.png"
for n in profile account; do
  fill_frame "$TMP/$n-frame.png" "$TMP/$n.png"
  # Crown and corners stay in the caps: the sides run straight from row 40 to 620.
  vslice "$TMP/$n.png" "$PR" "$n-panel" 120 120 560 560
done
echo "  profile: round-frame (ring only), profile-panel, account-panel (filled)"

# The toggle, in parts, so the knob can slide: the blank green track, the same
# track with its green turned to the off state's grey (hatching kept), the knob,
# and toggle-on's two dash clusters (its pill spans x 31..199, y 3..71).
magick "$SRC/settings/blank-toggle-track.png" -trim +repage -strip "$ST/track-on.png"
magick "$SRC/settings/toggle-knob.png" -trim +repage -strip "$ST/knob.png"
magick "$ST/track-on.png" -alpha off -fx '(hue>0.22 && hue<0.48 && saturation>0.25) ? 1 : 0' \
  -threshold 50% "$TMP/green.png"
lsrc=$(magick "$ST/track-on.png" -alpha off -colorspace HSL -channel B -separate +channel "$TMP/green.png" \
  -compose multiply -composite -format '%[fx:mean]' info:)
lsrc=$(echo "$lsrc / $(magick "$TMP/green.png" -format '%[fx:mean]' info:)" | bc -l)
g=$(echo "l(0.55)/l($lsrc)" | bc -l)
magick "$ST/track-on.png" -alpha off -colorspace HSL -channel G -fx 0.03 -channel B -fx "u^$g" +channel \
  -set colorspace HSL -colorspace sRGB "$TMP/grey.png"
magick "$ST/track-on.png" \( "$TMP/grey.png" "$ST/track-on.png" -compose copy_opacity -composite \) \
  \( "$TMP/green.png" -blur 0x0.8 \) -compose over -composite -strip "$ST/track-off.png"
magick "$SRC/settings/toggle-on.png" -crop 30x88+0+0 +repage -strip "$ST/dashes-l.png"
magick "$SRC/settings/toggle-on.png" -crop 29x88+200+0 +repage -strip "$ST/dashes-r.png"
vslice "$SRC/settings/large-panel.png" "$ST" panel 60 60 367 367
slice "$SRC/settings/blank-cream-button.png" "$ST" cream-button 40 60 300 329
echo "  settings: toggle parts (track on/off, knob, dashes), panel, cream button"
rm -rf "$TMP"

echo "points, leaderboard, two players, searching and result"
PT=assets/points; LB=assets/leaderboard; HS=assets/hotseat; SE=assets/searching; RS=assets/result
mkdir -p "$PT" "$LB" "$HS" "$SE" "$RS"
TMP=$(mktemp -d)
PP="$SRC/points-profile"; LBS="$SRC/leaderboard"; MM="$SRC/matchmaking-captain-assets"
VW="$SRC/victory-defeat-assets/winner"; VD="$SRC/victory-defeat-assets/defeat"

# fill_with <src> <out> <colour> <opacity>: fill_frame with any paper colour.
fill_with() {
  local f=$1 out=$2 col=$3 op=$4 W H
  read -r W H < <(magick identify -format '%w %h\n' "$f")
  magick "$f" -alpha extract -threshold 50% -negate \
    -fill gray50 -draw "color $((W / 2)),$((H / 2)) floodfill" \
    -fill black +opaque gray50 -fill white -opaque gray50 \
    -morphology Dilate Disk:2 "$TMP/inside.png"
  magick -size "${W}x${H}" "xc:$col" \( "$TMP/inside.png" -evaluate multiply "$op" \) \
    -alpha off -compose copy_opacity -composite "$TMP/paper.png"
  magick "$TMP/paper.png" "$f" -compose over -composite -strip "$out"
}

# keep_crown <src> <out> <border row> <rope x0> <rope x1> <medallion cx> <cy> <r> [rope top row]:
# above the frame's top border only its own crown belongs — tan rope inside
# [x0, x1] and the anchor medallion; the rest there is mockup residue (the
# ends of the page banner that sat over it, specks).
keep_crown() {
  local f=$1 out=$2 row=$3 x0=$4 x1=$5 cx=$6 cy=$7 r=$8 y0=${9:-0} W H
  read -r W H < <(magick identify -format '%w %h\n' "$f")
  magick "$f" -alpha off \
    -fx '(hue>0.04 && hue<0.17 && saturation>0.25 && lightness>0.3 && lightness<0.9) ? 1 : 0' \
    -threshold 50% -morphology Dilate Disk:3 \
    \( -size "${W}x${H}" xc:black -fill white -draw "rectangle $x0,$y0 $x1,$H" \) -compose multiply -composite \
    -fill white -draw "circle $cx,$cy $cx,$((cy - r))" -draw "rectangle 0,$row $W,$H" "$TMP/keep.png"
  magick "$f" \( +clone -alpha extract "$TMP/keep.png" -compose multiply -composite \) \
    -alpha off -compose copy_opacity -composite "$out"
}

# keep_whole <src> <out> <min area>: drops alpha specks (scraps of neighbouring
# art cut out with it), keeping every part at least <min area> px.
keep_whole() {
  magick "$1" -alpha extract -threshold 30% -define connected-components:area-threshold="$3" \
    -define connected-components:mean-color=true -connected-components 8 -threshold 50% \
    -morphology Dilate Disk:2 "$TMP/whole.png"
  magick "$1" \( +clone -alpha extract "$TMP/whole.png" -compose multiply -composite \) \
    -alpha off -compose copy_opacity -composite -strip "$2"
}

# grid_slice <src> <out dir> <name> "x cuts" "y cuts": the cells of a grid,
# <name>-<row><col>.png, for <GridSlicedImage> (fixed cells keep their shape,
# stretch cells take the slack).
grid_slice() {
  local f=$1 d=$2 n=$3 i j
  local -a xs ys
  read -r -a xs <<< "$4"
  read -r -a ys <<< "$5"
  for ((i = 0; i < ${#ys[@]} - 1; i++)); do
    for ((j = 0; j < ${#xs[@]} - 1; j++)); do
      magick "$f" -crop "$((xs[j + 1] - xs[j]))x$((ys[i + 1] - ys[i]))+${xs[j]}+${ys[i]}" +repage \
        -strip "$d/$n-$i$j.png"
    done
  done
}

# plate <src> <name> <left cap end> <strip end> <right cap start> <top rows to clear>:
# a blank button at each of ASPECTS, the strip beside the baked label TILED —
# stretching it smears the hand hatching into streaks. <ArtPlate> picks the
# nearest aspect, so no plate is ever stretched more than a few percent.
ASPECTS=(3.5 4.25 5 5.75 6.5)
plate() {
  local f=$1 n=$2 l=$3 m1=$4 r=$5 clr=$6 W H i tw mw
  read -r W H < <(magick identify -format '%w %h\n' "$f")
  if [ "$clr" -gt 0 ]; then
    magick "$f" \( +clone -alpha extract -fill black -draw "rectangle 0,0 $W,$((clr - 1))" \) \
      -alpha off -compose copy_opacity -composite "$TMP/src.png"
  else
    cp "$f" "$TMP/src.png"
  fi
  magick "$TMP/src.png" -crop "${l}x${H}+0+0" +repage "$TMP/l.png"
  magick "$TMP/src.png" -crop "$((m1 - l))x${H}+${l}+0" +repage "$TMP/m.png"
  magick "$TMP/src.png" -crop "$((W - r))x${H}+${r}+0" +repage "$TMP/r.png"
  for i in "${!ASPECTS[@]}"; do
    tw=$(printf '%.0f' "$(echo "${ASPECTS[$i]} * $H" | bc -l)")
    mw=$((tw - l - (W - r)))
    magick -background none -size "${mw}x${H}" "tile:$TMP/m.png" "$TMP/mt.png"
    magick "$TMP/l.png" "$TMP/mt.png" "$TMP/r.png" -background none +append +repage -strip "$PT/plate-$n-$i.png"
  done
  echo "  plate-$n  ${#ASPECTS[@]} aspects at ${H}px"
}

# --- Points exchange ---------------------------------------------------------
keep_crown "$PP/points-panel copy.png" "$TMP/points-panel.png" 36 160 525 343 43 37
# 5 x 3: corners, the crown (x 172..508) fixed; a strip each side of the crown
# and the middle band stretch, so every panel's crown is the same size.
grid_slice "$TMP/points-panel.png" "$PT" panel "0 150 172 508 528 651" "0 100 290 352"
plate "$PP/buy-points copy.png" green 58 128 400 0
plate "$PP/sell-points copy.png" cream 58 128 380 5
keep_whole "$PP/points-exchange-banner copy.png" "$PT/banner.png" 1500
magick "$PP/coin-stack copy.png" -trim +repage -resize '360x>' -strip "$PT/coin-stack.png"
echo "  points: panel grid, plates, banner, coin stack"

# --- Leaderboard -------------------------------------------------------------
keep_crown "$LBS/leaderboard-table.png" "$TMP/table.png" 32 215 660 437 37 35 14
# The baked dashed row rules (44 px pitch) are painted over with the clean
# paper just above each, so the live, scrolling rows draw their own.
cp "$TMP/table.png" "$TMP/t.png"
for y in 170 214 258 302 347 391 436; do
  magick "$TMP/t.png" \( +clone -crop "820x6+36+$((y - 9))" +repage \) -geometry "+36+$((y - 2))" \
    -compose copy -composite +geometry "$TMP/t.png"
done
magick "$TMP/t.png" -strip "$LB/table.png"
keep_whole "$LBS/leaderboard-banner.png" "$LB/banner.png" 1500
echo "  leaderboard: table (crown cleaned, rules erased), banner"

# --- Two players -------------------------------------------------------------
f="$MM/rope-panel-frame.png"
read -r W H < <(magick identify -format '%w %h\n' "$f")
parch=$(magick "$f" -crop 150x5+110+44 +repage -alpha off -scale '1x1!' -format '#%[hex:u.p{0,0}]' info:)
# The frame is open along the top (the page banner sits in the gap), so it
# cannot be flood-filled: a parchment rectangle goes under the rope instead,
# in the parchment the rope's own top strip shows, with a little grain.
magick -size "$((W - 36))x$((H - 46))" "xc:$parch" -attenuate 0.35 +noise Gaussian -blur 0x0.6 \
  -alpha set -channel A -evaluate set 96% +channel "$TMP/parch.png"
magick -size "${W}x${H}" xc:none "$TMP/parch.png" -geometry +18+26 -compose over -composite +geometry \
  "$f" -compose over -composite -quality 88 -define webp:alpha-quality=100 -strip "$HS/rope-panel.webp"
fill_with "$MM/player-input-active-frame.png" "$TMP/ia.png" "#E4F1D8" 0.95
fill_with "$MM/player-input-default-frame.png" "$TMP/id.png" "#FBF9F2" 0.95
slice "$TMP/ia.png" "$HS" input-active 40 60 455 475
slice "$TMP/id.png" "$HS" input-default 40 60 444 464
echo "  two players: rope panel (parchment $parch), input frames"

# --- Searching: the radar split into a still base and a sweep that turns ------
f="$MM/matchmaking-radar.png"
magick "$f" -crop 380x384+0+0 +repage "$TMP/radar.png"      # centre (190, 192) = image centre
# The base: the sweep's sector (+4..+66 deg below east) takes the disc mirrored
# top-to-bottom (rings and dashes are symmetric; the one blip mirrored in with
# it just reads as another contact), and the red east edge takes the west
# crosshair mirrored left-to-right. Round the hub the needle is wider than the
# sector, so there only its own red pixels are replaced — mirroring the whole
# hub would carry the needle's reflection back in.
magick "$TMP/radar.png" -alpha off \
  -fx '((hue<0.05 || hue>0.95) && saturation>0.3 && lightness<0.75) ? 1 : 0' -threshold 50% \
  -morphology Dilate Disk:2 \( -size 380x384 xc:black -fill white -draw "circle 190,192 190,160" \) \
  -compose multiply -composite "$TMP/hubred.png"
magick -size 380x384 xc:black -fill white -stroke white \
  -draw "path 'M 190,192 L 370,205 A 180,180 0 0,1 263,356 Z'" \
  "$TMP/hubred.png" -compose lighten -composite "$TMP/sector.png"
magick -size 380x384 xc:black -fill white -draw "rectangle 196,188 372,197" "$TMP/east.png"
magick "$TMP/radar.png" -flip "$TMP/flip.png"
magick "$TMP/radar.png" -flop "$TMP/flop.png"
magick "$TMP/radar.png" \( "$TMP/flip.png" \( "$TMP/sector.png" -blur 0x1 \) -alpha off -compose copy_opacity -composite \) \
  -compose over -composite \
  \( "$TMP/flop.png" \( "$TMP/east.png" -blur 0x0.8 \) -alpha off -compose copy_opacity -composite \) \
  -compose over -composite -strip "$SE/radar-base.png"
# The sweep: the red alone, as pure ink red whose alpha is the pixel's redness
# (R - G, 1 at the needle's own red), inside the sweep's region only — so as it
# turns it tints whatever it crosses and carries nothing of the disc with it.
magick "$TMP/radar.png" -alpha off -fx 'clamp((r-g)/0.706)' "$TMP/redness.png"
magick "$TMP/sector.png" "$TMP/east.png" -compose lighten -composite -morphology Dilate Disk:2 \
  "$TMP/redness.png" -compose multiply -composite "$TMP/sweepa.png"
magick -size 380x384 'xc:#CD191E' "$TMP/sweepa.png" -alpha off -compose copy_opacity -composite \
  -strip "$SE/radar-sweep.png"
echo "  searching: radar base + sweep (pivot at centre)"

# --- Result ------------------------------------------------------------------
fill_with "$VW/results-panel-frame.png" "$RS/panel.png" "#FAF7ED" 0.94
fill_with "$VW/player-name-ribbon-frame.png" "$RS/name-ribbon.png" "#FBF9F2" 0.97
fill_with "$VW/country-badge-frame.png" "$RS/country-badge.png" "#FBF9F2" 0.97
# The bar frame carries specks of the mockup's fill: they go, then it is filled.
# The fill art is a trapezoid scrap of that fill; its hatched middle is the fill.
magick "$VW/progress-bar-frame.png" -alpha off \
  -fx '(hue>0.22 && hue<0.5 && saturation>0.3) ? 0 : 1' -morphology Erode Disk:1 "$TMP/notgreen.png"
magick "$VW/progress-bar-frame.png" \( +clone -alpha extract "$TMP/notgreen.png" -compose multiply -composite \) \
  -alpha off -compose copy_opacity -composite "$TMP/barframe.png"
fill_with "$TMP/barframe.png" "$RS/bar-frame.png" "#EEF0F4" 0.95
magick "$VW/progress-fill.png" -crop 10x14+9+4 +repage -strip "$RS/bar-fill.png"
# The avatar placeholder cut to its rope frame and anchor medallion: the
# portrait inside goes (x 23..196, y 22..206) so the chosen captain sits there.
magick "$VW/captain-avatar.png" \( +clone -alpha extract \
  \( -size 218x243 xc:white -fill black -draw 'rectangle 23,22 196,206' -fill white -draw 'circle 109,213 109,188' \) \
  -compose multiply -composite \) -alpha off -compose copy_opacity -composite -strip "$RS/portrait-frame.png"
magick "$VW/victory-banner.png" -trim +repage -resize '900x>' -strip "$RS/victory-banner.png"
keep_whole "$VD/defeat-banner.png" "$RS/defeat-banner.png" 200
magick "$PP/single-coin copy.png" -trim +repage -resize '72x72>' -strip "$RS/coin.png"
echo "  result: panel, ribbon, badge, bar, portrait frame, banners, coin"
rm -rf "$TMP"

echo "fleet placement and the battle"
bash scripts/battle-assets.sh

echo "the store and the flags"
bash scripts/store-assets.sh
