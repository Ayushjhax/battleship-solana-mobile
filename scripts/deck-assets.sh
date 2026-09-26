#!/bin/bash
# The battle's Attack deck, derived from
# assets/empire_of_bits_attack_deck_frames_text/. Needs ImageMagick 7. Run by
# scripts/color-assets.sh (npm run assets), or on its own. Output: assets/deck/.
#
# The source is frames only — the dashed parchment panel and the empty card
# frames (one green "selected" frame, the rest cream). Every label, icon and
# count is drawn live by src/features/battle/AttackDeck.tsx, because the deck
# carries six weapons (catalog.ts WEAPON_ORDER, radar included) and the pack
# has text for five. So all this does is rebuild the frames at the size the
# screen draws them, nine-sliced: corners as drawn, edges stretched along
# their length only, so a hand-drawn line stays a line.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=assets/empire_of_bits_attack_deck_frames_text
OUT=assets/deck
mkdir -p "$OUT"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# nine <src> <out> <out w> <out h> <corner px> — as in scripts/battle-assets.sh.
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

# tall <src> <out> <w> <h> <corner>: scaled to the width it is drawn at — so
# the pen border keeps the weight it was drawn with, instead of the weight a
# full-size nine-slice would leave behind — then nine-sliced to the height.
tall() {
  local f=$1 out=$2 W=$3 H=$4 c=$5
  magick "$f" -resize "${W}x" "PNG32:$TMP/scaled.png"
  nine "$TMP/scaled.png" "$out" "$W" "$H" "$c"
}

# AttackDeck.tsx keeps these in step: the panel and cards at 3x canvas units.
echo "deck: panel and card frames"
tall "$SRC/deck_outer_frame_empty.png" "$TMP/panel.png" 276 834 44
tall "$SRC/frame_bomber_empty.png" "$TMP/card.png" 222 114 30
tall "$SRC/frame_torpedo_selected_empty.png" "$TMP/card-on.png" 222 114 30

# Mostly flat parchment and pen strokes; WebP keeps the hatching without the
# PNG weight (the panel alone is ~220 KB as PNG).
for n in panel card card-on; do
  magick "$TMP/$n.png" -quality 92 -define webp:alpha-quality=100 -define webp:method=6 "$OUT/$n.webp"
done

# The "Attack" heading is used as drawn — it never changes.
box=$(magick "$SRC/text_attack.png" -alpha extract -threshold 3% -format '%@' info:)
magick "$SRC/text_attack.png" -crop "$box" +repage -resize '240x240>' -strip "$OUT/title.png"

for f in "$OUT"/*; do printf '  %-16s %s\n' "$(basename "$f")" "$(magick identify -format '%wx%h' "$f")"; done
echo "  $(ls "$OUT" | wc -l | tr -d ' ') deck files, $(du -sh "$OUT" | cut -f1)"
