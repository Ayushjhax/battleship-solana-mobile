#!/bin/bash
# The loser's post-match "Enemy waters revealed" screen, derived from
# assets/opponent_reveal_ui_assets/. Needs ImageMagick 7. Run by
# scripts/color-assets.sh (npm run assets), or on its own. Output: assets/reveal/.
#
# Only what the screen draws is taken, and nothing from the pack is drawn with
# a value baked in that the app changes:
#
#  - paper.jpg: plain ivory graph paper, generated here. The pack's scene (the
#    lighthouse, the coast, gulls, clouds, the compass rose, the binoculars)
#    stays out: the board is the only picture on this page.
#  - countdown-badge.png: the badge with its baked "5" painted out, so the app
#    draws the live second in the empty disc.
#  - bar-track.png / bar-fill.png / bar-frame.png: the progress bar cut up — the
#    bar with its green painted out, the green alone (trimmed), and the frame
#    alone to lay over both. The app slides the fill out under a clip as the
#    five seconds run down. RevealCountdown.tsx
#    holds the fill's box inside the track (BAR_FILL): keep it in step with the
#    bbox this prints.
#  - The name, rank and "Results in 5s" labels are NOT taken: the screen sets
#    the real winner's name and rank, and the seconds, as live text.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=assets/opponent_reveal_ui_assets
OUT=assets/reveal
mkdir -p "$OUT"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "reveal: ivory graph paper"
# 2x the 800 x 360 canvas. One faint rule every 14 canvas units — half a board
# cell, so the page reads as graph paper without competing with the board.
W=1600 H=720 P=28
draw=""
for ((x = 0; x <= W; x += P)); do draw+="line $x,0 $x,$H "; done
for ((y = 0; y <= H; y += P)); do draw+="line 0,$y $W,$y "; done
magick -size "${W}x${H}" xc:'#FAF6EC' -stroke '#D8E3EA' -strokewidth 1.4 -draw "$draw" \
  -quality 88 -strip "$OUT/paper.jpg"

echo "reveal: banner, stamp, portrait frame, divider, quote, sunk cross"
magick "$SRC/02_enemy_waters_title_banner.png" -strip "$OUT/title-banner.png"
magick "$SRC/03_match_complete_stamp.png" -strip "$OUT/match-complete.png"
magick "$SRC/04_empty_portrait_rope_frame.png" -strip "$OUT/portrait-frame.png"
magick "$SRC/07_anchor_divider.png" -strip "$OUT/anchor-divider.png"
magick "$SRC/08_fleet_quote_panel.png" -strip "$OUT/quote-panel.png"
magick "$SRC/09_sunk_cross.png" -strip "$OUT/sunk-cross.png"

echo "reveal: countdown badge with its 5 painted out"
# The disc inside the double ring runs to r ~32 about (46.5, 46.5); the baked
# digit sits inside r 24. Paint r 30 in the disc's own paper.
magick "$SRC/12_countdown_5_badge.png" -fill '#FAF9F6' -stroke none \
  -draw 'circle 46.5,46.5 46.5,16.5' -strip "PNG32:$OUT/countdown-badge.png"

echo "reveal: progress bar cut into track and fill"
BAR="$SRC/14_countdown_progress_bar.png"
read -r BW BH < <(magick identify -format '%w %h\n' "$BAR")
# The track's inside: a rounded box just clear of the frame's inner edge.
INNER='roundrectangle 10,10 310,31 10,10'
magick -size "${BW}x${BH}" xc:black -fill white -draw "$INNER" "PNG:$TMP/inner.png"
# The track: the whole inside painted one paper (a pixel wider, to take the
# green anti-aliasing against the frame too), so no ghost of the old fill.
magick "$BAR" -fill '#FAF6EC' -stroke none -draw 'roundrectangle 9,9 311,32 11,11' -strip "PNG32:$OUT/bar-track.png"
# The frame alone, its inside cut out, laid over the fill: the fill's clip is a
# plain box, and this keeps its corners from ever showing over the rounded ends.
magick "$OUT/bar-track.png" \( +clone -alpha extract -fill black -draw 'roundrectangle 9,9 311,32 11,11' \) \
  -alpha off -compose CopyAlpha -composite -strip "PNG32:$OUT/bar-frame.png"
# The fill: green (hatch edges included — noticeably more green than red, and
# not blue), inside the track only, as the alpha of the original pixels.
magick "$BAR" -alpha off -fx '(g - r > 0.04 && g > b - 0.03) ? 1 : 0' \
  "$TMP/inner.png" -compose Multiply -composite "PNG:$TMP/green.png"
magick "$BAR" -alpha off "$TMP/green.png" -compose CopyAlpha -composite "PNG32:$TMP/fill.png"
magick "$TMP/fill.png" -format 'bar-fill bbox in the %wx%h bar: %@\n' info:
magick "$TMP/fill.png" -trim +repage -strip "PNG32:$OUT/bar-fill.png"

for f in "$OUT"/*; do
  printf '  %s %s\n' "$(basename "$f")" "$(magick identify -format '%wx%h' "$f")"
done
