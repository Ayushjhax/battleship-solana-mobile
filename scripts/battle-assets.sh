#!/bin/bash
# The fleet placement and battle art, derived from assets/images/ and
# assets/battle-complete-assets/. Needs ImageMagick 7. Run by
# scripts/color-assets.sh (npm run assets), or on its own.
#
#  - fx/*.webp: every animation as ONE horizontal strip of equal cells, so the
#    battle plays a frame by sliding the strip under a clipping box on the UI
#    thread (no source swaps, one texture per effect). The frames were cut out
#    of sprite sheets with scraps of their neighbours along the edges: each is
#    cleaned (a part touching a scrap edge that is small beside the drawing
#    goes), then laid on the sequence's common cell.
#  - fleet/*.png: the ships and the small fleet pieces, cut free of whatever
#    else was cropped with them and given a margin so nothing is clipped.
#  - battle/*.png: the frames and panels filled with paper and built at the
#    aspect the screen draws them, the blank buttons, the icons.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=assets/images
BC=assets/battle-complete-assets
FX=assets/fx
FL=assets/fleet
BT=assets/battle
mkdir -p "$FX" "$FL" "$BT"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# clean_frame <src> <out> <scrap edges, any of t l r b>: drops the neighbour
# scraps. A part (alpha > 3 %) touching one of the scrap edges and under a
# fifth of the largest part goes, and so do specks under 6 px anywhere. The
# aircraft leave the bottom edge out: what they drop falls out through it.
clean_frame() {
  local f=$1 out=$2 edges=$3 W H ids
  read -r W H < <(magick identify -format '%w %h\n' "$f")
  magick "$f" -alpha extract -threshold 3% "$TMP/cf-bin.png"
  ids=$(magick "$TMP/cf-bin.png" -define connected-components:verbose=true \
    -connected-components 8 null: 2>&1 | awk -v W="$W" -v H="$H" -v E="$edges" '
      NR > 1 && $NF ~ /^gray\(255/ {
        id = $1; sub(":", "", id); split($2, a, /[x+]/)
        n++; ID[n] = id; A[n] = $4; w[n] = a[1]; h[n] = a[2]; x[n] = a[3]; y[n] = a[4]
        if ($4 > max) max = $4
      }
      END {
        for (i = 1; i <= n; i++) {
          edge = (index(E, "l") && x[i] == 0) || (index(E, "t") && y[i] == 0) ||
                 (index(E, "r") && x[i] + w[i] >= W) || (index(E, "b") && y[i] + h[i] >= H)
          if ((edge && A[i] < 0.2 * max) || A[i] < 6) out = out (out ? "," : "") ID[i]
        }
        print out
      }')
  if [ -n "$ids" ]; then
    magick "$TMP/cf-bin.png" -define connected-components:remove="$ids" \
      -define connected-components:mean-color=true -connected-components 8 \
      -threshold 50% -morphology Dilate Disk:2 "$TMP/cf-keep.png"
    magick "$f" \( +clone -alpha extract "$TMP/cf-keep.png" -compose multiply -composite \) \
      -alpha off -compose copy_opacity -composite "$out"
  else
    cp "$f" "$out"
  fi
}

# wing_anchor <png>: "cx wy" — the alpha's centroid column (every plane and
# what it drops is symmetric about the fuselage) and the row the drawing is
# widest on (the wings). Both hold while the propeller blur and the bomb bay
# change from frame to frame, so the aircraft never jitter.
wing_anchor() {
  local f=$1 W H cx wy
  read -r W H < <(magick identify -format '%w %h\n' "$f")
  cx=$(magick "$f" -alpha extract -threshold 40% -scale "${W}x1!" -compress none -depth 16 pgm:- |
    awk 'NR > 3 { for (i = 1; i <= NF; i++) { c++; s += $i; m += $i * (c - 0.5) } } END { printf "%.0f", m / s }')
  wy=$(magick "$f" -alpha extract -threshold 40% -scale "1x${H}!" -compress none -depth 16 pgm:- |
    awk 'NR > 3 { for (i = 1; i <= NF; i++) { r++; if ($i > best) { best = $i; at = r } } } END { print at - 1 }')
  echo "$cx $wy"
}

# strip <name> <cell px> <mode> <scrap edges> <frames...>, mode:
#   grid  the frames were cut on the sheet's grid, so their canvases already
#         line up: pad them to the largest, crop all to the union of the art
#   wing  trimmed frames aligned on wing_anchor
# Scales so the cell's longer side is <cell px>; prints the cell size.
strip() {
  local name=$1 cell=$2 mode=$3 edges=$4 i=0 f w h
  shift 4
  for f in "$@"; do
    clean_frame "$f" "$TMP/s-$i.png" "$edges"
    i=$((i + 1))
  done
  local n=$i cw ch j frames=()
  if [ "$mode" = grid ]; then
    cw=0; ch=0
    for ((j = 0; j < n; j++)); do
      read -r w h < <(magick identify -format '%w %h\n' "$TMP/s-$j.png")
      if [ "$w" -gt "$cw" ]; then cw=$w; fi
      if [ "$h" -gt "$ch" ]; then ch=$h; fi
    done
    for ((j = 0; j < n; j++)); do
      magick "$TMP/s-$j.png" -background none -gravity northwest -extent "${cw}x${ch}" "$TMP/g-$j.png"
      frames+=("$TMP/g-$j.png")
    done
    local box
    box=$(magick "${frames[@]}" -evaluate-sequence max -alpha extract -threshold 2% -format '%@' info:)
    local bw bh bx by
    IFS='x+' read -r bw bh bx by <<< "$box"
    bx=$((bx > 4 ? bx - 4 : 0)); by=$((by > 4 ? by - 4 : 0))
    bw=$((bw + 8)); bh=$((bh + 8))
    # Where the art ran off its sheet cell its edge is a straight cut; every
    # cell's alpha fades out over its outer 4 % so a cut edge reads as a soft one.
    local fe
    fe=$(( (bw < bh ? bw : bh) / 25 + 2 ))
    magick -size "${bw}x${bh}" xc:black -fill white \
      -draw "rectangle $fe,$fe $((bw - fe - 1)),$((bh - fe - 1))" -blur "0x$((fe / 2 + 1))" "$TMP/feather.png"
    for ((j = 0; j < n; j++)); do
      magick "${frames[j]}" -crop "${bw}x${bh}+${bx}+${by}" +repage -background none \
        -gravity northwest -extent "${bw}x${bh}" \
        \( +clone -alpha extract "$TMP/feather.png" -compose multiply -composite \) \
        -alpha off -compose copy_opacity -composite "$TMP/g-$j.png"
    done
    cw=$bw; ch=$bh
  else
    local L=0 R=0 T=0 B=0 cx wy
    local -a CX WY
    for ((j = 0; j < n; j++)); do
      magick "$TMP/s-$j.png" -trim +repage "$TMP/s-$j.png"
      read -r w h < <(magick identify -format '%w %h\n' "$TMP/s-$j.png")
      read -r cx wy < <(wing_anchor "$TMP/s-$j.png")
      CX[j]=$cx; WY[j]=$wy
      if [ "$cx" -gt "$L" ]; then L=$cx; fi
      if [ $((w - cx)) -gt "$R" ]; then R=$((w - cx)); fi
      if [ "$wy" -gt "$T" ]; then T=$wy; fi
      if [ $((h - wy)) -gt "$B" ]; then B=$((h - wy)); fi
    done
    cw=$((L + R + 8)); ch=$((T + B + 8))
    for ((j = 0; j < n; j++)); do
      magick -size "${cw}x${ch}" xc:none "$TMP/s-$j.png" \
        -geometry "+$((L + 4 - CX[j]))+$((T + 4 - WY[j]))" -compose over -composite "$TMP/g-$j.png"
    done
  fi
  local k sw sh
  if [ "$cw" -gt "$ch" ]; then k=$(echo "$cell / $cw" | bc -l); else k=$(echo "$cell / $ch" | bc -l); fi
  sw=$(printf '%.0f' "$(echo "$cw * $k" | bc -l)")
  sh=$(printf '%.0f' "$(echo "$ch * $k" | bc -l)")
  frames=()
  for ((j = 0; j < n; j++)); do
    magick "$TMP/g-$j.png" -resize "${sw}x${sh}!" "$TMP/c-$j.png"
    frames+=("$TMP/c-$j.png")
  done
  magick "${frames[@]}" -background none +append +repage \
    -quality 86 -define webp:alpha-quality=100 -define webp:method=6 -strip "$FX/$name.webp"
  echo "  $name  $n x ${sw}x${sh}  $(du -k "$FX/$name.webp" | cut -f1) KB"
}

six() { printf "$1_0%d.png " 1 2 3 4 5 6; }

echo "fx strips"
for n in 1 2 3 4; do
  # shellcheck disable=SC2046
  strip "aircraft-$n" 200 wing tlr $(six "$SRC/aircraft-animation/aircraft_0$n")
done
# shellcheck disable=SC2046
{
  strip explosion-ink 200 grid tlrb $(six "$SRC/explosion-effects/explosion_01")
  strip explosion-fire 200 grid tlrb $(six "$SRC/explosion-effects/explosion_02")
  strip explosion-atomic 256 grid tlrb $(six "$SRC/explosion-effects/explosion_03")
  strip explosion-puff 200 grid tlrb $(six "$SRC/explosion-effects/explosion_04")
  strip mine 200 grid tlrb $(six "$SRC/mine-effects/mine_01")
  strip radar 256 grid tlrb $(six "$SRC/radar-scans/radar_01")
  strip smoke 200 grid tlrb $(six "$SRC/smoke-effects/smoke_01")
  strip smoke-atomic 256 grid tlrb $(six "$SRC/smoke-effects/smoke_02")
  strip submarine 200 grid tlrb $(six "$SRC/submarine-effects/submarine_01")
  strip turret 200 grid lb $(six "$SRC/turret-effects/turret_01")
  strip splash 200 grid tlrb $(six "$SRC/water-impacts/splash_01")
  strip bomb 160 grid tlrb $(six "$SRC/bomb-drops/bomb_01")
}

# piece <src> <out> <reach px> [max side]: the largest drawing in <src> with
# every part within <reach> of it (masts, propellers, the ring round a mine),
# nothing else; trimmed, then given a 4 % margin so no edge is clipped.
piece() {
  local f=$1 out=$2 reach=$3 max=${4:-0} id W H m
  magick "$f" -alpha extract -threshold 8% -morphology Dilate "Disk:$reach" "$TMP/p-bin.png"
  id=$(magick "$TMP/p-bin.png" -define connected-components:verbose=true -connected-components 8 null: 2>&1 |
    awk 'NR > 1 && $NF ~ /^gray\(255/ { id = $1; sub(":", "", id); if ($4 > best) { best = $4; at = id } } END { print at }')
  magick "$TMP/p-bin.png" -define connected-components:keep="$id" -define connected-components:mean-color=true \
    -connected-components 8 -threshold 50% "$TMP/p-keep.png"
  magick "$f" \( +clone -alpha extract "$TMP/p-keep.png" -compose multiply -composite \) \
    -alpha off -compose copy_opacity -composite -trim +repage "$TMP/p-out.png"
  read -r W H < <(magick identify -format '%w %h\n' "$TMP/p-out.png")
  m=$(( (W > H ? W : H) / 25 + 2 ))
  if [ "$max" != 0 ]; then
    magick "$TMP/p-out.png" -bordercolor none -border "$m" -resize "${max}x${max}>" -strip "$out"
  else
    magick "$TMP/p-out.png" -bordercolor none -border "$m" -strip "$out"
  fi
}

echo "aircraft shadows (the level frame of each: flights run straight)"
piece "$SRC/aircraft-shadows/shadow_01_01.png" "$TMP/sh.png" 6
magick "$TMP/sh.png" -resize '200x200>' -quality 86 -define webp:alpha-quality=100 -strip "$FX/shadow-1.webp"
piece "$SRC/aircraft-shadows/shadow_02_01.png" "$TMP/sh.png" 6
magick "$TMP/sh.png" -resize '200x200>' -quality 86 -define webp:alpha-quality=100 -strip "$FX/shadow-2.webp"
piece "$SRC/aircraft-silhouettes/plane_01_01.png" "$TMP/sh.png" 6
magick "$TMP/sh.png" -resize '200x200>' -quality 86 -define webp:alpha-quality=100 -strip "$FX/shadow-3.webp"
piece "$SRC/aircraft-silhouettes/plane_02_01.png" "$TMP/sh.png" 6
magick "$TMP/sh.png" -resize '200x200>' -quality 86 -define webp:alpha-quality=100 -strip "$FX/shadow-4.webp"
for n in 1 2 3 4; do echo "  shadow-$n  $(magick identify -format '%wx%h' "$FX/shadow-$n.webp")"; done

echo "fleet: the ships (bow left, as the board lays them) and pieces"
FA="$SRC/fleet-assets"
piece "$FA/carrier-horizontal.png" "$FL/ship-battleship.png" 5 720
piece "$FA/cruiser-horizontal.png" "$FL/ship-cruiser.png" 5 540
piece "$FA/destroyer-horizontal.png" "$FL/ship-destroyer.png" 5 400
piece "$FA/patrol-horizontal.png" "$FL/ship-boat.png" 5 260
for s in battleship cruiser destroyer boat; do echo "  ship-$s  $(magick identify -format '%wx%h' "$FL/ship-$s.png")"; done

echo "fleet: sunk ships (the same art, burnt: grey, darker, flatter)"
for s in battleship cruiser destroyer boat; do
  magick "$FL/ship-$s.png" -modulate 72,18,100 -level 0%,92% -strip "$FL/ship-$s-sunk.png"
done
echo "fleet: enemy wrecks (the pencil ships, drawn as found)"
for s in battleship cruiser destroyer boat; do
  piece "$SRC/ships/ship-$s.png" "$FL/wreck-$s.png" 4 520
done

echo "fleet: board pieces and icons"
piece "$BC/battle/aa-gun.png" "$FL/aa-gun.png" 4
piece "$BC/battle/radar-target.png" "$FL/radar.png" 4
piece "$FA/mine.png" "$FL/mine.png" 5 160
for k in torpedo-bomber double-torpedo bomber atomic-bomber aa-gun radar mine submarine; do
  piece "$BC/arsenal-icons/$k.png" "$FL/icon-$k.png" 4
done
echo "  $(ls "$FL" | wc -l | tr -d ' ') fleet files"

CREAM="#FAF7ED"
# fill <src> <out> [opacity]: the hollow frame's interior (flood-filled from
# the centre of its alpha) painted with the panels' paper, laid under the
# frame so the frame's soft inner edge is untouched.
fill() {
  local f=$1 out=$2 op=${3:-0.95} W H
  read -r W H < <(magick identify -format '%w %h\n' "$f")
  magick "$f" -alpha extract -threshold 50% -negate \
    -fill gray50 -draw "color $((W / 2)),$((H / 2)) floodfill" \
    -fill black +opaque gray50 -fill white -opaque gray50 \
    -morphology Dilate Disk:2 "$TMP/inside.png"
  magick -size "${W}x${H}" "xc:$CREAM" \( "$TMP/inside.png" -evaluate multiply "$op" \) \
    -alpha off -compose copy_opacity -composite "$TMP/paper.png"
  magick "$TMP/paper.png" "$f" -compose over -composite "$out"
}

# nine <src> <out> <out w> <out h> <corner px>: the frame rebuilt at another
# aspect — corners as drawn, edges and middle stretched along their length
# only, so a line stays a line (the hand wobble just runs longer).
nine() {
  local f=$1 out=$2 OW=$3 OH=$4 c=$5 W H mw mh ow oh
  read -r W H < <(magick identify -format '%w %h\n' "$f")
  mw=$((W - 2 * c)); mh=$((H - 2 * c)); ow=$((OW - 2 * c)); oh=$((OH - 2 * c))
  magick -size "${OW}x${OH}" xc:none \
    \( "$f" -crop "${c}x${c}+0+0" +repage \) -geometry +0+0 -composite \
    \( "$f" -crop "${mw}x${c}+${c}+0" +repage -resize "${ow}x${c}!" \) -geometry "+${c}+0" -composite \
    \( "$f" -crop "${c}x${c}+$((W - c))+0" +repage \) -geometry "+$((OW - c))+0" -composite \
    \( "$f" -crop "${c}x${mh}+0+${c}" +repage -resize "${c}x${oh}!" \) -geometry "+0+${c}" -composite \
    \( "$f" -crop "${mw}x${mh}+${c}+${c}" +repage -resize "${ow}x${oh}!" \) -geometry "+${c}+${c}" -composite \
    \( "$f" -crop "${c}x${mh}+$((W - c))+${c}" +repage -resize "${c}x${oh}!" \) -geometry "+$((OW - c))+${c}" -composite \
    \( "$f" -crop "${c}x${c}+0+$((H - c))" +repage \) -geometry "+0+$((OH - c))" -composite \
    \( "$f" -crop "${mw}x${c}+${c}+$((H - c))" +repage -resize "${ow}x${c}!" \) -geometry "+${c}+$((OH - c))" -composite \
    \( "$f" -crop "${c}x${c}+$((W - c))+$((H - c))" +repage \) -geometry "+$((OW - c))+$((OH - c))" -composite \
    +geometry -strip "$out"
}

echo "battle: frames filled with paper, at the aspect each is drawn"
FP="$BC/fleet-placement"
clean_frame "$FP/arsenal-panel-frame.png" "$TMP/a.png" tlrb; fill "$TMP/a.png" "$TMP/a.png" 0.93
nine "$TMP/a.png" "$BT/arsenal-panel.png" 914 525 60
clean_frame "$FP/arsenal-card-frame.png" "$TMP/a.png" tlrb; fill "$TMP/a.png" "$TMP/a.png" 0.96
nine "$TMP/a.png" "$BT/arsenal-card.png" 313 136 26
clean_frame "$FP/dock-frame.png" "$TMP/a.png" tlrb; fill "$TMP/a.png" "$BT/dock.png" 0.8
clean_frame "$FP/radar-modal-frame.png" "$TMP/a.png" tlrb; fill "$TMP/a.png" "$BT/info-modal.png" 0.97
clean_frame "$BC/weapon-selection/weapon-modal-frame.png" "$TMP/a.png" tlrb; fill "$TMP/a.png" "$TMP/a.png" 0.97
nine "$TMP/a.png" "$BT/weapon-modal.png" 885 466 70
clean_frame "$BC/weapon-selection/weapon-row-frame.png" "$TMP/a.png" tlrb; fill "$TMP/a.png" "$TMP/a.png" 0.97
nine "$TMP/a.png" "$BT/weapon-row.png" 315 77 22
clean_frame "$BC/battle/player-info-frame.png" "$TMP/a.png" tlrb; fill "$TMP/a.png" "$TMP/a.png" 0.9
nine "$TMP/a.png" "$BT/info-frame.png" 618 95 24
clean_frame "$BC/emotes/menu-frame.png" "$TMP/a.png" tlrb; fill "$TMP/a.png" "$BT/emote-menu.png" 0.97
clean_frame "$BC/emotes/tile-frame.png" "$TMP/a.png" tlrb; fill "$TMP/a.png" "$BT/emote-tile.png" 0.97
# The board frame: its navy strokes only (the mockup's grid shows through it).
magick "$FP/placement-board-frame.png" -background white -flatten \
  -fx '(hue>0.55 && hue<0.75 && saturation>0.3 && lightness<0.6) ? 1 : 0' -threshold 50% \
  -morphology Dilate Disk:1 "$TMP/navy.png"
magick "$FP/placement-board-frame.png" \( +clone -alpha extract "$TMP/navy.png" -compose multiply -composite \) \
  -alpha off -compose copy_opacity -composite -strip "$BT/board-frame.png"
for n in arsenal-panel arsenal-card dock info-modal weapon-modal weapon-row info-frame emote-menu emote-tile board-frame; do
  echo "  $n  $(magick identify -format '%wx%h' "$BT/$n.png")"
done

# The portrait frame cut to its frame: the captain inside goes (x 18..149,
# y 17..163, to the inner line) so each player's own captain sits there.
magick "$BC/battle/captain-avatar.png" \( +clone -alpha extract \
  \( -size 168x183 xc:white -fill black -draw 'rectangle 18,17 149,163' \) \
  -compose multiply -composite \) -alpha off -compose copy_opacity -composite -strip "$BT/portrait-frame.png"

# quilt <src> <out> <box x0 y0 x1 y1> <patch a x0 x1> <patch b x0 x1>: the
# baked label's box covered with the button's own blank paper — patches
# from beside the label, the same rows, laid alternately left to right with
# a 10 px cross-fade so the hand hatching never shows a hard repeat — then
# feathered into the button.
quilt() {
  local f=$1 out=$2 x0=$3 y0=$4 x1=$5 y1=$6 a0=$7 a1=$8 b0=$9 b1=${10}
  local bw=$((x1 - x0)) bh=$((y1 - y0)) ov=10 x=0 k=0 p0 p1 pw
  # PNG32: an all-transparent canvas is otherwise saved grey, and greys what lands on it.
  magick -size "${bw}x${bh}" xc:none "PNG32:$TMP/q.png"
  while [ "$x" -lt "$bw" ]; do
    if [ $((k % 2)) = 0 ]; then p0=$a0; p1=$a1; else p0=$b0; p1=$b1; fi
    pw=$((p1 - p0))
    magick "$f" -crop "${pw}x${bh}+${p0}+${y0}" +repage \
      \( -size "${ov}x${bh}" -define gradient:direction=East gradient:black-white \
         -size "$((pw - ov))x${bh}" xc:white +append \) \
      -alpha off -compose copy_opacity -composite "$TMP/qp.png"
    [ "$x" = 0 ] && magick "$f" -crop "${pw}x${bh}+${p0}+${y0}" +repage "$TMP/qp.png"
    magick "$TMP/q.png" "$TMP/qp.png" -geometry "+${x}+0" -compose over -composite +geometry "PNG32:$TMP/q.png"
    x=$((x + pw - ov)); k=$((k + 1))
  done
  magick "$TMP/q.png" \( -size "${bw}x${bh}" xc:black -fill white -draw "rectangle 3,3 $((bw - 4)),$((bh - 4))" -blur 0x2 \) \
    -alpha off -compose copy_opacity -composite "$TMP/qm.png"
  magick "$f" "$TMP/qm.png" -geometry "+${x0}+${y0}" -compose over -composite +geometry "$out"
}

# plates <blank> <name> <left cap end> <right cap start>: the blank button at
# each of PLATE_ASPECTS (src/ui/assets.ts), the band between the caps cropped
# or tiled — never stretched, which would slant the hatching.
ASPECTS=(2 2.4 3 3.6 4.4 5.2)
plates() {
  local f=$1 n=$2 l=$3 r=$4 W H i tw mw
  read -r W H < <(magick identify -format '%w %h\n' "$f")
  magick "$f" -crop "${l}x${H}+0+0" +repage "$TMP/pl.png"
  magick "$f" -crop "$((r - l))x${H}+${l}+0" +repage "$TMP/pm.png"
  magick "$f" -crop "$((W - r))x${H}+${r}+0" +repage "$TMP/pr.png"
  for i in "${!ASPECTS[@]}"; do
    tw=$(printf '%.0f' "$(echo "${ASPECTS[$i]} * $H" | bc -l)")
    mw=$((tw - l - (W - r)))
    magick -background none -size "${mw}x${H}" "tile:$TMP/pm.png" "$TMP/pt.png"
    magick "$TMP/pl.png" "$TMP/pt.png" "$TMP/pr.png" -background none +append +repage -strip "$BT/plate-$n-$i.png"
  done
  echo "  plate-$n  ${#ASPECTS[@]} aspects at ${H}px"
}

echo "battle: blank buttons (the live label goes on top)"
quilt "$FP/shuffle-button.png" "$TMP/cream.png" 58 24 172 60 20 56 176 214
plates "$TMP/cream.png" cream 18 217
quilt "$FP/battle-button.png" "$TMP/green.png" 72 16 290 94 24 70 292 328
plates "$TMP/green.png" green 22 329

echo "battle: icons and ornaments (cleaned, trimmed, as drawn)"
for n in back-button rotate-button shuffle-button close-button close-x info-icon diamond-points-icon \
  max-badge fuel-icon compass dock-anchor ocean-warfare-ribbon; do
  piece "$FP/$n.png" "$BT/$n.png" 4
done
for n in arsenal-button empire-logo crossed-weapons-badge star-badge rank-badge rank-badge-admiral \
  seagull wave-mark; do
  piece "$BC/battle/$n.png" "$BT/$n.png" 4
done
piece "$BC/battle/emote-menu-tab.png" "$BT/emote-menu-tab.png" 1
piece "$BC/battle/ocean-unites-us.png" "$BT/ocean-unites-us.png" 40
piece "$BC/weapon-selection/close-x.png" "$BT/modal-close.png" 4
# The wager coins came cut from the green button: its green goes.
magick "$FP/coin-stack.png" \( +clone -alpha off -fx '(hue>0.2 && hue<0.5 && saturation>0.25) ? 0 : 1' \
  -morphology Erode Disk:1 \( +clone -alpha extract \) -compose multiply -composite \) \
  -alpha off -compose copy_opacity -composite "$TMP/coins.png"
piece "$TMP/coins.png" "$BT/coins.png" 3
for n in thumbs-up grin angry-captain wave medal skull question fire; do
  piece "$BC/emotes/$n.png" "$BT/emote-$n.png" 4
done
# The battle's gutter buttons: the glossy home and emote app icons, trimmed.
for n in home emote; do
  magick "$SRC/app-icons/$n.png" -trim +repage -bordercolor none -border 12 -resize '176x176>' -strip "$BT/icon-$n.png"
done
# The effect diagrams' hatched square (the radar diagram's middle cell) and
# the paper it sits on; the grid lines are drawn live.
magick "$FP/radar-scan-diagram.png" -crop 34x34+78+78 +repage -strip "$BT/diagram-cell.png"
echo "  diagram paper $(magick "$FP/radar-scan-diagram.png" -crop 20x20+10+10 +repage -scale '1x1!' -format '#%[hex:u.p{0,0}]' info:)"
echo "  $(ls "$BT" | wc -l | tr -d ' ') battle files, $(du -sh "$BT" | cut -f1)"
